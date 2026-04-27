# Telegram Bot Setup

Connect Pi Agent to Telegram and chat with your Home Assistant from anywhere.

## Step 1: Create Your Bot

1. Open Telegram and search for [**@BotFather**](https://t.me/BotFather)
2. Send `/newbot` to start creating your bot
3. **Choose a display name** — This is what users see (e.g., "My Home Assistant")
4. **Choose a username** — Must end in `bot` (e.g., `my_ha_assistant_bot`)
5. BotFather replies with your **bot token** — copy it!

```
Done! Congratulations on your new bot. You will find it at t.me/my_ha_assistant_bot.

Use this token to access the HTTP API:
123456789:ABCdefGHIjklMNOpqrsTUVwxyz

Keep your token secure and store it safely.
```

> ⚠️ **Keep your token secret!** Anyone with this token can control your bot.

## Step 2: Get Your Chat ID

The bot needs to know which Telegram accounts are allowed to use it.

1. Start a chat with [**@myidbot**](https://t.me/myidbot)
2. Send `/getid`
3. It replies with your **user ID** (a number like `123456789`)

For **group chats**, add the bot to the group, then use **@getmyid_bot** to get the group ID (starts with `-100`).

## Step 3: Configure the Add-on

1. Go to **Settings → Add-ons → Pi Agent → Configuration**
2. Enable **Telegram Bot**
3. Paste your **bot token**
4. Enter your **chat ID** (comma-separated for multiple users/groups)
5. Click **Save** and **Restart**

Example configuration:

| Field               | Value                      |
| ------------------- | -------------------------- |
| Enable Telegram Bot | ✅                         |
| Telegram Bot Token  | `123456789:ABCdefGHI...`   |
| Allowed Chat IDs    | `123456789,-1001234567890` |

## Step 4: Test It

1. Open your bot in Telegram (use the link BotFather gave you)
2. Send `/start` — you should get a welcome message
3. Try asking something: "What lights do I have?"

## Commands

| Command         | What it does                 |
| --------------- | ---------------------------- |
| `/start`        | Show welcome message         |
| `/new`          | Start a new session          |
| `/sessions`     | List your sessions           |
| `/session <ID>` | Switch to a specific session |
| `/status`       | Show current session info    |
| `/model`        | Show or change the AI model  |
| `/abort`        | Cancel the current response  |
| `/delete <ID>`  | Delete a session             |

## Features

- **Streaming responses** — See text as it's generated (Bot API 9.3+)
- **Session sync** — Continue conversations started in the web UI
- **File support** — Send photos, documents, or voice messages
- **Typing indicators** — Visual feedback while the agent thinks

## Troubleshooting

### Bot doesn't respond

- Check the add-on logs: **Settings → Add-ons → Pi Agent → Logs**
- Verify your chat ID is in the allowed list
- Make sure the bot token is correct

### "Chat not allowed" error

- Your chat ID isn't in `telegram_allowed_chat_ids`
- Use @userinfobot to confirm your ID
- Group IDs are negative and start with `-100`

### No streaming (text appears all at once)

- Streaming requires Telegram Bot API 9.3+
- Update your Telegram app to the latest version
- Streaming only works in private chats, not groups

## Security Tips

1. **Always set allowed chat IDs** — An empty list means anyone can use your bot
2. **Don't share your token** — Treat it like a password
3. **Check logs regularly** — Watch for unexpected activity
4. **Rotate tokens if compromised** — Create a new bot via @BotFather
