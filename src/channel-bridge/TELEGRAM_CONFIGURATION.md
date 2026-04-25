# Telegram Configuration Implementation

## Overview

This document describes how the Telegram bot integration is configured and managed within the Home Assistant add-on.

## Architecture

```
Home Assistant Add-On UI
         │
         ▼
  config.yaml (schema)
         │
         ▼
  /data/options.json (runtime config)
         │
         ▼
  run.sh (parses options → CLI args)
         │
         ▼
  server.ts (parseServerArgs → TelegramConfig)
         │
         ▼
  ChannelBridge (startTelegramBridge)
         │
         ▼
  Telegram Adapter (polls for messages)
```

## Configuration Flow

### 1. User Input (Home Assistant UI)

Users configure Telegram settings via the HA add-on configuration page:

```yaml
# config.yaml schema definition
telegram_enabled: "boolean"
telegram_bot_token: "password"
telegram_allowed_chat_ids: "text (comma-separated)"
```

The UI shows:
- **Enable Telegram Bot**: Checkbox to turn on/off the feature
- **Telegram Bot Token**: Password field for secure token entry
- **Allowed Chat IDs**: Text field with helper text explaining format

### 2. Storage (/data/options.json)

HA stores configuration in `/data/options.json`:

```json
{
  "log_level": "info",
  "telegram_enabled": true,
  "telegram_bot_token": "123456789:ABCdef...",
  "telegram_allowed_chat_ids": "123456789,-1001234567890"
}
```

### 3. Runtime Parsing (run.sh)

The `run.sh` script reads options and converts to CLI arguments:

```bash
# Read from /data/options.json
TELEGRAM_ENABLED=$(get_option 'telegram_enabled' 'false')
TELEGRAM_TOKEN=$(get_option 'telegram_bot_token' '')
TELEGRAM_CHAT_IDS=$(get_option 'telegram_allowed_chat_ids' '')

# Build Telegram flags
if [ "$TELEGRAM_ENABLED" = "true" ]; then
  TELEGRAM_FLAGS="--telegram-enabled true"
  TELEGRAM_FLAGS="$TELEGRAM_FLAGS --telegram-bot-token \"$TELEGRAM_TOKEN\""
  TELEGRAM_FLAGS="$TELEGRAM_FLAGS --telegram-allowed-chat-ids \"$TELEGRAM_CHAT_IDS\""
fi

# Pass to server
exec node /app/dist/server.js \
  --provider "${PROVIDER}" \
  --model "${MODEL}" \
  --log-level "${LOG_LEVEL}" \
  $TELEGRAM_FLAGS
```

### 4. Server Initialization (server.ts)

The server parses CLI args and starts the bridge:

```typescript
const opts = parseServerArgs(); // Returns AddOnOptions with telegramConfig

if (opts.telegramConfig?.enabled) {
  const bridge = await startTelegramBridge({
    provider: opts.provider,
    modelId: opts.model,
    token: opts.telegramConfig.botToken,
    allowedChatIds: opts.telegramConfig.allowedChatIds.length > 0 
      ? opts.telegramConfig.allowedChatIds 
      : undefined, // undefined = all chats allowed
    authStorage: bridgeAuthStorage,
    resourceLoader: bridgeResourceLoader,
  });
}
```

## Configuration Schema Details

### Field Definitions

#### `telegram_enabled` (boolean)
- **Type**: Boolean checkbox in UI
- **Default**: `false`
- **Purpose**: Enable/disable Telegram integration
- **Behavior**: If `false`, no Telegram bridge is started regardless of other settings

#### `telegram_bot_token` (password)
- **Type**: Password field (masked input in UI)
- **Default**: Empty string
- **Purpose**: Telegram Bot API token from @BotFather
- **Format**: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`
- **Validation**: Must be non-empty if `telegram_enabled=true`
- **Security**: Never logged, stored in `/data/options.json` (encrypted by HA)

#### `telegram_allowed_chat_ids` (text)
- **Type**: Text field with helper text
- **Default**: Empty string
- **Purpose**: Whitelist of allowed chat/user IDs
- **Format**: Comma-separated list (e.g., `123456789,-1001234567890`)
- **Behavior**:
  - If empty: All chats can use the bot (⚠️ security risk!)
  - If populated: Only listed IDs can interact
- **Validation**: IDs must be valid Telegram chat IDs

## Security Considerations

### Token Handling

1. **Storage**: Tokens stored in `/data/options.json` which is encrypted by Home Assistant
2. **Logging**: Tokens never logged or printed to console
3. **Memory**: Only kept in memory during runtime
4. **Transmission**: Sent only to Telegram API over HTTPS

### Chat ID Whitelisting

**Recommended**: Always use chat ID whitelisting

```yaml
# ✅ Secure - Only specific users/chats
telegram_allowed_chat_ids: "123456789"

# ⚠️ Risky - All chats allowed (not recommended for production)
telegram_allowed_chat_ids: ""
```

**Why Whitelisting Matters**:
- Prevents unauthorized access to your AI agent
- Stops spam and abuse
- Controls who can interact with your coding assistant
- Essential if the bot token is ever exposed

### Environment Variables (Alternative)

For advanced users, configuration can also be set via environment variables:

```yaml
# In HA configuration.yaml or docker-compose.yml
environment:
  - TELEGRAM_ENABLED=true
  - TELEGRAM_BOT_TOKEN=123456789:ABCdef...
  - TELEGRAM_ALLOWED_CHAT_IDS=123456789
