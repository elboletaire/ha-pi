# Messaging & Streaming

This document describes how the channel bridge handles message delivery, streaming, and typing indicators.

## Overview

The messaging system provides flexible delivery mechanisms:
- **Draft Streaming**: Real-time text updates using Telegram Bot API 9.3+ (when available)
- **Single Message**: Fallback to complete message delivery (works with all adapters)
- **Typing Indicators**: Visual feedback during processing

## Message Delivery Strategies

### Strategy 1: Draft Streaming (Preferred)

When the adapter supports `sendDraft()` (e.g., Telegram Bot API 9.3+):

```
Agent generates text → Update draft repeatedly → Finalize with complete message
```

**Benefits**:
- Smooth, real-time user experience
- Users see text as it's generated
- Reduces perceived latency

**Requirements**:
- Adapter must implement `sendDraft(recipient, draftId, text)`
- Telegram Bot API 9.3+ or equivalent
- Private chats only (not supported in groups)

### Strategy 2: Single Message (Fallback)

When draft streaming is not available:

```
Agent generates text → Buffer complete response → Send single message
```

**Benefits**:
- Universal compatibility
- Works with all adapters
- Simpler implementation

**Trade-offs**:
- Users wait until generation completes
- No visual feedback during processing (unless typing indicators are used)

## Typing Indicators

### How They Work

Typing indicators are sent at regular intervals while the agent is processing:

1. **Start**: When message processing begins
2. **Refresh**: Every 4 seconds (Telegram standard)
3. **Stop**: When response is complete or error occurs

**Configuration**:
- Default interval: 4000ms (4 seconds)
- Maximum refreshes: 30 (allows up to ~2 minutes)
- Auto-stops when generation completes

### Implementation

```typescript
// In processQueue()
const { stop } = startTypingLoop({
  adapter: channelAdapter,
  recipient: prompt.sender,
  intervalMs: 4000,
  maxRefreshes: 30,
});

// ... processing happens ...

// Stop when done
stop();
```

### Adapter Support

| Adapter | Typing Indicator | Draft Streaming |
|---------|-----------------|-----------------|
| Telegram | ✅ Yes | ✅ Yes (Bot API 9.3+) |
| Discord | ⚠️ Limited | ❌ No |
| Slack | ⚠️ Limited | ❌ No |
| Webhook | ❌ No | ❌ No |

## Draft Streaming Implementation

### Draft Lifecycle

```typescript
// 1. Start draft streaming
const draftId = bridge.startDraftStreaming(senderId); // Returns null if not supported

// 2. Update draft with new text (called as agent generates)
await bridge.updateDraft(senderId, adapter, recipient, newText);

// 3. Finalize with complete message
await bridge.finalizeDraft(senderId, adapter, recipient, markup);
```

### Draft ID Management

- Each sender gets a unique draft ID per message
- Draft IDs are incremented globally (`draftCounter`)
- Active drafts tracked in `activeDrafts` map
- Cleaned up when message completes or fails

### Text Clamping

Draft text is automatically clamped to API limits:
- **Telegram**: Maximum 4096 characters per draft
- Excess text is truncated silently
- Final message will have full text

## Message Content Handling

### Response Extraction

The bridge extracts assistant responses from session messages:

```typescript
const messages = agentManager.getMessages();
const assistantMessage = messages.findLast(
  (m) => m.role === "assistant" || m.role === "ai"
);
const responseText = assistantMessage?.content || "No response generated.";
```

**Supported Roles**:
- `assistant` - Standard assistant messages
- `ai` - Alternative AI role naming

### Error Handling

If no assistant message is found:
- Fallback text: `"No response generated."`
- Error logged for debugging
- User still receives a response (not left hanging)

## Streaming Architecture

### Event Flow

```
User Message
    │
    ▼
Queue Message
    │
    ▼
Start Typing Indicators
    │
    ▼
Start Draft Streaming (if supported)
    │
    ▼
agentManager.prompt(text)
    │
    ├─→ Emits AgentSessionEvents
    │   └─→ handleAgentEvent() tracks completion
    │
    ▼
Wait for Completion
    │
    ▼
Stop Typing Indicators
    │
    ▼
Get Response from Session Messages
    │
    ├─ If Draft Active → Finalize Draft
    │
    └─ Otherwise → Send Single Message
```

