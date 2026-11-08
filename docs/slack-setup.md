# Slack setup for the Dashboard

The Dashboard can mirror its fake-employee chats into a real Slack channel. Teammates read them there and reply as humans; replies flow back into the pipeline. Slack stands in for Teams. It uses Socket Mode, so no public URL is needed. Setup takes about 10 minutes and is done once per workspace.

## 1. Workspace

Use an existing Slack workspace, or create a free one at https://slack.com/get-started#/createnew. A free workspace is enough.

## 2. Create the app

1. Open https://api.slack.com/apps and click **Create New App**.
2. Choose **From an app manifest**, pick your workspace.
3. Paste the content of `deploy/slack-manifest.yml` (YAML tab), then **Next** and **Create**.

## 3. App-level token

1. In the app, go to **Basic Information**, section **App-Level Tokens**.
2. **Generate Token and Scopes**, name it `dashboard`, add the scope `connections:write`, and generate.
3. Copy the token (`xapp-...`). This is `SLACK_APP_TOKEN`.

## 4. Install and copy the bot token

1. Go to **OAuth & Permissions** and click **Install to Workspace**, then allow.
2. Copy the **Bot User OAuth Token** (`xoxb-...`). This is `SLACK_BOT_TOKEN`.

## 5. Channel

1. Create a channel, for example `#dashboard`. A private channel works too.
2. In the channel type `/invite @Context Dashboard`.
3. Get the channel ID: right-click the channel, **View channel details**, the ID (`C0123456789`) is at the bottom. This is `SLACK_CHANNEL_ID`.

## 6. Configure and restart

Add to `.env` (never commit it):

```
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_CHANNEL_ID=C0123456789
```

Restart `uv run ctx dashboard`. The header of the UI shows the **Slack on** badge with the channel name. `GET /api/slack/status` gives the details and the last error.

## Using it

- **Teammates join** the channel like any other. What they type is read by the Dashboard, with their Slack display name and the "title" from their Slack profile as role (set it in the profile to feed the role).
- **Top-level message** in the channel: creates a new thread (source `slack`) in the Dashboard.
- **Reply in a thread** of a mirrored conversation: lands in the matching Dashboard thread. A reply to a message the Dashboard does not know creates a new thread.
- **Personas** post as the bot with a custom name `Erkki · Network Expert` and a colored initials avatar (from dicebear.com, so it needs internet access in Slack's servers, which is normal). Each Dashboard thread is one Slack thread: the first message is the root, the rest are replies. Threads from Teams or email get a root prefix such as `[Teams] Subject`.
- **Mirror toggle**: in Settings, turn "Slack mirror" off to stop sending Dashboard messages to Slack. Incoming Slack messages still work.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `invalid_auth` / `not_authed` | Wrong or revoked token. Check `xoxb-` is the bot token and `xapp-` the app-level token; reinstall the app if you changed scopes. |
| `not_in_channel` / `channel_not_found` | The bot is not in the channel or the ID is wrong. Run `/invite @Context Dashboard` and check `SLACK_CHANNEL_ID`. |
| `missing_scope` | The manifest was not applied fully. Compare scopes in **OAuth & Permissions** with `deploy/slack-manifest.yml`, then **Reinstall to Workspace**. |
| Connects, but nothing arrives from Slack | Check **Event Subscriptions** has `message.channels` / `message.groups`, and Socket Mode is enabled. |
| Everything posts as plain "Context Dashboard" | The `chat:write.customize` scope is missing. Add it and reinstall. |
| Messages arrive slowly | Slack allows about 1 message per second per channel. The bridge queues messages and waits on `ratelimited` (Retry-After). A fast simulator speed builds a backlog. |

## Limits

- Personas are not real Slack users. They are bot posts with a custom name and icon, so they cannot be mentioned or DM'd.
- Only text is mirrored (no files, reactions or edits). Edits and deletes in Slack are ignored.
- Slack messages mirrored from the Dashboard are never sent back (no echo).
- One channel only.
