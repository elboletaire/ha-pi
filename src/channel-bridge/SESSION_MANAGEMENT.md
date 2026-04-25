# Session Management

This document describes how the channel bridge manages sessions for Telegram and other chat platforms.

## Overview

The channel bridge shares session storage with the web UI, enabling seamless switching between platforms. All sessions are stored in `~/.pi/agent/sessions/<encoded-cwd>/` and are accessible from both the web interface and any connected chat platform.

## Session Architecture

### Per-Sender Isolation

Each sender (Telegram chat/user) gets:

- A unique `AgentManager` instance
- A dedicated FIFO message queue
- Independent session state
- Separate typing indicator tracking

**Sender ID Format**: `{adapter}:{sender}`  
Example: `telegram:-1001234567890` (group chat) or `telegram:123456789` (user)

### Session Lifecycle

```
New Sender Message
        │
        ▼
Get/Create AgentManager ──► Initialize with provider/model
        │
        ▼
Parse Command? ──Yes──► Execute Command (/new, /sessions, etc.)
        │             │
        │            No│
        │              ▼
        │         Queue Message
        │              │
        ├──────────────┘
        │
        ▼
Process Queue (if capacity)
        │
        ▼
Execute AgentSession.prompt()
        │
        ▼
Stream Responses via Event Subscription
```

## Command Handlers

### `/new` - Create New Session

Creates a fresh session, clearing all previous conversation history.

**Response**:

```
✅ New session created.

ID: a1b2c3d4
Model: anthropic/claude-sonnet-4-5-20250929
```

**Implementation**: Calls `agentManager.newSession()` which:

1. Generates a new UUID for the session
2. Creates a new session file in the shared sessions directory
3. Initializes the AgentSession with default settings

### `/sessions` - List All Sessions

Displays all sessions with their metadata.

**Response Format**:

```
Available sessions:

ID        Name                    Msgs    Last Modified
a1b2c3d4  my-project              0042    4/25/2026, 10:30:00 AM
b2c3d4e5  test-session            0015    4/25/2026, 9:15:00 AM

Commands:
  `/sessions` - list all sessions
  `/session <ID>` - switch to a session
  `/new` - create a new session
  `/delete <ID>` - delete a session
```

**Implementation**: Calls `agentManager.listSessions()` which uses `SessionManager.list()` to retrieve all session files.

### `/session <ID>` - Switch Session

Switches to a specific session by path.

**Response**:

```
✅ Switched to session.

<b>ID:</b> a1b2c3d4
<b>Model:</b> anthropic/claude-sonnet-4-5-20250929
<b>Messages:</b> 42
<b>Latest message:</b> Last message in the session history (user or assistant)
```

The Telegram reply no longer includes session-switch buttons.

**Implementation**: Calls `agentManager.switchSession(sessionPath)` which:

1. Loads the existing session file
2. Reinitializes the AgentSession with previous conversation history
3. Preserves all messages and context
4. Reads the last message in the session history and includes it in the confirmation body

### `/delete <ID>` - Delete Session

Permanently removes a session and its files.

**Response**:

```
✅ Session deleted: a1b2c3d4
```

**Implementation**: Calls `agentManager.deleteSession(sessionPath)` which deletes the session file from disk.

### `/status` - Show Session Status

Displays current session metadata.

**Response**:

```
📊 Session Status

Session ID: a1b2c3d4
Model: anthropic/claude-sonnet-4-5-20250929
Messages: 42
Streaming: false
Thinking Level: none
```

**Implementation**: Calls `agentManager.getState()` which returns the current AgentSession state.

### `/model [name]` - Show/Change Model

Shows available models or switches to a different model.

**Show Current**:

```
📊 Current model: anthropic/claude-sonnet-4-5-20250929

Available models:
  • anthropic/claude-sonnet-4-5-20250929
  • anthropic/claude-3-5-sonnet-20241022
  • google/gemini-2.0-flash
```

**Change Model**:

```
✅ Model changed to: anthropic/claude-3-5-sonnet-20241022
```

**Implementation**: Calls `agentManager.setModel(provider, modelId)` which updates the model configuration.

### `/abort` - Cancel Generation

