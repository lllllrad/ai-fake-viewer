# Live setup for the consent-based text profile

This runbook applies to the live application, not historical audio/vision experiments. Read the [privacy implementation and acceptance boundaries](docs/privacy-implementation.md) before enabling real input. Actual platform approval, published policy text and provider eligibility cannot be supplied by this repository.

## 1. Prepare the app PC

Use [run-command.sh](run-command.sh) and the [development guide](docs/development.md). Run setup to generate independent private tokens and an encryption key; keep `.env`, `config.yaml` and credential files out of Git. Build before starting. Stop any older server using a persistent chat DB; identify and remove old chat databases/exports/backups as described in [storage and deletion](README.md#storage-and-deletion).

Review host crash/core dumps, swap, service diagnostics and backup paths. The launcher disables ordinary core dumps; that does not control every OS/service memory capture. Never record live raw input as a test artifact.

## 2. Complete the operating profile

Populate `privacy` in `config.yaml` from the actual operator's decisions:

- Operator, responsible officer, contact, public HTTPS privacy/consent pages and versions.
- Separate age, collection/use, screen/recording/VOD/edited-video publication and overseas notices; separate third-party notice if needed. Publication notice must explain disclosure of original names and the actual video retention period.
- Reviewed overseas basis A or B; real OpenAI API model, endpoint, countries, subprocessors, retention, evidence and check date; account data sharing disabled and actual settings verified.
- Actual publication platforms/channels, video retention and overseas review, separately from AI transfers.
- Per-platform/broadcaster permissions for receipt, fixed notices, screen publication and external AI, with contract evidence and dates. Confirm allowed notice rates and own/other bot IDs.

No blank value means “implicitly approved.” Read the current profile in admin before starting. Profile changes invalidate consent; restarting with edited YAML clears session data. The authenticated profile PUT endpoint affects only the current process, not YAML.

## 3. Configure the model and permitted inputs

Choose `ai.provider: chatgpt_subscription` to use a ChatGPT subscription without `OPENAI_API_KEY` or `OPENAI_MODEL`. Open admin → connection/AI details → **Continue with ChatGPT**, authorize this app, load available models and select one. Set `privacy.processing.provider: chatgpt_subscription`, `contract: ChatGPT subscription`, endpoint `https://api.openai.com/v1` and the same model slug; review that subscription's actual data handling in the public notice. Saved encrypted app accounts remain reusable. Codex CLI credentials are not imported.

Alternatively select `openai_api`, supply the API key/environment model and use an API contract profile with matching model/endpoint. Keep `ai.gate.enabled: false` for either service. There is no automatic fallback between the two contracts. A provider/model mismatch blocks transmission rather than requiring an API key for subscription users.

Screen and audio ingestion are disabled in this profile. OBS can still show the reader overlay, but incoming camera/RTMP images, spoken chat, Groq transcription, transcript export and Jev are unavailable. No screen confirmation or `programConfirmed` gate is needed.

## 4. Connect real chat sources

Configure the official receiver credentials and exact registered OAuth callbacks. Set an approval entry for the actual broadcaster identity used by the adapter, not a display nickname. See [README](README.md#live-configuration). The SOOP browser SDK requires the signed-in admin page to remain open and the authenticated broadcaster's own live stream. Its runtime endpoint contract and real-account approval need a live rehearsal; do not substitute the unofficial adapter.

The official SOOP SDK automatically sends fixed participation notices for unconsented ordinary chat and subsequent consent stages. Configure the actual fixed-notice approval and allowed rates, and keep the connected administrator tab open. **개인정보·참여 관리** shows automatic delivery status; SOOP has no manual delivery-confirmation button. A matching MESSAGE echo from the authenticated broadcaster confirms sending, followed by a new viewer `!동의`; merely calling sendMessage or a timeout does not confirm delivery. For SDK events without trustworthy ordering, verify the exact newly received command within its 60-second window; do not approve old retransmissions. No operator-only activation API exists.

## 5. Connect OBS and the reader

For a separate private LAN OBS PC, set `network.bindHost: 0.0.0.0` and the app PC's `network.publicBaseUrl`, and allow TCP 3210 only from the intended PC. Admin remains loopback-only. Copy the private overlay link from admin into an OBS Browser Source (for example 600 × 900). The reader token does not grant admin access. Do not publish these access links or expose the server directly to the Internet.

Register the actual destination channel, recording/VOD and edited-copy retention in the publication profile. Add video URLs and local copy locations in **영상·사본 목록**. Long-term VOD publication does not retain app chat logs or authorize extracting them back into AI context.

## 6. Rehearse participation and withdrawal

1. Confirm unconsented ordinary text does not reach admin conversation, reader, overlay or AI.
2. First `!동의` starts guidance. Deliver each stage and receive a fresh confirmation; age unknown/under 14 stays blocked. Only messages after all stages may appear.
3. Start AI manually. Six synthetic personas are generated automatically. Verify local reader/overlay publication; no native-platform AI sending exists.
4. Send `!철회`. Verify local disappearance, cancelled pending replies and a separate external/video follow-up task where relevant. No email resubmission is required for this live request.
5. Verify `!참여상태`, reconnection snapshots and a new session requiring new consent. Do not infer SDK event-order guarantees from synthetic tests.
6. Close the session. Chat, mappings, consent, personas and summaries disappear. Restart does not automatically restart AI or restore participants.

## 7. Video requests and shutdown

Accept post-session requests through the published contact, then record only the account/session/video location and optional reply contact in admin. Verify the target without unnecessary ID documents. Perform appropriate masking, muting, segment removal, unpublishing or deletion on the platform and all controlled local/edit/reupload copies. Request provider/platform action where direct control is unavailable, and communicate actual results or limitations. Only close as complete after app, provider, video and copy actions are separately confirmed. Remove resolved request information once unnecessary.

A detected broadcast end closes the session. If the connection is uncertain, the displayed connection warning is not proof of end: confirm the stream status and use **Close session** when finished. Use **AI 긴급 중지** for generation only, **전체 입력 중지** for receiver control and session close for clearing participation/context. Check any failed follow-up persistence warning before shutting down.