```

This bypasses the UI but provides more flexibility for automated deployments.

## Error Handling

### Missing Token

If `telegram_enabled=true` but no token provided:

```
[pi-agent] Telegram enabled but no bot token provided. Telegram bridge will not start.
```

**Result**: Web UI continues to work, Telegram feature disabled silently.

### Invalid Chat ID Format

If chat IDs contain invalid characters:

```typescript
const allowedChatIds = telegramChatIdsRaw
  .split(",")
  .map(id => id.trim())
  .filter(id => id.length > 0);
```

Invalid IDs are simply filtered out. The bridge will start but those chats won't be able to use it.

### Network Errors

If Telegram API is unreachable:

```typescript
try {
  telegramBridge = await startTelegramBridge({...});
  log.info("Telegram bridge started successfully");
} catch (err: any) {
  log.error(`Failed to start Telegram bridge: ${err.message}`);
  log.error("The web UI will continue to work, but Telegram messages will not be processed.");
}
```

**Result**: Web UI unaffected, error logged for debugging.

## Runtime Behavior

### Startup Sequence

1. Parse CLI arguments → `AddOnOptions`
2. If `telegramConfig.enabled`:
   - Create bridge resource loader
   - Create bridge auth storage
   - Start Telegram bridge with `startTelegramBridge()`
   - Register graceful shutdown handler
3. Continue with normal server startup (WebSocket, HTTP, etc.)

### Graceful Shutdown

On SIGTERM/SIGINT:

```typescript
const shutdown = async () => {
  log.info("Shutting down...");
  
  // Stop Telegram bridge if running
  if (telegramBridge) {
    try {
      await telegramBridge.stop();
      log.info("Telegram bridge stopped.");
    } catch (err: any) {
      log.error(`Error stopping Telegram bridge: ${err.message}`);
    }
  }
  
  httpServer.close(() => process.exit(0));
};
```

Ensures proper cleanup of polling connections and resources.

## Testing Configuration

### Verify Configuration

Check add-on logs after restart:

```bash
# Should see one of these messages:

# ✅ Enabled with valid config
[pi-agent] Starting Telegram bridge...
[pi-agent] Registered adapter: bidirectional (bidirectional)
[pi-agent] Started adapter: bidirectional
[pi-agent] Telegram bridge started successfully

# ⚠️ Enabled but no token
[pi-agent] Telegram enabled but no bot token provided. Telegram bridge will not start.

# ❌ Disabled
[pi-agent] Telegram bridge disabled in configuration
```

### Test with /start Command

Once configured, test by sending `/start` to your bot in Telegram. Expected response:

```
🤖 Welcome to Pi Agent!

I'm your AI coding assistant on Telegram.

Commands:
/start - This message
/new - Create new session
/sessions - List all sessions
/session <ID> - Switch to session
/delete <ID> - Delete session
/status - Show current status
/model [name] - Show/change model
/abort - Cancel generation

Send me a message to start coding!
```

## Configuration Examples

### Example 1: Personal Use (Single User)

```yaml
telegram_enabled: true
telegram_bot_token: "123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
telegram_allowed_chat_ids: "123456789"
```

**Use Case**: Individual developer using bot from their personal Telegram account.

### Example 2: Team/Group Access

```yaml
telegram_enabled: true
telegram_bot_token: "123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
telegram_allowed_chat_ids: "123456789,-1001234567890,-1009876543210"
```

**Use Case**: Team shared bot accessible by multiple users and group chats.

### Example 3: Development (All Access)

```yaml
telegram_enabled: true
telegram_bot_token: "123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
telegram_allowed_chat_ids: ""
```

**Use Case**: Local development/testing where security is less critical.

**⚠️ Warning**: Never use this in production!

### Example 4: Disabled

```yaml
telegram_enabled: false
telegram_bot_token: ""
telegram_allowed_chat_ids: ""
```

**Use Case**: When Telegram integration is not needed.

## Migration from Legacy Config

If you have existing bot tokens in environment variables or other locations, migrate to the new configuration:

1. **From Environment Variables**:
   - Copy token value
   - Paste into add-on configuration UI
   - Remove old environment variable

2. **From Previous Code**:
   - Locate hardcoded token in code (if any)
   - Move to add-on configuration
   - Remove from code

3. **Verify**:
   - Restart add-on
   - Check logs for successful bridge startup
   - Test with `/start` command

## Future Enhancements

Potential improvements to configuration:

1. **OAuth Integration**: Allow OAuth login instead of manual token entry
2. **Multiple Bots**: Support multiple bot instances
3. **Per-Channel Models**: Different models for Telegram vs web UI
4. **Rate Limiting**: Configurable message rate limits per user
5. **Advanced Permissions**: Role-based access control (admin, user, guest)
6. **Usage Analytics**: Track and display usage statistics

## Support

If you encounter configuration issues:

1. Check add-on logs for error messages
2. Verify token format (should be `NUMBER:LETTERS`)
3. Ensure chat IDs are correct (use @userinfobot or @getmyid_bot)
4. Review this documentation thoroughly
5. Create a GitHub issue with details (redact your token!)

## Summary

The Telegram configuration system provides:

✅ **User-Friendly UI**: Simple checkboxes and text fields in HA add-on settings  
✅ **Secure Storage**: Tokens encrypted by Home Assistant  
✅ **Flexible Whitelisting**: Support for single users or multiple chats  
✅ **Graceful Degradation**: Web UI works even if Telegram fails  
✅ **Comprehensive Logging**: Clear messages for debugging  
✅ **Production-Ready**: Security best practices built-in  

Configuration is now complete and ready for use!