Stops an ongoing generation immediately.

**Response**:

```
✅ Generation aborted.
```

**Implementation**: Calls `agentManager.abort()` and cancels any active AbortController.

## Session Storage

### Directory Structure

Sessions are stored in a platform-independent location:

```
~/.pi/agent/sessions/<encoded-cwd>/
├── a1b2c3d4.session          # Session file (JSON)
├── b2c3d4e5.session          # Another session
└── ...
```

**Encoding**: The working directory (cwd) is encoded to create a safe filename. This allows multiple projects to have their own session namespaces while sharing the same base directory.

### Session File Format

Each `.session` file contains:

- Session metadata (ID, creation date, modification date)
- Conversation history (messages, tool calls, etc.)
- Settings and configuration
- Compaction entries (for context management)

### Shared Storage Benefits

1. **Cross-Platform Access**: Sessions created in web UI are accessible from Telegram and vice versa
2. **Consistent State**: All platforms see the same session state
3. **Easy Backup**: Single location for all session data
4. **No Duplication**: Same session file used across all interfaces

## Concurrency Control

### Processing Limits

- **Max Concurrent Messages**: Configurable (default: 2)
- **Per-Sender Queue**: FIFO ordering ensures messages are processed in order
- **Capacity Check**: New messages are queued if processing limit is reached

### Queue Behavior

When a sender has multiple messages:

1. First message starts processing immediately (if capacity available)
2. Subsequent messages are added to the queue
3. When one completes, the next in line starts automatically
4. Messages maintain their order within each sender's queue

## Event Streaming

### AgentSession Events

The bridge subscribes to `AgentSession` events for real-time updates:

```typescript
agentManager.subscribe((event) => {
  // Handle different event types
  if (event.type === 'message_update') {
    // Stream partial text
  } else if (event.type === 'message_end') {
    // Message complete, increment counter
  } else if (event.type === 'turn_end') {
    // Turn complete
  }
})
```

### Current Implementation

For now, the bridge tracks:

- `message_end` events: Increment message count
- `turn_end` events: Track conversation turns

Future enhancements will include streaming drafts and typing indicators.

## Error Handling

### Session Errors

Common errors and their handling:

| Error               | Cause                  | Response                             |
| ------------------- | ---------------------- | ------------------------------------ |
| Session not found   | Invalid session ID     | Show available sessions list         |
| Delete failed       | File permission issues | Display error message                |
| Switch failed       | Corrupted session file | Log error, return to current session |
| Model not available | Invalid model ID       | Show available models list           |

### Connection Errors

If the adapter fails to start:

- Error logged but bridge continues running
- Other adapters remain functional
- User notified via `/status` command

## Future Enhancements

### Planned Features

1. **Streaming Drafts**: Real-time text streaming using Telegram Bot API 9.3+
2. **Session Forking**: Create branches from existing sessions
3. **Session Compaction**: Automatic context compression for long conversations
4. **Cross-Platform Sync**: Keep session state synchronized across all platforms
5. **Session Export/Import**: Backup and restore sessions

### Extensibility

Adding support for new platforms:

1. Implement `ChannelAdapter` interface
2. Create start function similar to `startTelegramBridge`
3. Register adapter with the bridge
4. No changes needed to session management logic

## Testing

### Unit Tests

Test coverage includes:

- Queue behavior (FIFO ordering)
- Concurrency limits
- Command routing
- Session lifecycle events

### Integration Tests

End-to-end scenarios:

1. Create new session via `/new`
2. Send messages and verify streaming
3. Switch to different session via `/session <ID>`
4. List all sessions via `/sessions`
5. Delete session via `/delete <ID>`
6. Verify cross-platform session access

## Security Considerations

### Session Isolation

- Each sender has completely isolated session state
- No cross-contamination between chats/users
- Separate AgentManager instances prevent interference

### Access Control

- Whitelist `TELEGRAM_ALLOWED_CHAT_IDS` to restrict access
- Only allowed chat IDs can interact with the bridge
- Unauthorized messages are silently ignored

### Data Privacy

- Session files stored locally in user's home directory
- No external storage or cloud synchronization
- User has full control over session data
