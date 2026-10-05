# Privacy, participation and withdrawal implementation

Reconciled with the 2026-10-06 local requirements delta, which takes precedence over the earlier `02_implementation_requirements.md` v1.0. Private input files and unavailable policy/review documents are not reproduced in the public repository. This document does not certify actual approvals, legal bases or the anonymity of particular summaries.

## Current operating boundary

Live processing sends consented chat and explicitly enabled broadcast transcripts to the **OpenAI Responses API**, using either an API key or **Sign in with ChatGPT** for eligible ChatGPT plan usage. Authentication/contract selection is explicit. No automatic fallback to another service, Groq, Jev or unofficial SOOP is allowed. Screen input remains disabled. Broadcast audio is separately opt-in; it is not automatically matched to individual viewer consent. Demo and legacy standalone libraries are separate from live operation.

Operators populate `privacy` with actual public information, notice versions, overseas-processing basis A/B, provider model/countries/retention/subprocessors/evidence, video channels/periods and platform receipt/notice/publication/external-AI approvals. Software does not infer approval from configured booleans. Defaults are unconfirmed; the [example configuration](../config.example.yaml) is not an approved deployment profile.

## Participation and guidance

Participation is keyed by platform, broadcaster, app stream session and original platform user ID. States are `UNCONSENTED → WAITING_CONSENT → ACTIVE`, with `WITHDRAWN` from any stage and full clearing on session end. Nicknames do not identify consent, and consent is not shared across platforms or sessions. Exact localized consent, withdrawal and status commands are defined in [participation.ts](../packages/participation.ts).

The first exact consent command begins guidance. Self-declared age 14+, collection/use, live/recorded/VOD/edited-video publication, overseas processing and any third-party provision are separate stages. Each must be delivered before a fresh consent command advances it. Current operation targets self-declared 14+ users, recorded as `self_declared_14_plus`. Neither a chat command nor platform membership is age verification. Known under-14 users or contradictory declarations are blocked. There is no guardian-consent verification workflow, so those users cannot participate or remove the block through their own commands, withdrawal or profile changes. This is an operating procedure, not a claim of universal legal age-verification requirements.

Quoted commands are ordinary text, not consent. Uncertain event timestamps/IDs never automatically grant consent; administrators can confirm only the exact newly observed command within 60 seconds. Old/duplicate events cannot reactivate users. Participation accepted through manual ordering assistance must be renewed after that platform connection is lost.

Unconsented ordinary text is discarded after command/notice classification. Only notice-needed state remains in memory. SOOP sends the fixed non-display/participation introduction through the official SDK `sendMessage(message)` and automatically sends each stage after the viewer starts participation. Confirmed introductions do not repeat for later ordinary chat or admin reconnection within the same session. Failed/unconfirmed delivery may retry within limits. A new session or server restart clears notice history. SOOP, YouTube and CHZZK have no operator delivery-completion button; actual-command ordering assistance is a separate function.

Account intervals and global per-minute limits reserve attempts before sending and include failures. Defaults of 30 seconds/two attempts per minute are app settings, not platform-guaranteed quotas. Confirm actual permitted limits. SOOP admin tabs share a 15-second dispatch lease, preventing concurrent duplicates, and poll pending work every second. Unconfirmed delivery does not advance consent. Own/configured bot accounts and withdrawn participants do not trigger unsolicited guidance.

SOOP method return is not delivery proof. A nonidentifying random notice code and exact fixed text must return as a MESSAGE from the authenticated broadcaster. The app rechecks session, profile, consent generation and stage before recording delivery time. Copied text from another account, old responses and timeouts cannot open the next stage. Closing/disconnecting the admin tab stops SOOP sending. No endpoint can send arbitrary raw chat or AI replies.

