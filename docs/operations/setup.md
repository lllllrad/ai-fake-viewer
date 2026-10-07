# Live input setup

## AI-only stream mode

Prepare a separate feed containing the intended screen and microphone, excluding
viewer chat, donation messages and notifications. The app consumes a playback URL;
it does not create an RTMP ingest server or configure OBS output.

```yaml
input:
  mode: ai_stream
  streamUrl: rtmp://STREAM_HOST:1935/live/ai
ai:
  provider: chatgpt_subscription
audio:
  provider: groq
  chunkSeconds: 10
```

RTMP and RTMPS are supported. The same URL supplies video and audio. A missing or
disconnected feed never falls back to another source. The first audio track must
already contain the intended microphone. Capture masks apply before preview and
model upload; they do not alter the original broadcast output.

## Install and configure

Use [the development guide](../development/guide.md) and
[example configuration](../../config.example.yaml):

```sh
sh run-command.sh npm ci
sh run-command.sh npm run setup
sh run-command.sh npm run build
sh run-command.sh npm run setup:check
sh run-command.sh just server-start
```

Keep .env, config.yaml and encrypted accounts private. Preserve existing
ADMIN_TOKEN, READER_TOKEN and TOKEN_ENCRYPTION_KEY when updating an installation.
setup:check reads local settings without refreshing accounts or calling providers.

Use Sign in with ChatGPT in Broadcast preparation, connect an account and select
an available model. Alternatively set ai.provider to openai_api and provide
OPENAI_API_KEY and OPENAI_MODEL. API-key inference uses https://api.openai.com/v1.
Changing the account or model stops generation and invalidates pending context.

Speech uses OPENAI_API_KEY for audio.provider: openai or GROQ_API_KEY for groq.
Sign in with ChatGPT does not supply a transcription key. The default framing is
10 seconds, with silence suppression and partial-stop discard.

## Broadcast operation

Open http://127.0.0.1:3210/admin and authenticate with ADMIN_TOKEN. Broadcast
preparation contains Viewer chat, Screen/audio, AI account/model and Reader/OBS tabs. Verify
the preview and recognized speech, then enable AI from Live. Emergency stop remains
available during other operations. Manual approval, when configured, exposes a
candidate to publish or discard.

Generated messages appear locally. YouTube, CHZZK and SOOP chat can appear alongside
them through [display-only chat connections](../development/display-chat.md).
Viewer participation, consent notices and rights-management APIs remain removed. Reader and overlay
links use the independent reader token. Use the overlay link as an OBS Browser Source.
LAN reader access is optional; administrator access remains loopback-only.

## Broadcast restart and end

Use just server-status, server-restart and server-stop through run-command.sh.
Restart preserves the session and AI enabled intent. Recovery waits for current
input/account readiness. Explicit stop preserves the conversation but turns AI off.

Broadcast end erases ordinary session content and AI state, leaves a durable closed
marker and keeps model credentials. New broadcast starts with fresh data and AI off.
A disconnected stream does not automatically end the session; use the end control.

## Updating an older installation

Remove retired youtube, chzzk, soop and privacy sections and ai.gate from private
config.yaml. input.mode only accepts ai_stream. Keep input.streamUrl and existing
model/audio settings. The app intentionally rejects obsolete configuration instead
of silently enabling an alternate input path.

Live storage continues to append .ai-stream to database. This preserves sessions
created by the dedicated-stream implementation and keeps older mixed-chat databases
unopened. Old databases, rights records and exports are not automatically deleted or migrated
into model context. Existing platform tokens may be reused by display-only connections. Archive or delete them
separately according to your retention needs; see [storage](../development/storage.md).

## Troubleshooting and limits

Missing stream address blocks AI start. Receiving video and recognized speech are
reported separately. Inspect FFmpeg availability, the playback address and audio
track if either stays disconnected. No alternate feed is selected on failure.

Generation records calls and token usage without a call-count ceiling. Token limits,
optional verified-price monetary caps, speech request limits and pacing remain.
Authentication or model failures appear next to AI controls. Detailed test call
inspection is on port 3211, independently of the live app.

The app cannot prove that a feed is sanitized. Anything visible or spoken, including
chat read aloud, may reach transcription/model providers. Source masking and audio
mixing must be checked on the producer. This guide makes no claim about legal or
provider-policy eligibility. External copies and provider records are outside local
session deletion.
