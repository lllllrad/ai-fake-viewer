# Live setup for the consent-based profile

This runbook applies to the live application, including separately enabled broadcast inputs. Read the [privacy implementation and acceptance boundaries](../specifications/participation.md) before enabling real input. Actual platform approval, published policy text and provider eligibility cannot be supplied by this repository.

## 1. Prepare the app PC

Use [run-command.sh](../../run-command.sh) and the [development guide](../development/guide.md). Run setup to generate independent private tokens and an encryption key; keep `.env`, `config.yaml` and credential files out of Git. Build before starting. Managed startup ensures the [AI service](../development/ai-service.md)
is available on port 3212:

```sh
sh run-command.sh npm run setup
sh run-command.sh npm run build
sh run-command.sh just server-start
sh run-command.sh just server-status
```

The live workspace is on port 3210; [AI viewer tests](../development/experiments.md)
use a separately configured server on port 3211. Foreground live/demo commands require
starting the AI service first. Stop older managed processes before replacing them;
identify any old databases/exports/backups using [storage and deletion](../../README.md#storage-and-deletion)
without deleting unrelated data automatically.

Review host crash/core dumps, swap, service diagnostics and backup paths. The launcher disables ordinary core dumps; that does not control every OS/service memory capture. Never record live raw input as a test artifact.

## 2. Complete the operating profile

Populate `privacy` in `config.yaml` from the actual operator's decisions:

- Operator, responsible officer, contact, public HTTPS privacy/consent pages and versions.
- A combined short notice links the full age, collection/use, screen/recording/VOD/edited-video publication, overseas and applicable third-party disclosures. Publication notice must explain that actual nicknames are shown from the start and state the actual video retention period. The current operating scope is self-declared age 14+: block known under-14 or contradictory declarations. The app has no guardian-consent verification workflow and does not enable those users through chat commands.
- Reviewed overseas basis A or B; real OpenAI API model, endpoint, countries, subprocessors, retention, evidence and check date; account data sharing disabled and actual settings verified.
- Actual publication platforms/channels, video retention and overseas review, separately from AI transfers.
- Per-platform/broadcaster permissions for receipt, fixed notices, screen publication and external AI, with contract evidence and dates. Confirm allowed notice rates and own/other bot IDs.

Use `sh run-command.sh npm run setup:check` to list local configuration and authorization prerequisites without exposing secrets or calling providers. No blank value means “implicitly approved.” Read the current profile in admin before starting. Profile changes invalidate consent; end the broadcast before changing its consent profile in YAML. The authenticated profile PUT endpoint affects only the current process, not YAML.

If the operator has already confirmed the revised policy scope and explicitly
requests testing before completing descriptive metadata, use the
[operator-reviewed test configuration](../specifications/participation.md#operator-reviewed-test-configuration).
Set `privacy.testReview.reference` to the actual review record and `checkedAt` to
its ISO UTC timestamp; do not invent provider countries or retention values. Keep
real public notices, broadcaster approvals and credentials. `setup:check` reports
this exception; passing local checks does not verify remote API permissions.
Restart after editing YAML. A CHZZK authorization error still requires correcting
the app permissions and reconnecting the account.

## 3. Configure the model and permitted inputs

Choose `ai.provider: chatgpt_subscription` to use the Responses API through Sign in with ChatGPT without `OPENAI_API_KEY` or `OPENAI_MODEL`. Open admin connection/AI details and start the **Sign in with ChatGPT** flow through the account connection control, authorize this app, load available models and select one. Set `privacy.processing.provider: chatgpt_subscription`, `contract: ChatGPT subscription`, endpoint `https://api.openai.com/v1` and the same model slug; review that subscription's actual data handling in the public notice. Saved encrypted app accounts remain reusable. Codex CLI credentials are not imported.

Alternatively select `openai_api`, supply the API key/environment model and use an API contract profile with matching model/endpoint. Keep `ai.gate.enabled: false` for either service. There is no automatic fallback between the two contracts. A provider/model mismatch blocks transmission rather than requiring an API key for subscription users.

Screen ingestion, broadcast audio, OpenAI or Groq transcription and authenticated transcript export use their configured sources. OBS can show the reader overlay. See input setup below. No screen confirmation or `programConfirmed` gate is needed.

## 4. Connect real chat sources

Configure the official receiver credentials and exact registered OAuth callbacks. Set an approval entry for the actual broadcaster identity used by the adapter, not a display nickname. See [README](../../README.md#live-configuration). The SOOP browser SDK requires the signed-in admin page to remain open and the authenticated broadcaster's own live stream. Its runtime endpoint contract and real-account approval need a live rehearsal; do not substitute the unofficial adapter.

The official SOOP SDK automatically sends a fixed participation notice for eligible unconsented viewers. Consent requires one confirmed notice and one fresh individual command; viewers observed while the same notice was readable can share that delivery opportunity. Configure the actual fixed-notice approval and allowed rates, and keep the connected administrator tab open. **Privacy and participation** shows automatic delivery status; SOOP has no manual delivery-confirmation button. A matching MESSAGE echo from the authenticated broadcaster confirms sending, followed by a fresh viewer consent command; merely calling sendMessage or a timeout does not confirm delivery. For SDK events without trustworthy ordering, verify the exact newly received command within its 60-second window; do not approve old retransmissions. No operator-only activation API exists.

SOOP browser requests are bound to the broadcast in which the connection was
opened. After ending a broadcast and opening another, reconnect SOOP from the
administrator page. After a frontend update, reload existing administrator tabs before reconnecting;
SOOP commands require the current broadcast ID and stale clients are rejected. This does not require issuing new
OAuth credentials.

### YouTube OAuth and automatic notices

1. Enable **YouTube Data API v3** in the same Google Cloud project. Create a **Web application** OAuth client. Authorized JavaScript origins may be empty for this server-side flow. Register `http://127.0.0.1:3210/oauth/youtube/callback`, or the exact existing public HTTPS callback origin plus `/oauth/youtube/callback`. Set that identical URI in `youtube.redirectUri` in `config.yaml`.
2. Put the issued `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` in the local `.env`. Enable `youtube.enabled` and configure `youtube.video` or `youtube.channelId`. Restart the server to load them. If the Google app is in testing, include the broadcasting account among its test users. Do not paste the secret into chat or tracked files.
3. In the admin page's connection details choose **Connect YouTube account**, select the broadcasting channel and grant the requested `youtube.force-ssl` scope. Return to admin and start receivers. The connected channel must match the broadcaster resolved from the video; a different channel cannot send notices through this app. OAuth tokens are encrypted in `data/youtube.tokens` with `TOKEN_ENCRYPTION_KEY`, separately from broadcast participation storage. **Disconnect YouTube** stops receipt/sending and removes local tokens; it does not revoke the grant in Google account settings.
4. Complete the normal operating profile and the actual broadcaster's YouTube `receive`, `fixedNotices`, `screenPublication`, `externalAi` approvals. Confirm actual allowed notice rates. OAuth consent by the operator does not replace viewer participation consent. The old `consentNoticeEnabled` overlay toggle is not a sending permission or a way to bypass this profile.
5. A single automatic consent notice uses `liveChatMessages.insert`. The returned ID, live chat, author and exact text must match before recording delivery. Delivery must be confirmed; failures or ambiguous responses do not grant consent. Attempts, including failures, share account/global limits. After confirmed introduction, later ordinary messages and receiver reconnection do not repeat it within the same app session.

Sending is serialized on the server, pauses when receipt stops, and rechecks session, participant, profile and channel after token refresh and immediately before sending. Own-channel/bot messages are excluded from viewer input. YouTube has no manual notice-delivery confirmation button. A 401/403 response pauses retries for five minutes and shows an account/permission/quota issue; ambiguous failures wait at least a minute. A write that succeeded remotely but whose response was lost may be retried; the API integration cannot promise exactly-once remote writes. Long unbroken URLs over the local chunk budget must be shortened in the reviewed notice rather than truncated. No arbitrary-text sending API is exposed.

The YouTube callback sends UTF-8 plain text for both success and failure. A success page confirms saved authorization, not receiver startup or privacy readiness. Return to admin and check the connected channel before starting inputs. Do not replay a callback URL or authorization code to check status; the code/state are single-use. Restart the server after a callback-response encoding fix; existing saved authorization does not require a new login solely for that fix.

Official contracts: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [YouTube message insertion](https://developers.google.com/youtube/v3/live/docs/liveChatMessages/insert). Runtime uses `access_type=offline`, one-use expiring state, PKCE, encrypted refresh credentials and scope checks. Synthetic checks do not establish real account permission, quota or delivery. A Google permission failure requires resolving the account/app configuration; the sender does not fall back to API-key writes.

## 5. Connect OBS and the reader

For a separate private LAN OBS PC, set `network.bindHost: 0.0.0.0` and the app PC's `network.publicBaseUrl`, and allow TCP 3210 only from the intended PC. Admin remains loopback-only. Copy the private overlay link from admin into an OBS Browser Source (for example 600 × 900). The reader token does not grant admin access. Do not publish these access links or expose the server directly to the Internet.

Register the actual destination channel, recording/VOD and edited-copy retention in the publication profile. Add video URLs and local copy locations in **Video and copy inventory**. Long-term VOD publication does not retain app chat logs or authorize extracting them back into AI context.

## 6. Rehearse participation and withdrawal

1. Confirm unconsented ordinary text does not reach admin conversation, reader, overlay or AI.
2. Ordinary viewer activity starts one short guidance notice. After confirmed delivery, each viewer sends one fresh localized consent command; this includes their age declaration. Only subsequent permitted messages appear. Unknown or blocked age cannot activate participation. The [consent policy](../../packages/domain/participation/consent.ts) defines exact commands and ordering.
3. Start AI manually. Six synthetic personas are generated automatically. Verify local reader/overlay publication; no native-platform AI sending exists.
4. Send the withdrawal command. Verify local disappearance, cancelled pending replies and a separate external/video follow-up task where relevant. No email resubmission is required for this live request.
5. Verify the participation-status command, reconnection snapshots and a new session requiring new consent. Do not infer SDK event-order guarantees from synthetic tests.
6. Close the session. Chat, mappings, consent, personas and summaries disappear. Restart during an open broadcast restores participants and enabled AI; restart after broadcast end restores neither.

## 7. Video requests and shutdown

Accept post-session requests through the published contact, then record only the account/session/video location and optional reply contact in admin. Verify the target without unnecessary ID documents. Perform appropriate masking, muting, segment removal, unpublishing or deletion on the platform and all controlled local/edit/reupload copies. Request provider/platform action where direct control is unavailable, and communicate actual results or limitations. Only close as complete after app, provider, video and copy actions are separately confirmed. Remove resolved request information once unnecessary.

A detected broadcast end closes the session. If the connection is uncertain, the displayed connection warning is not proof of end: confirm the stream status and use **Close session** when finished. Use **Emergency AI stop** for generation only, **Stop all inputs** for receiver control and session close for clearing participation/context. Check any failed follow-up persistence warning before shutting down.

## CHZZK automatic participation notices

In the CHZZK developer application, enable chat-message receipt, chat-message sending and user-info lookup permissions, then authorize the broadcaster's own account again if its previous grant lacks them. In admin, expand connection/AI details and use the account connect/reauthorize button directly below the CHZZK status and registered callback in Live setup. It remains available with saved authorization. After changing `.env`, restart the server first so the new client credentials are loaded; saved-token status is not proof that current permissions were granted. Set `CHZZK_CLIENT_ID`, `CHZZK_CLIENT_SECRET`, the registered `chzzk.redirectUri` and `chzzk.enabled`. Complete the matching broadcaster's reviewed `privacy.approvals`, including `fixedNotices`, and confirm allowed notice rates. Start receivers; sending runs on the server without keeping admin open.

The sender verifies `/open/v1/users/me` against the subscribed channel before posting fixed text to `/open/v1/chats/send`. CHZZK limits each message to 100 characters; long notices are split and every part must return a message ID. Each part consumes the configured rate allowance. Unbroken URLs exceeding the local 70-character content budget need a shorter reviewed URL; they are never truncated. No manual delivery-completion control exists. A confirmed introduction is not repeated for later ordinary chat in the same session. Consent still requires fresh stage commands.

Admin participation status shows connection, approval, sending and delivery problems. HTTP 401/403 pauses sending for five minutes; ambiguous failures wait at least one minute. Resolve missing permissions by updating the app permissions and reconnecting. Receipt can work even when sending permissions are absent. No real-account delivery is established by synthetic tests.

Official references: [Chat API](https://chzzk.gitbook.io/chzzk/chzzk-api/chat), [User API](https://chzzk.gitbook.io/chzzk/chzzk-api/user), [Session API](https://chzzk.gitbook.io/chzzk/chzzk-api/session).

## Provider settings and live acceptance record

Before claiming readiness for real processing, keep a private, dated operational record for the actual deployment. A manual review is sufficient; the app does not continuously inspect provider policy or account settings. Do not put tokens, real chat, viewer details or screenshots of private conversations into tracked verification reports.

Record the reviewer/date, selected API-key authentication or Sign in with ChatGPT account/workspace reference, model and endpoint, current public policy/consent versions, and the applicable training/data-sharing and retention settings with their actual evidence location. `store:false` disables response storage for these requests; it does not establish training opt-out, zero provider logs, or the selected workspace's policy. Successful login and profile checkboxes are not evidence of the external settings. Recheck when account/workspace, provider terms or processing scope changes; update notices and invalidate incompatible consent before use.

For each enabled platform, record the actual broadcaster identity, application permissions, notice-send permissions and limits, verified delivery/retry behavior and event ordering. Exercise a synthetic participation/withdrawal sequence in a permitted operational rehearsal and separately verify the published post-session contact reaches the responsible operator. Record app deletion, provider follow-up, public video and controlled copies as distinct outcomes or limitations. Leave an unchecked item explicitly pending; automated fixture results cannot complete it.

Match the final published policy to the enabled profiles, transmitted fields, displayed real nicknames and declared countries/periods. The review addendum is not the revised public policy itself; no equality with unavailable public-policy text is claimed. Use the [evidence map](../specifications/behavior.md) for code/test ownership and the [exception inventory](../specifications/participation.md#durable-exception-inventory-and-deletion) for retention/deletion procedures.

## Broadcast audio and transcription

Configure `audio.url` and select the speech provider independently of `ai.provider`:

```yaml
audio:
  provider: openai
  url: "rtmp://127.0.0.1:1935/program"
  language: ko
```

OpenAI uses `whisper-1` through the [Audio Transcriptions API](https://developers.openai.com/api/docs/guides/speech-to-text)
and requires a private `OPENAI_API_KEY`. Sign in with ChatGPT does not supply
transcription credentials; no `OPENAI_MODEL` is needed for speech. The same API
key may also be used for AI generation in API mode.
To keep Groq, set `audio.provider: groq` and supply `GROQ_API_KEY`;
it uses `whisper-large-v3-turbo`. Omitted `audio.provider` defaults to Groq
for existing configuration compatibility; the example configuration selects OpenAI.
There is no automatic provider fallback. Missing credentials for the selected
provider require configuration even when the other provider has a key.
No additional privacy enable flag is needed.
Restart with `sh run-command.sh just server-restart`; the configured input starts
automatically, and admin audio controls can stop/start it. Speech chunks use the
selected transcription adapter; recent transcripts can supply AI evidence
without a camera or new viewer chat. AI generation requires an enabled AI toggle, which survives restart.
The dashboard shows the current transcript and an authenticated export link.

This scope includes broadcast speech, not only consented platform chat. Update the
actual audio/provider notice and give profile changes a new `noticeVersion`.
There is no automatic speaker identification or filtering of chat read aloud.
Withdrawal/context invalidation conservatively erases all session transcripts and
aborts in-flight transcription; further captured speech is new input. Session
end also erases records; restart restores them. Downloaded JSONL files and provider-side records
remain separate operator-managed copies. Use the audio stop control to stop transcription; missing configuration is reported rather than silently disabling it.

## Consent and notice delivery

Use a separate viewer account: the broadcast channel account and configured bots are excluded.
An ordinary first chat schedules one short notice with the full notice URL. After
confirmed delivery, one fresh consent command enables subsequent chat. Viewers
observed in the room within five minutes of that delivery share the notice; they
still consent individually. Unknown later arrivals receive guidance when needed.
Do not shorten the URL by truncation: use an appropriate public notice URL if the
100-character CHZZK message cap cannot accommodate it.

Account/global rate limits apply to attempts, including failures. Delivery runs on
a timer without further viewer messages. Restart retains delivered guidance and
consent. There are no broadcaster-account, multistage-consent or forced-AI-reply
test modes. Use normal viewer accounts and synthetic fixtures for verification.

## Broadcast restart and end

If startup fails, the server closes resources already opened during initialization,
including the HTTP listener, started inputs and both databases. A failure starting
inputs after the port opens also closes that listener. This cleanup does not end the
broadcast or erase its saved state. Correct the reported configuration, file
access or input error and retry through `sh run-command.sh just server-start`;
do not delete the broadcast database to work around a startup error.

`database` selects the private SQLite broadcast state file. Keep it on persistent
local storage, outside tracked files and public static directories. Server restart
restores chat, consent, notices, personas, counters and the AI enabled setting.
AI waits for required inputs/model authentication before resuming. Stopping AI
explicitly preserves the off setting on restart. Temporary disconnection does not
end a broadcast. Use the broadcast-end control when the stream has ended; it
purges local session state. A closed broadcast remains closed after restart.
Start a new session explicitly for the next broadcast.

Keep the same privacy profile while recovering a broadcast. If YAML changes its
consent fingerprint, startup rejects reuse of the saved consent. End the old
broadcast before applying a changed profile. The old memory-only implementation
cannot recover data that it never saved; durability starts with this version.

## OBS Program video input

Configure the intended OBS Program source directly under `capture`. For the existing remote stream, keep `capture.backend:
rtmp`, its private reader URL and the configured FFmpeg wrapper. Start OBS streaming
and check the administrator preview. For a local virtual camera, configure the
platform capture backend/device and select OBS Program output.

`ai.visualMode: continuous` includes recent frames automatically; `on_request`
provides them only when the model requests inspection. Capture starts from its configured source, independently of this inference mode. New frame selection requires frames under ten seconds
old; already selected evidence remains valid for at most thirty seconds while
generation/review completes. Frames stay in memory. Withdrawal/context reset clears
them and rejects pre-reset frames arriving late. The application cannot remove
unconsented content embedded in an upstream video; the reviewed Program source
must provide the intended content. No mask-confirmation step is required.

## Background maintenance errors

Server logs use `server_maintenance` records for `retention` and `ai_recovery`
failures. `failed` identifies a failed local cleanup or recovery attempt; repeated
failures of the same task do not repeat the log. The server stays available and
retries at the next normal interval (hourly retention, one-second AI recovery).
`recovered` means that task completed without an exception, not that AI is now
running or all input/provider connections are healthy. Check the dashboard for
actual AI/input status. Persistent failures require checking local database access
and storage health. Stopping the server cancels both tasks before closing storage.

## Automatic viewers and quiet periods

Enabling AI prepares six synthetic viewers automatically. The broadcast page's
cast overview shows their names, motivations and participation styles; no brief,
audition or persona approval is required. Turning AI off/on or restarting the
server reuses the current broadcast's cast. Ending the broadcast clears it.

Six viewers do not imply six replies, or a guaranteed reply to a direct question.
Selection considers fresh observed context, presence, individual cooldowns and
speech propensity. Busy human chat reduces AI participation, and the model may
choose silence. If no response appears, inspect input health and AI diagnostics
for the current phase, skip/rejection reason and usage limits. Manual message
review, when configured, requires publishing the waiting draft; it is separate
from persona creation. See the [persona contract](../specifications/personas.md)
and [AI diagnostics](../development/ai-pipeline.md).

## Effective configuration and API limits

There are no privacy enable switches for video or transcription. `capture` selects
the actual source and FFmpeg path; `audio` selects its source, chunking and request
budget. Missing sources, missing credentials, missing frames and missing transcripts
must be visible in status. The configured `ai.visualMode` is honored rather than
silently changed by the participation profile. Platform connection switches remain
optional, and viewer consent/withdrawal remains separate from input configuration.

The dashboard reports API failures by provider and operation. YouTube lookup/chat
receipt is separate from `liveChatMessages.insert` notice transmission. If receipt
hits a limit and notice sending waits for that connection, the UI says so without
claiming that the send API itself reached a limit. CHZZK User API identity lookup
is distinguished from Chat API sending. OpenAI or Groq transcription and OpenAI Responses API
limits are separate from platform chat. App-configured transcription/gate request and model token/cost budgets are
identified as local limits, not provider quota. An ambiguous permission/quota
response remains explicitly ambiguous; the app does not infer that other methods
are usable merely because their quota failure has not been observed.

## Participation policy link

The current privacy-policy and participation-notice link is
[the published policy](https://cafe.naver.com/lllllrad/3). Set both
`privacy.policyUrl` and `privacy.noticeUrl` in local `config.yaml`;
`config.example.yaml` includes this URL. The active broadcast binds its consent
records to its privacy profile, including these links. Changing them while a saved
broadcast exists blocks startup. Keep the previous profile until the operator ends
that broadcast through the app; ending deletes ordinary broadcast data. Then update
the links and restart so displayed policy links and platform guidance use them.
Do not rewrite stored consent records to bypass the profile check.
