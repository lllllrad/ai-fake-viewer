# Live setup for the consent-based text profile

This runbook applies to the live application, not historical audio/vision experiments. Read the [privacy implementation and acceptance boundaries](docs/privacy-implementation.md) before enabling real input. Actual platform approval, published policy text and provider eligibility cannot be supplied by this repository.

## 1. Prepare the app PC

Use [run-command.sh](run-command.sh) and the [development guide](docs/development.md). Run setup to generate independent private tokens and an encryption key; keep `.env`, `config.yaml` and credential files out of Git. Build before starting. Stop any older server using a persistent chat DB; identify and remove old chat databases/exports/backups as described in [storage and deletion](README.md#storage-and-deletion).

Review host crash/core dumps, swap, service diagnostics and backup paths. The launcher disables ordinary core dumps; that does not control every OS/service memory capture. Never record live raw input as a test artifact.

## 2. Complete the operating profile

Populate `privacy` in `config.yaml` from the actual operator's decisions:

- Operator, responsible officer, contact, public HTTPS privacy/consent pages and versions.
- Separate 14+ self-declaration (not verified age), collection/use, screen/recording/VOD/edited-video publication and overseas notices; separate third-party notice if needed. Publication notice must explain that actual nicknames are shown from the start and state the actual video retention period. The current operating scope is self-declared age 14+: block known under-14 or contradictory declarations. The app has no guardian-consent verification workflow and does not enable those users through chat commands.
- Reviewed overseas basis A or B; real OpenAI API model, endpoint, countries, subprocessors, retention, evidence and check date; account data sharing disabled and actual settings verified.
- Actual publication platforms/channels, video retention and overseas review, separately from AI transfers.
- Per-platform/broadcaster permissions for receipt, fixed notices, screen publication and external AI, with contract evidence and dates. Confirm allowed notice rates and own/other bot IDs.

No blank value means “implicitly approved.” Read the current profile in admin before starting. Profile changes invalidate consent; restarting with edited YAML clears session data. The authenticated profile PUT endpoint affects only the current process, not YAML.

## 3. Configure the model and permitted inputs

Choose `ai.provider: chatgpt_subscription` to use the Responses API through Sign in with ChatGPT without `OPENAI_API_KEY` or `OPENAI_MODEL`. Open admin connection/AI details and start the **Sign in with ChatGPT** flow through the account connection control, authorize this app, load available models and select one. Set `privacy.processing.provider: chatgpt_subscription`, `contract: ChatGPT subscription`, endpoint `https://api.openai.com/v1` and the same model slug; review that subscription's actual data handling in the public notice. Saved encrypted app accounts remain reusable. Codex CLI credentials are not imported.

Alternatively select `openai_api`, supply the API key/environment model and use an API contract profile with matching model/endpoint. Keep `ai.gate.enabled: false` for either service. There is no automatic fallback between the two contracts. A provider/model mismatch blocks transmission rather than requiring an API key for subscription users.

Screen and audio ingestion are disabled in this profile. OBS can still show the reader overlay, but incoming camera/RTMP images, spoken chat, Groq transcription, transcript export and Jev are unavailable. No screen confirmation or `programConfirmed` gate is needed.

## 4. Connect real chat sources

Configure the official receiver credentials and exact registered OAuth callbacks. Set an approval entry for the actual broadcaster identity used by the adapter, not a display nickname. See [README](README.md#live-configuration). The SOOP browser SDK requires the signed-in admin page to remain open and the authenticated broadcaster's own live stream. Its runtime endpoint contract and real-account approval need a live rehearsal; do not substitute the unofficial adapter.

The official SOOP SDK automatically sends fixed participation notices for unconsented ordinary chat and subsequent consent stages. Configure the actual fixed-notice approval and allowed rates, and keep the connected administrator tab open. **Privacy and participation** shows automatic delivery status; SOOP has no manual delivery-confirmation button. A matching MESSAGE echo from the authenticated broadcaster confirms sending, followed by a fresh viewer consent command; merely calling sendMessage or a timeout does not confirm delivery. For SDK events without trustworthy ordering, verify the exact newly received command within its 60-second window; do not approve old retransmissions. No operator-only activation API exists.

### YouTube OAuth and automatic notices

1. Enable **YouTube Data API v3** in the same Google Cloud project. Create a **Web application** OAuth client. Authorized JavaScript origins may be empty for this server-side flow. Register `http://127.0.0.1:3210/oauth/youtube/callback`, or the exact existing public HTTPS callback origin plus `/oauth/youtube/callback`. Set that identical URI in `youtube.redirectUri` in `config.yaml`.
2. Put the issued `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` in the local `.env`. Enable `youtube.enabled` and configure `youtube.video` or `youtube.channelId`. Restart the server to load them. If the Google app is in testing, include the broadcasting account among its test users. Do not paste the secret into chat or tracked files.
3. In the admin page's connection details choose **Connect YouTube account**, select the broadcasting channel and grant the requested `youtube.force-ssl` scope. Return to admin and start receivers. The connected channel must match the broadcaster resolved from the video; a different channel cannot send notices through this app. OAuth tokens are encrypted in `data/youtube.tokens` with `TOKEN_ENCRYPTION_KEY`, independently of memory-only viewer participation. **Disconnect YouTube** stops receipt/sending and removes local tokens; it does not revoke the grant in Google account settings.
4. Complete the normal operating profile and the actual broadcaster's YouTube `receive`, `fixedNotices`, `screenPublication`, `externalAi` approvals. Confirm actual allowed notice rates. OAuth consent by the operator does not replace viewer participation consent. The old `consentNoticeEnabled` overlay toggle is not a sending permission or a way to bypass this profile.
5. Automatic introductions and consent-stage notices use `liveChatMessages.insert`. The returned ID, live chat, author and exact text must match before recording delivery. All parts of a long notice must be confirmed; failures or ambiguous responses do not advance consent. Attempts, including every part and failures, share account/global limits. After confirmed introduction, later ordinary messages and receiver reconnection do not repeat it within the same app session.

Sending is serialized on the server, pauses when receipt stops, and rechecks session, participant, profile and channel after token refresh and immediately before sending. Own-channel/bot messages are excluded from viewer input. YouTube has no manual notice-delivery confirmation button. A 401/403 response pauses retries for five minutes and shows an account/permission/quota issue; ambiguous failures wait at least a minute. A write that succeeded remotely but whose response was lost may be retried; the API integration cannot promise exactly-once remote writes. Long unbroken URLs over the local chunk budget must be shortened in the reviewed notice rather than truncated. No arbitrary-text sending API is exposed.

Official contracts: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [YouTube message insertion](https://developers.google.com/youtube/v3/live/docs/liveChatMessages/insert). Runtime uses `access_type=offline`, one-use expiring state, PKCE, encrypted refresh credentials and scope checks. Synthetic checks do not establish real account permission, quota or delivery. A Google permission failure requires resolving the account/app configuration; the sender does not fall back to API-key writes.

## 5. Connect OBS and the reader

For a separate private LAN OBS PC, set `network.bindHost: 0.0.0.0` and the app PC's `network.publicBaseUrl`, and allow TCP 3210 only from the intended PC. Admin remains loopback-only. Copy the private overlay link from admin into an OBS Browser Source (for example 600 × 900). The reader token does not grant admin access. Do not publish these access links or expose the server directly to the Internet.

Register the actual destination channel, recording/VOD and edited-copy retention in the publication profile. Add video URLs and local copy locations in **Video and copy inventory**. Long-term VOD publication does not retain app chat logs or authorize extracting them back into AI context.

## 6. Rehearse participation and withdrawal

1. Confirm unconsented ordinary text does not reach admin conversation, reader, overlay or AI.
2. The first consent command starts guidance; exact localized commands are defined in [participation.ts](packages/participation.ts). Deliver each stage and receive a fresh confirmation; age unknown/under 14 stays blocked. Only messages after all stages may appear.
3. Start AI manually. Six synthetic personas are generated automatically. Verify local reader/overlay publication; no native-platform AI sending exists.
4. Send the withdrawal command. Verify local disappearance, cancelled pending replies and a separate external/video follow-up task where relevant. No email resubmission is required for this live request.
5. Verify the participation-status command, reconnection snapshots and a new session requiring new consent. Do not infer SDK event-order guarantees from synthetic tests.
6. Close the session. Chat, mappings, consent, personas and summaries disappear. Restart does not automatically restart AI or restore participants.

## 7. Video requests and shutdown

Accept post-session requests through the published contact, then record only the account/session/video location and optional reply contact in admin. Verify the target without unnecessary ID documents. Perform appropriate masking, muting, segment removal, unpublishing or deletion on the platform and all controlled local/edit/reupload copies. Request provider/platform action where direct control is unavailable, and communicate actual results or limitations. Only close as complete after app, provider, video and copy actions are separately confirmed. Remove resolved request information once unnecessary.

A detected broadcast end closes the session. If the connection is uncertain, the displayed connection warning is not proof of end: confirm the stream status and use **Close session** when finished. Use **Emergency AI stop** for generation only, **Stop all inputs** for receiver control and session close for clearing participation/context. Check any failed follow-up persistence warning before shutting down.