### Concurrency Considerations

- Draft streaming is per-sender (isolated)
- Typing indicators are per-message
- Max concurrent messages controlled by `maxConcurrent` config
- Queued messages wait their turn without blocking

## Error Recovery

### Draft Streaming Failures

If `sendDraft()` fails:
- Errors are logged but not propagated to user
- Falls back to single message delivery
- No disruption to user experience

### Typing Indicator Failures

If `sendTyping()` fails:
- Silently ignored (best-effort)
- Processing continues normally
- User still sees final response

### Message Delivery Failures

If `sendMessage()` fails:
- Error logged with full details
- User receives error notification
- Session state preserved for retry

## Configuration

### Enable/Disable Features

```typescript
const bridge = new ChannelBridge({
  provider: "anthropic",
  modelId: "claude-sonnet-4-5-20250929",
  typingIndicators: true,    // Enable typing indicators (default: true)
  maxConcurrent: 2,          // Max concurrent messages
});
```

### Adapter Requirements

For full feature support, adapters should implement:

```typescript
interface ChannelAdapter {
  // Required for all bidirectional adapters
  send(message: ChannelMessage): Promise<void>;
  
  // Optional but recommended
  sendTyping?(recipient: string): Promise<void>;
  sendDraft?(recipient: string, draftId: number, text: string): Promise<void>;
}
```

## Future Enhancements

### Planned Features

1. **Smart Fallback Detection**
   - Automatically detect Bot API version
   - Enable/disable draft streaming based on capabilities

2. **Progressive Disclosure**
   - Show first 200 characters immediately
   - Continue streaming rest

3. **Markdown Streaming**
   - Render markdown as it arrives
   - Better formatting for code blocks

4. **Tool Call Indicators**
   - Show when agent is using tools
   - Display tool execution progress

5. **Multi-Part Messages**
   - Split very long responses (>4096 chars)
   - Auto-follow-up with continuation

### Performance Optimizations

- Batch draft updates (reduce API calls)
- Debounce rapid text changes
- Connection pooling for adapter HTTP requests
- Local caching of frequent responses

## Testing

### Unit Tests

Test coverage includes:
- Draft streaming lifecycle
- Typing indicator timing
- Fallback to single message
- Error handling paths

### Integration Tests

End-to-end scenarios:
1. Send message with draft streaming enabled
2. Verify draft updates received
3. Confirm final message complete
4. Test fallback when drafts not supported
5. Verify typing indicators during processing

### Manual Testing

To test manually:
```bash
# Enable debug logging
DEBUG=ha-pi:* pnpm dev --provider anthropic --model claude-sonnet-4-5-20250929

# Send a complex question to trigger streaming
/echo "Generate a detailed explanation of quantum computing"
```

## Troubleshooting

### Draft Not Streaming

**Symptoms**: User sees complete message at once, no intermediate updates.

**Causes**:
- Bot API version < 9.3
- Group chat (drafts only work in private chats)
- Adapter doesn't implement `sendDraft`

**Debug**:
```typescript
// Check adapter capabilities
console.log("Has sendDraft:", adapter.sendDraft !== undefined);
```

### Typing Indicators Not Showing

**Symptoms**: No typing indicator while agent is processing.

**Causes**:
- `typingIndicators: false` in config
- Adapter doesn't support `sendTyping`
- Network issues preventing API calls

**Debug**:
```typescript
// Check if adapter has sendTyping
console.log("Has sendTyping:", adapter.sendTyping !== undefined);
```

### Messages Not Delivered

**Symptoms**: Agent processes but user never receives response.

**Causes**:
- `sendMessage` implementation missing in adapter
- Recipient ID incorrect
- Network connectivity issues

**Debug**:
```typescript
// Check adapter has send method
console.log("Has send:", adapter.send !== undefined);
```

## Best Practices

1. **Always Provide Fallback**: Never rely solely on draft streaming; always have single message fallback.

2. **Respect API Limits**: Clamp text to adapter-specific limits (e.g., 4096 for Telegram).

3. **Clean Up Resources**: Always stop typing loops and clear active drafts when done.

4. **Log Errors**: Log all failures for debugging, but don't disrupt user experience.

5. **Test on Target Platform**: Verify streaming behavior on the actual platform (Telegram web vs desktop may differ).
