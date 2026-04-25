# Telegram Bot Setup Guide

This guide walks you through setting up the Telegram bot integration with the Pi Agent Home Assistant add-on.

## Overview

The Telegram bot allows you to interact with your AI coding agent directly from Telegram. Features include:

- **Session Management**: Create, list, switch, and delete sessions
- **Streaming Responses**: Real-time text updates (Telegram Bot API 9.3+)
- **Typing Indicators**: Visual feedback while the agent processes
- **Cross-Platform Access**: Sessions are shared with the web UI
- **File Support**: Send photos, documents, PDFs, and voice messages

## Prerequisites

1. Home Assistant add-on installed and running
2. Telegram app installed on your device
3. Bot API 9.3+ support (for streaming features) - most modern Telegram clients support this

## Step 1: Create a Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Start a conversation with `/newbot`
3. Follow the prompts:
   - Choose a name for your bot (e.g., "My Pi Agent")
   - Choose a username (must end in `bot`, e.g., `my_pi_agent_bot`)
4. BotFather will provide you with an **API Token** - save this!

Example output from BotFather:

```
✔ New bot was created.
New bot was created at t.me/my_pi_agent_bot
Here is your token for further API control: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz
```

## Step 2: Get Your Chat ID(s)

You need to know which chat IDs are allowed to use the bot. You can get this in two ways:

### Method A: For Personal Use (Single User)

1. Send a message to your new bot (e.g., `/start`)
2. Open **@userinfobot** in Telegram
3. Send any message to @userinfobot
4. It will reply with your user ID (e.g., `123456789`)

### Method B: For Group Chats

1. Add your bot to the group
2. Send a message in the group
3. Open **@getmyid_bot** or similar bot
4. It will show you the group ID (usually starts with `-100`, e.g., `-1001234567890`)

### Method C: Using the Bot Directly

Send this message to your bot:

```
/myid
```

The bot will reply with your chat ID if it's in the allowed list (or a generic ID if not configured yet).

## Step 3: Configure the Home Assistant Add-on

### Option A: Via Web UI (Recommended)

1. Go to **Home Assistant → Settings → Add-ons**
2. Click on **Pi Agent**
3. Click **Configuration** tab
4. Fill in the fields:

| Field                   | Value                      | Description                       |
| ----------------------- | -------------------------- | --------------------------------- |
| **Enable Telegram Bot** | ✅ Checked                 | Turns on the Telegram integration |
| **Telegram Bot Token**  | `123456789:ABCdef...`      | The token from BotFather          |
| **Allowed Chat IDs**    | `123456789,-1001234567890` | Comma-separated list of chat IDs  |

**Important Security Notes**:

- Only add chat IDs you trust
- If you leave "Allowed Chat IDs" empty, **ALL** chats can use your bot (not recommended!)
- Keep your bot token secret - don't share it publicly

### Option B: Via YAML Configuration

Edit your add-on configuration file (`/data/options.json`):

```json
{
  "log_level": "info",
  "telegram_enabled": true,
  "telegram_bot_token": "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
  "telegram_allowed_chat_ids": "123456789,-1001234567890"
}
```

Then restart the add-on.

### Option C: Via Environment Variables (Advanced)

Set environment variables in your Home Assistant configuration:

```yaml
# In your HA configuration
environment:
  - TELEGRAM_ENABLED=true
  - TELEGRAM_BOT_TOKEN=123456789:ABCdef...
  - TELEGRAM_ALLOWED_CHAT_IDS=123456789,-1001234567890
```

## Step 4: Restart the Add-on

After configuring, restart the Pi Agent add-on:

1. Go to **Settings → Add-ons → Pi Agent**
2. Click **Restart**
3. Check the logs to ensure the Telegram bridge started successfully

Expected log output:

```
[pi-agent] Starting Telegram bridge...
[pi-agent] Registered adapter: bidirectional (bidirectional)
[pi-agent] Started adapter: bidirectional
[pi-agent] Telegram bridge started successfully
[pi-agent] Listening for messages...
```

If you see errors, check the logs and verify:

- Bot token is correct
- Chat IDs are valid
- Network connectivity to Telegram API

## Step 5: Test the Integration

### Initial Test

1. Open Telegram and find your bot
2. Send `/start` - the bot should respond with a welcome message
3. Try `/sessions` - list available sessions
4. Try `/new` - create a new session

### Command Reference