Official contracts: [SOOP send-message](https://developers.sooplive.com/docs/chatsdk/send-message), [get-message](https://developers.sooplive.com/docs/chatsdk/get-message). Scope is recorded in [SOOP research](../research/soop-official-verification.md). Actual app approval and live delivery require operational acceptance. Status commands expose state to the administrator; unsupported private-message capabilities are not assumed.

## Raw text, summaries and races

Command classification and consent checks run before storage, display or summarization. Raw text exists only in memory SQLite. Public DTOs recheck current consent generations. Actual platform nicknames and synthetic persona names are visible from the start: no temporary display-name generation or end-of-session name restoration. Disclosure changes origin/AI labels only. Duplicate nicknames remain distinct by platform user ID. Model author metadata contains opaque session speaker keys, not original account IDs, nicknames or consent records. This does not guarantee removal of personal information within message text itself.

Withdrawal synchronously invalidates consent, removes old raw text, identifiable derived context, mappings, pending drafts and caches, and cancels requests. Late responses are discarded. Profile/generation/message permission is rechecked before token counting and transmission. Already transmitted provider requests are not described as remotely canceled or erased. AI output with recorded direct or indirect dependencies is removed conservatively.

The anonymous area permits only fixed local topic/mood labels. Each label requires support from at least three distinct currently consented recent human accounts. No direct quotes, personal stories, rare events/times/places, links, contact details, nicknames, message IDs or provenance maps are retained there. This restriction is not legal anonymity certification; clear categories through the admin reset if identification is a concern. Categories approved before withdrawal can remain in the current session, but withdrawn text never enters a new summarization request. Session end deletes this area too.

## Storage lifetime and rights requests

The live Store uses only `:memory:`. Chat, participation, mappings, cast, reactions, summaries, budgets and pending work do not recover after end/restart. When audio is explicitly enabled, authenticated session transcript export is available; downloaded copies are outside automatic session deletion. Legacy chat databases are not opened; operators identify and clean old databases/exports/backups during [migration](../README.md#storage-and-deletion).

The separate `privacy.rightsDatabase` contains only minimal account/session/video scope, relevant provider request IDs, optional contact and handling status. It excludes raw chat/general participant lists and is never model input. File access is owner-only. Withdrawal creates follow-up work after local raw deletion when publication or external requests occurred. Failed persistence retries from session memory with an unsaved-task warning. Forced shutdown during persistent disk failure can lose unsaved work; resolve that warning before shutdown.

States distinguish intake, identification, app completion, pending external/video work and completed/limited outcomes. App, provider, video and original/edited/reuploaded copies must be checked independently before closure. Operators perform actual actions, notify outcomes and remove unnecessary resolved records. Post-session intake remains available through public contact with minimal identifying information; no additional registration or ID-document field is required. Optional content inventory is not a permanent per-viewer statement index. Long-term VODs are not automatically deleted.

HTTP body logging is disabled; browser localStorage/IndexedDB does not retain ordinary chat. Reports/screenshots use synthetic input. The wrapper disables ordinary core dumps; OS dumps, swap and backups require separate [host review](development.md). Memory release is not a forensic-erasure guarantee.

## APIs and ownership

| Boundary                           | Code / admin API                                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Profile and invalidation           | [privacy-profile.ts](../packages/privacy-profile.ts), `GET /api/admin/privacy`, `PUT /api/admin/privacy/profile`                                                                     |
| Commands, age and delivery         | [participation.ts](../packages/participation.ts), `POST /api/admin/privacy/participants/:id/{notice-delivered,confirm-live-command,block-age}`; manual delivery only where supported |
| Projection, raw text and summaries | [storage.ts](../packages/storage.ts), summary reset/hide/session-close APIs                                                                                                          |
| Pre-send authorization             | [app.ts](../apps/server/app.ts), [model.ts](../packages/model.ts), [scheduler.ts](../packages/scheduler.ts)                                                                          |
| Minimal follow-up                  | [rights.ts](../packages/rights.ts), `POST /api/admin/privacy/rights`, `PATCH/DELETE /api/admin/privacy/rights/:id`, `POST /api/admin/privacy/videos`                                 |
| Admin UI                           | [privacy-panel.tsx](../apps/web/src/privacy-panel.tsx)                                                                                                                               |

Profile PUT applies only to the current process; persistent changes belong in YAML. Important changes stop inputs/generation, invalidate old consent and remove raw context. Rights database path changes require restart. Administrator APIs enforce authentication and local/Origin boundaries.

## Acceptance and operational checks

Automated scope is in [privacy requirements tests](../tests/privacy-requirements.test.ts), consent/persona/scheduler tests and [browser checks](../scripts/privacy-browser-check.ts). Dated results belong in [VERIFICATION_REPORT](../VERIFICATION_REPORT.md).

| Acceptance IDs | Implementation/fixture scope                                                                                  | Separate operational review                     |
| -------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| T01–04         | Default denial, exact commands, failed/staged delivery, post-consent messages                                 | Actual notice delivery/event ordering           |
| T05–08         | Account/platform/broadcast/session isolation, stale commands, renewed generations                             | SDK reconnect contracts                         |
| T09–12         | Withdrawal cancellation, late responses, derived output/snapshots, between-request checks                     | Already transmitted provider requests           |
| T13–15         | Fixed categories without provenance, retained approved summaries, raw removal, no external summarization      | Identification risk in actual broadcast context |
| T16            | Forced memory Store, end/new-session clearing, no recovery                                                    | Host shutdown/deployment                        |
| T17            | Logging disabled, browser storage checks, synthetic artifacts, no session recovery                            | Host swap/dumps/backups and SDK logs            |
| T18–20         | Alternative-input/service restrictions, pinned endpoint/model, incomplete-profile denial                      | Actual account region/model/retention           |
| T21–22         | Automatic fixed notices and acknowledgements, bot exclusion, attempt limits/failures, age declarations/blocks | Platform quotas and child-handling procedure    |
| T23–24         | Minimal durable follow-up, independent app/external/video/copy completion, optional content list              | Actual editing/provider requests/notification   |
| T25–26         | Profile-change invalidation and unconfigured-install denial                                                   | Real approvals/public notices                   |

Actual platform approval/quotas, final notices with countries/periods, the basis for minimal nonparticipant processing, child handling, provider account settings and video-rights responsibilities are deployment prerequisites, not supplied approvals. Review [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data); `store:false` and local booleans do not prove actual account settings or provider retention.

## Sign in with ChatGPT

The previous API-key-only scope was extended to explicit API-key or **Sign in with ChatGPT** authentication for the **Responses API**. Match `ai.provider` and `privacy.processing.provider`. For `chatgpt_subscription`, retain the exact configuration value `contract: ChatGPT subscription`, endpoint `https://api.openai.com/v1` and the selected model slug. `OPENAI_API_KEY` / `OPENAI_MODEL` are not prerequisites for this mode. Use the app's account connection and model selector; no Codex CLI token import or execution is involved.

Review actual ChatGPT plan usage countries, retention, sharing settings and notices independently of API-key billing conditions. Raw-text/withdrawal/memory/media guards apply to both modes. Authorization is rechecked after asynchronous token refresh immediately before transmission. See the [official integration](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).

## Requirements delta scope

- Publication review covers actual YouTube/CHZZK/SOOP live, recording, VOD and edited-copy scope/periods. An unconfirmed Google table B or assumed API-equivalent legal relationship is not a blanket video blocker. Required provision/overseas notices and actual channel approvals remain. Screen restrictions remain. Audio scope must be reviewed separately because speech is not automatically matched to viewer consent.
- Automatic video editing, per-viewer indexes and exhaustive causal tracking are not mandatory. Existing content inventory is optional operational support. Rights intake and app/external/video distinctions remain, as do internal cancellation/generation guards against raw-text reuse.
- Public policy wording need not disclose internal queues, generation numbers, cancellation algorithms or every editing method. This is an internal implementation document; final public policy copy was not supplied. Acceptance checks non-persistence, no redisplay/retransmission after deletion and no session recovery. Forensic removal of every hardware remnant is neither a public guarantee nor a success criterion. Host protections remain internal operational review.
- Country, retention and processing-item changes require updated notice text/version and renewed consent. Runtime scope changes with an unchanged `noticeVersion` are rejected. Updating an external document link never automatically expands consent.

## YouTube automatic notices

YouTube uses server OAuth to connect the broadcaster's channel and the official YouTube Live Streaming API `liveChatMessages.insert` for fixed participation guidance. It never sends unconsented bodies, nicknames or AI replies. Validate returned message ID, chat, author and exact text; split long notices and require all parts before opening the consent stage. Each part/failure consumes account/global limits. Confirmed introductions do not repeat for ordinary chat in the same session. The server receiver must run, but the admin tab need not stay open.

After token refresh and before sending, recheck consent generation, profile, target and connected channel. Account mismatch, withdrawal, stop and failed/unconfirmed responses do not advance consent. YouTube manual delivery completion is blocked in API/UI. Only operator OAuth credentials are encrypted on disk; viewer participation remains memory-only. See [YouTube setup and acceptance](../LIVE_SETUP.md#youtube-oauth-and-automatic-notices).

## CHZZK automatic fixed notices

Incoming CHAT events receive a local SHA-256 replay identity from the channel,
sender, provider message timestamp and content. This is not a provider-issued
message ID; the channel ID alone is never a message ID. Consent ordering still
uses the provider timestamp and requires a fresh command after confirmed notice
delivery. Replayed events keep the same identity and cannot advance consent.
Identical events from one sender in the same millisecond are conservatively
treated as duplicates. Missing or invalid timestamps are not replaced with local
receive time. Tests pass raw CHAT payloads through normalization, consent and the
public store snapshot used by the overlay.

The server sends fixed participation introductions and stage notices through the official Chat API while its own-channel receiver is subscribed. It checks the authenticated channel through the User API, applies the same participation/profile/attempt limits, and splits notices into messages of at most 100 characters without truncating URLs. Every part must return a successful response with a nonempty message ID before delivery is recorded. Viewer commands before completion cannot advance consent. Own-channel messages are excluded from viewer input. Confirmed introductions remain suppressed for later ordinary chat in the same session, including receiver reconnects.

Token refresh, identity lookup and response parsing are asynchronous boundaries: cancellation, credentials, target and consent validity are checked before sending and acknowledging. Missing acknowledgement can cause a delayed retry; remote exactly-once sending is not promised. Authentication/permission failures pause retries, and stopping receipt stops sending. No arbitrary-message API or native-platform AI publication is added.

## Durable exception inventory and deletion

All credential and rights administration uses authenticated, local/Origin-restricted admin routes. Reader/overlay credentials cannot access it. Rights database and encrypted token files are owner-readable/writable (`0600`); parent directories are created with `0700`. Deployment must separately restrict any existing parent directory, environment file, encryption key and backups.

| Exception                                               | Persisted fields and purpose                                                                                                                                                                                                                                                                                      | End-of-need handling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unresolved rights requests                              | Request UUID/creation time, platform/account/broadcaster/session, optional contact/video URL/segment, up to 100 distinct provider request IDs, workflow state, separate app/provider/video/copy checks and enumerated outcome. No raw chat, age/consent ledger, ordinary speaker map or general participant list. | Resolve or record the outside-control limitation, communicate the outcome through the published contact procedure, then delete the unnecessary resolved record through the admin DELETE route. Unresolved work is not erased by session close.                                                                                                                                                                                                                                                                |
| Optional video inventory                                | Video UUID, platform, location, broadcast time and publication state. No per-viewer transcript index.                                                                                                                                                                                                             | Keep only for the associated video/rights purpose; after outstanding work ends, retire an unneeded inventory/database through the operator's protected storage procedure. There is no automatic VOD editing/deletion action.                                                                                                                                                                                                                                                                                  |
| YouTube                                                 | Encrypted access/refresh tokens, expiry, authorized channel and OAuth client ID.                                                                                                                                                                                                                                  | Disconnect stops its receiver/sender and deletes the local token file; revoke the grant separately in the provider account when required.                                                                                                                                                                                                                                                                                                                                                                     |
| SOOP and CHZZK                                          | Encrypted access/refresh tokens and expiry. CHZZK authorization state is memory-only.                                                                                                                                                                                                                             | Forget removes the local token file. Disconnecting only the SOOP chat socket is not forgetting its OAuth credentials. Late exchanges/refreshes begun before forgetting cannot recreate credentials.                                                                                                                                                                                                                                                                                                           |
| Sign in with ChatGPT                                    | Encrypted host ID, selected account, per-account client/subject/email, tokens, expiry/refresh timing, scopes and model. Registration/host metadata supports reuse of the authorized registration.                                                                                                                 | Sign-out immediately clears the selected account's access/refresh/ID tokens and selected model locally, then attempts remote revocation; failure to revoke remotely is reported separately. Late work cannot restore cleared credentials. Nonsecret registration metadata and other connected accounts remain. On retiring this integration, disconnect each account and remove the stopped app's token file and obsolete backups; the host ID is intentionally stable while the installation remains in use. |
| API keys, client secrets and app access/encryption keys | Operator-managed environment/configuration outside ordinary chat storage.                                                                                                                                                                                                                                         | OAuth disconnect does not remove externally supplied API keys or `.env` secrets. Stop use, revoke obsolete keys at the provider and remove the protected local configuration/backup copies when no longer needed.                                                                                                                                                                                                                                                                                             |

Deleting app data is not a promise of immediate provider-log deletion, remote grant revocation or forensic removal from RAM/storage. See the [PC01–PC12 evidence map](privacy-review-evidence.md) and [live operational record](../LIVE_SETUP.md#provider-settings-and-live-acceptance-record).

## Operator-reviewed test configuration

An operator who has already reviewed the revised policy scope can explicitly set
`privacy.testReview.reference` (nonempty review evidence) and `checkedAt` (ISO UTC
timestamp) for live testing while descriptive profile fields are being completed.
This optional configuration defers the startup checks for overseas-basis recording,
provider countries/subprocessors/retention/evidence/date, account-setting review
flags, publication metadata and the notice-rate review flag. It does not certify
provider facts, change account data-sharing settings or establish platform approval.
Unknown values stay unknown; the dashboard labels this as a test configuration.
Without this explicit review, the ordinary complete-profile checks still apply.

Operator/contact information, HTTPS policy/notice URLs, notice versions and stage
texts, model/endpoint/provider compatibility and exact broadcaster approvals remain
required. Authentication and API permissions are unchanged. Every viewer still
needs each delivered consent stage followed by a fresh consent command. Withdrawal,
raw-text exclusion and actual account/global notice-rate limits remain enforced.
Changing or removing the review requires a new notice version, invalidating old
participation through the usual profile-update handling. YAML changes require a
server restart and a fresh session. This exception is for explicitly reviewed
testing; completing the descriptive profile remains an operational task.

## Temporary broadcaster participation

YouTube normally excludes the authenticated sender account to avoid responding to
its own notices. The opt-in `youtube.allowBroadcasterTesting` option admits its
ordinary text and consent/withdrawal commands for testing, using the same staged
participation rules. Numbered automatic-notice parts from that account remain
excluded in both REST and gRPC paths, including after restart. Explicit configured
bot exclusions still apply. See the [temporary testing runbook](../LIVE_SETUP.md#temporary-youtube-broadcaster-account-testing).

## YouTube notice acknowledgements during receive continuation

Normal REST polling and gRPC stream continuation preserve the receiver's subscribed
state. A receive-state change does not invalidate an exact successful YouTube
insertion response. Connectivity is required before sending, while response
acceptance checks the unchanged session, target, account, consent generation and
pending notice. Confirmed multipart progress survives a disconnect during token
refresh; sending resumes with the next unsent part. Withdrawal, target changes and
explicit cancellation still reject late responses. All parts must be confirmed
before a fresh consent command advances a stage; a confirmed introduction is not
sent again merely because the receiver reconnects or the timer ticks.

## Single-step test exception

The explicitly requested temporary `privacy.singleStepTest` mode requires operator
review evidence and a new notice version. It replaces the ordinary stage list with
one combined test declaration. A first message schedules its fixed short notice;
a fresh consent command after confirmed delivery records age self-declaration and
activates participation. No automatic or administrator-granted consent is added.
Repeated ordinary chat does not resend a delivered notice. Withdrawal, known child
restrictions, exact-channel permissions and notice quotas remain enforced. YouTube
and CHZZK enforce a one-message size bound; an overlong notice fails without a
partial send. This is an abbreviated testing exception, not a claim that a short
combined declaration satisfies every production consent requirement. See the
[test runbook](../LIVE_SETUP.md#temporary-single-step-consent-test).
