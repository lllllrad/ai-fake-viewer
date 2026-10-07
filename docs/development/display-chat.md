# Display-only platform chat

Actual YouTube, CHZZK and SOOP messages appear beside AI replies in the live
conversation, reader and OBS overlay. They never enter the AI store or service.
The producer must exclude the combined chat overlay from the dedicated AI stream.

## Setup and operation

Open Broadcast preparation → Viewer chat. Enable the desired platforms, enter the
YouTube video URL/ID (or channel ID for discovery) and SOOP broadcaster ID, then save.
Connect the platform account and start receiving. CHZZK and SOOP use the authenticated
broadcaster's own chat. YouTube also supports an API key for supported read requests.

Developer-app credentials belong in the server's private .env:

- YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET; optionally YOUTUBE_API_KEY.
- CHZZK_CLIENT_ID and CHZZK_CLIENT_SECRET, with chat-read scope.
- SOOP_CLIENT_ID and SOOP_CLIENT_SECRET, with broad_access_chatinfo.

Register the callback for each provider as
http://127.0.0.1:3210/oauth/PLATFORM/callback, substituting youtube, chzzk or soop
and the configured server port. Successful callbacks return to /admin#chat-details.
YouTube authorization requests youtube.readonly; existing broader read-capable
tokens do not enable any sending code.

config.yaml's displayChat section supplies defaults. All three platforms default to
enabled; explicit saved disabled flags remain opt-outs. Accounts and channel targets
are still required before reception can start. UI saves override those
defaults in display-chat.settings.json beside the live database. Encrypted platform
tokens use the existing provider token files in that directory. Stopping reception
does not disconnect the account or stop AI. Platform end/disconnect does not end the
broadcast session. Enabled server receivers start again after server restart or a
new broadcast. Explicit broadcast end closes all receivers.

SOOP uses its official browser SDK: keep one administrator tab open. Navigation
between Live and Broadcast preparation preserves the connection. Closing/logging
out of the browser stops reception; server status becomes disconnected after the
heartbeat expires. Starting another SOOP connection invalidates the previous lease.

## Isolation and lifetime

[DisplayConversation](../../packages/infrastructure/conversation/display-conversation.ts)
owns bounded memory for 300 received messages and 1,000 replay identities. No raw
platform messages or identities are written to the AI database. Restart, broadcast
end and data deletion clear this display history. Reconnecting readers receive the
current merged snapshot, with an independent event sequence shared by both message
sources. Local hiding also suppresses recent duplicate delivery.

The AI store retains synthetic messages only. Platform chat cannot affect model
prompts, summaries, viewer state, nickname generation, evidence IDs, selection or
pacing. Its arrival, removal and reconnect do not invalidate model continuation.
AI stop leaves display reception available. Platform connection/account errors are
shown in their own panel, outside AI readiness.

[DisplayChatConnections](../../packages/infrastructure/platforms/display-chat.ts)
has receive/status ports rather than a Store reference. YouTube cursors live in the
receiver's memory; CHZZK subscriptions live in cancellable workers. SOOP events are
authenticated administrator requests bound to the current connection lease. None
of these adapters has a native-platform chat-send method, consent command or notice
sender. The independent test app does not register these routes or receivers.

## External contracts and validation limits

YouTube uses [liveChatMessages.streamList](https://developers.google.com/youtube/v3/live/docs/liveChatMessages/streamList)
with configured fallback to [list](https://developers.google.com/youtube/v3/live/docs/liveChatMessages/list).
REST reception respects the returned polling interval. CHZZK follows the official
[session and chat subscription contract](https://chzzk.gitbook.io/chzzk/chzzk-api/session).
SOOP uses its [browser SDK](https://developers.sooplive.com/docs/chatsdk/overview)
and validates the connected broadcaster before forwarding messages.

Synthetic tests cover projection/AI isolation, deduplication, hiding, session
lifetime, transport cancellation and UI publication. They do not prove developer
app approval, current account permissions, real chat reception or producer-side
video/audio isolation. The app implements no viewer consent workflow; this does
not establish legal or platform-policy eligibility for a particular broadcast.