| Command         | Description              | Example                            |
| --------------- | ------------------------ | ---------------------------------- |
| `/start`        | Welcome message and help | `/start`                           |
| `/new`          | Create new session       | `/new`                             |
| `/sessions`     | List all sessions        | `/sessions`                        |
| `/session <ID>` | Switch to session        | `/session a1b2c3d4`                |
| `/delete <ID>`  | Delete session           | `/delete a1b2c3d4`                 |
| `/status`       | Show current status      | `/status`                          |
| `/model [name]` | Show/change model        | `/model anthropic/claude-sonnet-4` |
| `/abort`        | Cancel generation        | `/abort`                           |

### Advanced Features

#### File Support

You can send files to the bot:

- **Photos**: The bot will analyze and discuss them
- **Documents**: Text documents are processed for content
- **PDFs**: PDF files are extracted and analyzed
- **Voice Messages**: Converted to text via STT (if configured)

Example workflow:

1. Send a photo of code
2. Ask: "Explain what this code does"
3. The bot will analyze the image and respond

#### Session Sharing

Sessions created in Telegram are accessible from the web UI and vice versa:

- Create a session in the web UI → Access it from Telegram via `/sessions`
- Start coding in Telegram → Continue in the web UI with same context

## Troubleshooting

### Bot Not Responding

**Symptoms**: No response when sending messages to the bot.

**Solutions**:

1. Check add-on logs: `Settings → Add-ons → Pi Agent → Logs`
2. Verify bot token is correct
3. Ensure chat ID is in the allowed list
4. Test with BotFather: Send `/start` to your bot directly

### Streaming Not Working

**Symptoms**: Messages appear all at once instead of streaming.

**Causes**:

- Telegram Bot API version < 9.3
- Group chat (drafts only work in private chats)
- Network issues

**Debug**:

```bash
# Check Telegram API version support
curl -s https://api.telegram.org/bot<YOUR_TOKEN>/getMe | jq .version
```

### Typing Indicators Not Showing

**Symptoms**: No typing indicator while agent is processing.

**Solutions**:

- This is normal for some network configurations
- Check if `typing_indicators` is enabled in bridge config
- Verify network connectivity to Telegram API

### Chat ID Issues

**Symptoms**: "Chat not allowed" or similar errors.

**Solutions**:

1. Verify chat ID format (users: positive number, groups: negative starting with -100)
2. Ensure chat ID is in the allowed list (comma-separated, no spaces)
3. Try adding your current chat ID to the list

### Bridge Not Starting

**Symptoms**: Logs show "Telegram bridge disabled" or startup errors.

**Solutions**:

1. Check if `telegram_enabled` is set to `true`
2. Verify bot token is not empty
3. Check for network/firewall issues blocking Telegram API
4. Review full error logs in add-on logs

## Security Best Practices

### 1. Use Allowed Chat IDs

**Never** leave the allowed chat IDs empty in production! This would allow anyone with your bot token to interact with your AI agent.

```yaml
# ✅ Good - Only specific users/chats
telegram_allowed_chat_ids: "123456789,-1001234567890"

# ❌ Bad - Anyone can use your bot
telegram_allowed_chat_ids: ""
```

### 2. Protect Your Bot Token

- Never commit bot tokens to version control
- Use environment variables or add-on configuration (not hardcoded)
- Rotate tokens periodically
- If compromised, create a new bot via @BotFather and update configuration

### 3. Monitor Usage

Regularly check:

- Add-on logs for unusual activity
- Session history for unexpected conversations
- Resource usage (CPU/memory) during heavy usage

### 4. Rate Limiting

The bridge has built-in concurrency control (default: 2 concurrent messages). Adjust if needed:

```typescript
// In future updates, you may be able to configure:
maxConcurrent: 3 // Allow more concurrent processing
```

## Advanced Configuration

### Custom Model for Telegram

To use a different model for Telegram vs web UI, you'd need to modify the server code to accept separate model configurations. This is not currently supported out-of-the-box.

### Multiple Bots

The current implementation supports one bot per add-on instance. For multiple bots, you'd need:

- Separate add-on instances
- Different ports/ingress paths
- Custom configuration

### Persistent Sessions

Sessions are automatically saved to `~/.pi/agent/sessions/` and persist across restarts. No additional configuration needed.

## Next Steps

After setup, explore these features:

1. **Session Management**: Create multiple sessions for different projects
2. **File Analysis**: Send code snippets, diagrams, documents
3. **Voice Commands**: Use voice messages for hands-free interaction
4. **Cross-Platform Workflow**: Start in Telegram, continue in web UI

## Support

If you encounter issues:

1. Check the add-on logs first
2. Review this guide thoroughly
3. Search existing GitHub issues
4. Create a new issue with:
   - Error messages from logs
   - Your configuration (with token redacted!)
   - Steps to reproduce

## Contributing

Found a bug or have a feature request? Check out the main repository for contribution guidelines!
