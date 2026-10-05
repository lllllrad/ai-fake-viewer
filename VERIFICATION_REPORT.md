# Verification report

## Evidence scope

This report contains dated historical runs, not a certification of the current checkout. The 31-test initial run and later 46-test update below cover different revisions. Their environment, performance and live-service observations must not be assumed current. As of the 2026-10-05 documentation review, the current code also contains persona P0, consent gating, an official SOOP browser SDK path and automatic AI recovery; these are described in the [documentation index](docs/README.md). Historical statements that the official SOOP implementation was blocked are superseded as implementation descriptions, while live reception remains unverified.

## Development command launcher — 2026-10-05

- Added `run-command.sh`, root `AGENTS.md` and [development instructions](docs/development.md) so repository tools and browser checks can reuse mise and the existing temporary Linux library/font bundle without manual environment prefixes.
- Shell syntax and launcher checks: PASS for repository working directory, arguments containing spaces/metacharacters, default environment, preserving existing library/font settings, system-library opt-out, missing explicit bundle diagnostics and command exit-code propagation.
- `sh run-command.sh npm run test:browser`: PASS with the existing built web assets, Chromium 153.0.8010.12 and no page errors. No manual `LD_LIBRARY_PATH` or `FONTCONFIG_FILE` prefix was supplied.
- Document links/config validation, changed Markdown formatting and whitespace checks: PASS. The wrapper does not provision missing OS dependencies; the guide records that limitation and recovery options.

## Simplified operational status — 2026-10-05

- `npm run check`: PASS, build/documentation checks and **62 tests**. Health aggregation covers healthy transport variants, preparing/stopped/disabled/unknown inputs, partial failures and safe fallback text.
- Browser checks: PASS. Healthy chat shows one `정상` status without platform/transport/count details; a failed platform shows a useful action without its raw error code. Diagnostics start collapsed, and dashboard links open the corresponding controls. Existing AI toggle, reveal, stale-status and mobile checks still pass with no page errors.
- Normal frame ages, request counts, model stages and usage details moved out of the default operational view. Detailed information remains available on demand; input and model behavior is unchanged.

## Operations dashboard — 2026-10-05

- `mise exec -- npm run check`: PASS, documentation/config validation, TypeScript/Vite build and **59 tests**. New control test verifies global AI start arms a live persona, reveal disarms it and clears restart intent, and status reports the reveal flag and generation timestamp.
- `npm run test:browser`: PASS in Chromium 153.0.8010.12 using the existing temporary Linux library/font environment. Verified dashboard precedes Persona studio, three input summaries, reload, missing nested status fields, stale response disabling start, available emergency stop, keyboard AI switch, cancel/confirm reveal, actual reader/overlay `AI 생성` badges, 390px mobile first-screen controls and no uncaught page errors.
- The browser fixture grants explicit viewer consent before chat ingestion. External services and paid models were not used. Browser screenshots and the run report remain ignored under `test-results/`.
- Changed files pass Prettier and `git diff --check`. Automatic restart policy is unchanged and remains a documented gap against the target manual-restart requirement. Live platform, physical OBS and complete accessibility acceptance remain separate.

## Documentation reconciliation — 2026-10-05

- Compared tracked guidance against server startup/readiness, persona contracts/service/generator, scheduler, storage, UI, consent and gate behavior. Added the missing persona reference and an implementation-gap table for the target dashboard.
- `mise exec -- npm run check`: PASS — local document links, TypeScript/Vite build and 58 fixture tests, zero failures/skips. No live service or paid model request was used for this documentation update.
- `npm run docs:check` now also validates `config.example.yaml` against the strict configuration schema. Removed obsolete `capture.enabled`, `audio.enabled` and `policy.*` keys from examples; these previously caused startup validation failure.
- Link-checker positive/negative fixtures: PASS for valid local/reference links, ignored fenced examples, missing files, missing heading anchors and undefined references. External URLs are not fetched.
- Changed-file Prettier checks and `git diff --check`: PASS. Full `npm run format:check` reports existing formatting issues in `packages/model.ts`, `packages/persona/contracts.ts`, `packages/persona/generator.ts`, `packages/persona/service.ts` and `tests/persona.test.ts`; these files were not changed in this documentation update.
- Browser/live-platform/OBS acceptance: NOT_RUN for this update. No application runtime behavior was changed. Remaining dashboard and persona gaps are documented rather than marked complete.

## Result and environment

**Local demo and automated implementation checks: PASS. Complete live-broadcast acceptance: BLOCKED.** No fixture or mock result below represents successful live platform reception or real model vision.

- Date: 2026-10-02 UTC.
- OS: Ubuntu 26.04 LTS, Linux x86_64.
- Runtime: Node.js 24.21.0, npm 11.19.0.
- Browser: Playwright 1.63.0, Chromium 153.0.8010.12, headless.
- OBS: unavailable; version and physical camera behavior not verified.
- FFmpeg: the pinned container FFmpeg published and read a synthetic RTMP H264 stream; controlled executables exercised image and audio workers. The restarted live app later received RTMP audio, but its physical OBS source was not independently verified.
- Lockfile SHA-256: `2f1eb9c6156b5bd7845e8e41c54ec06d80be4e21e96fbd32a5cd0f823fca4b97`.
- `npm run check`: PASS, TypeScript + production Vite build + **31 tests**, zero failures/skips on this Linux host.
- `npm run test:browser`: PASS, no browser page errors. Admin, reader, overlay and 390-pixel-wide admin checks completed.
- Authenticated MediaMTX smoke check: PASS. The approved RTMP container ran with a restart policy on the app PC's LAN and loopback port 1935 during the test. A synthetic H264 publisher connected; a reader without credentials was rejected and a credentialed reader decoded a frame. No actual OBS stream was tested.
- Live server LAN smoke check: PASS. The configured private-LAN `/overlay` and `/health` routes returned 200, while `/admin` returned 403 through that address; admin and generated OBS links returned 200 and the LAN host respectively through loopback. No external OBS PC was tested.
- Actual demo entry point: PASS. HTTP health, authenticated status, three `demo_fixture` inputs, artificial frame reception and initial `ai: stopped` verified. SIGTERM shutdown completed; no demo server is intentionally left running.
- Formatting and whitespace checks: PASS (`npm run format:check`, `git diff --check`). This historical check predates the tracked Korean specifications now under `docs/`.

The environment initially lacked Chromium shared libraries and all system fonts. Test-only libraries and English/Korean fonts were extracted under `/tmp`; no system package installation was performed. Browser checks used `LD_LIBRARY_PATH` and `FONTCONFIG_FILE` pointing there. Initial browser failures were environment failures; the completed run above passed. The browser now bundles Noto Sans KR for Korean chat; the Linux browser check still used a temporary fontconfig setup. A bare headless Linux demo may still emit a fontconfig warning when drawing its optional SVG test-frame label; the artificial shapes and browser-level demo disclosure remain available.

## Measured behavior

The browser fixture verified persistent administrator login after reload, the bundled Korean font, and an actionable CHZZK demo-mode error. It then inserted **12 artificial messages**, waiting for both reader and overlay DOMs after each insertion. The final measured P95 from insertion start (including SQLite ingestion) to both DOM elements being present was **30 ms**. This small sequential local test meets the initial 1-second target but is not a throughput, long-run or production latency guarantee. It excludes platform transmission/polling and real model latency.

Reader and overlay text/order matched. Hidden text did not return after an overlay reload. The overlay's HTML and body backgrounds were transparent; the disclosure remained in the viewport. Script-like chat was rendered as text and did not execute. Manual AI approval published the same mock response to both views. Stopping AI still allowed a subsequent platform fixture to render. No observed duplicates or missing messages in this bounded test.

Screenshots and machine-readable browser timings are generated under ignored `test-results/` by the reproducible browser script. They contain artificial data only.

## Platforms and real integrations

Groq Whisper was checked with a mocked multipart request containing 16 kHz mono WAV, a bounded transcript response and a silent/voiced audio-worker fixture. Transcript persistence across restart, expiry without chat messages, full deletion and administrator-only JSONL export were checked locally. The AI start endpoint reports a specific 409 error when provider review is missing. A browser fixture was isolated from live ChatGPT credentials, and a delta-only completed stream is covered by an automated fixture. Text-first AI made a call without image bytes and made a second image-bearing call only after an `inspect` decision. Both calls counted toward the persisted AI call budget. During live ChatGPT troubleshooting, several small synthetic diagnostic requests used the saved OAuth token directly and therefore did not count toward the app's persisted `ai.maxCalls`; review plan usage separately. The live session's app counter was 5/100 after the fix and manual stop. After the local key and audio input were configured, the restarted live app reported `receiving` with five completed requests and five private transcript rows; the latest row was nine seconds old at inspection. This confirms the end-to-end RTMP-to-Groq-to-SQLite path on this host. Physical OBS source identity, recognition accuracy, longer-run reliability and provider billing remain unverified. The audio request cap is per process and resets on restart.

| Path                         | Contract / fixture result                                                                                                              | Live result | Blocker or limit                                                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| YouTube official gRPC        | PASS: complete official proto loads; request serialization, snake_case enum normalization                                              | BLOCKED     | No API key/OAuth token or target live broadcast; reconnect/fallback not exercised against Google                                       |
| YouTube official REST        | PASS: fixed-host video lookup, normalized text, separate checkpoint; two fixture polls waited at least the supplied 1100 ms            | BLOCKED     | No real broadcast/credentials/quota verification                                                                                       |
| CHZZK official OAuth/session | PASS: top-level token response, encrypted atomic rotation, concurrent refresh single-flight; Socket.IO 2.0.3 local SYSTEM/CHAT fixture | BLOCKED     | No approved client credentials, broadcaster OAuth, scopes or live own-channel session                                                  |
| SOOP official SDK            | BLOCKED                                                                                                                                | BLOCKED     | Official distribution, method/event/auth contract and applicable approval are not established; adapter exposes `official_spec_pending` |
| SOOP unofficial library      | PASS: explicit opt-in gate, version/integrity pin and installed type inspection                                                        | BLOCKED     | No streamer/terms review/live test; exact source-commit-to-tarball equivalence not established                                         |
| OBS Program / RTMP input     | PASS: real JPEG bytes through RTMP-configured capture process; configured ROI becomes black; source-size changes invalidate approval   | BLOCKED     | Local authenticated MediaMTX tested with synthetic frames; no external OBS/physical camera or Studio Mode Program-versus-Preview test  |
| Groq Whisper speech input    | PASS: isolated PCM worker skips near-silence; mocked 16 kHz WAV multipart request, private retained log and admin-only export          | PARTIAL     | Five live responses/log rows observed; physical source, accuracy, sustained operation and billing unverified                           |
| OpenAI API-key image model   | PASS: mock HTTP inspection verifies JPEG data URL, structured output, input counting, `store:false`, no tools                          | BLOCKED     | No key or selected model; no paid call, actual image comprehension or provider billing verified                                        |
| ChatGPT subscription model   | PASS: OAuth PKCE/state/encrypted storage fixture and delta-only streamed completion/image payload fixture                              | PARTIAL     | Account authorization and live text-only decision reached manual approval; image comprehension and sustained plan usage unverified     |

Authentication scopes: YouTube API-key public access or operator-supplied OAuth; CHZZK chat-read and user-information-read for the authorized broadcaster; no SOOP credentials requested. No native chat-write permissions are requested by application flows. See [research/platform-contracts.md](research/platform-contracts.md) for primary sources and [research/soop-official-verification.md](research/soop-official-verification.md) for the separate SOOP evidence.

## Acceptance coverage

| ID  | Automated status | Evidence and practical boundary                                                                                                                                                                                            |
| --- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01 | PASS             | Identical names on three platforms retain distinct actor IDs                                                                                                                                                               |
| A02 | PASS             | Identical text with different IDs, and ID-less CHZZK events, remains distinct                                                                                                                                              |
| A03 | PASS             | Same YouTube source ID is deduplicated                                                                                                                                                                                     |
| A04 | PASS             | Same source ID updates one row without changing display position                                                                                                                                                           |
| A05 | PASS             | Commit-before-publish, rollback/checkpoint consistency and two equal WS streams; reconnect refreshes the current bounded snapshot                                                                                          |
| A06 | PASS             | Hidden body erased; safe historical projection and refreshed view do not expose it                                                                                                                                         |
| A07 | PASS             | Deferred mock response after AI stop is discarded; platform fixture still ingests                                                                                                                                          |
| A08 | PASS             | Stale input pauses AI; manual confirmation/start needed                                                                                                                                                                    |
| A09 | PASS             | Unchanged image with fresh timestamp remains healthy and does not repeatedly infer                                                                                                                                         |
| A10 | PASS             | Fixture input remains untrusted context; no tools or secrets are provided; output/evidence constraints enforced. Real-model injection behavior is BLOCKED                                                                  |
| A11 | PASS             | Text bounds, URL host rejection, plain-text DOM rendering and unsafe output rejection; no arbitrary chat URL fetch                                                                                                         |
| A12 | PASS             | Public DTO/WS excludes private account/source IDs, model usage and credentials; separate administrator authorization required                                                                                              |
| A13 | PASS             | Call/money reservations, restart-persistent call cap, failure reservation and AI-only stop                                                                                                                                 |
| A14 | PASS             | Two concurrent refreshes make one token request; encrypted replacement survives a new auth instance                                                                                                                        |
| A15 | PASS             | Local legacy socket stays open during a short idle interval. Long idle/live heartbeat behavior is NOT_RUN                                                                                                                  |
| A16 | PASS             | Child socket crash leaves parent storage/other ingestion functioning. Full multi-platform outage/recovery soak is NOT_RUN                                                                                                  |
| A17 | PASS             | Platform context default exclusion, model pseudonyms and actual black ROI pixels. Coverage of real scene chat areas is BLOCKED                                                                                             |
| A18 | PASS             | Experimental consent off starts no SOOP child or connection                                                                                                                                                                |
| A19 | PASS             | Instrumented YouTube fixture calls are GET-only; model calls target Responses; socket fixture emits no outbound CHAT event. Native platform message sends observed: 0 in fixture tests; live network acceptance is BLOCKED |
| A20 | PASS             | Unknown config keys, invalid mask bounds, missing money pricing and undocumented context approvals rejected; non-demo failures are not replaced with mock success                                                          |

Additional PASS checks: LAN reader/overlay access with loopback-only administrator and OAuth routes, expired-data cleanup, public reveal field restriction, pending reply invalidation, source resolution change at unchanged resized output dimensions, host/Origin rejection, independent role tokens, token-rotation socket invalidation, overlay disclosure visibility and mobile overflow.

## Requirement completion boundary

| Requirement                                              | Result                                                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| R01: all three real platforms receive chat               | BLOCKED: actual live tests absent; SOOP official implementation needs its contract              |
| R02: AI observes the real broadcast                      | BLOCKED: image pathway implemented/tested, actual OBS + model not available                     |
| R03: permitted real/AI context                           | BLOCKED for full acceptance: implementation filters context; all platform approvals default off |
| R04: AI joins local history                              | PASS with mock image fixture; actual provider path BLOCKED                                      |
| R05: reader and OBS view share order/content             | PASS in Chromium; OBS Browser Source itself BLOCKED                                             |
| R06: immediate AI-only stop                              | PASS locally, including late response cancellation                                              |
| R07: origin/session/timing preserved                     | PASS in SQLite/public-contract tests                                                            |
| R08: platform accounts not replaced by synthetic authors | PASS in normalization and identity tests                                                        |

## Security, cost and policy status

Final `npm audit`: **0 critical, 0 high, 3 moderate** legacy `parseuri` dependency-tree advisories remain. This is **FAIL for a zero-advisory dependency gate**, not a claim that all dependencies are secure. Compatible Engine.IO/parser overrides removed the initial critical/high items without switching CHZZK to unsupported Socket.IO 4.x. See [research/dependencies.md](research/dependencies.md).

The automatic-publication and blind-display update passed `npm run check` (build plus 46 tests), including WebSocket delivery, reconnect snapshots, administrator message projection, explicit reveal, and persistence across database restart. The updated browser check could not launch Chromium on this host because `libatk-1.0.so.0` is missing; browser rendering for this update remains unverified.

Messages now publish automatically by default. Reader, overlay and the admin conversation use uniform pseudonyms and hide message origins until explicit reveal; the general mixed-chat disclosure remains visible. Viewer-count inflation, account creation, participant chat room and native-send features are not provided. Model processing permissions default off; provider review also defaults off. Actual platform/purpose-specific processing and retention review remains **BLOCKED pending the operator's substantive review**. Configuration acknowledgment does not establish legal permission.

No real model was selected or configured. Real provider calls and cost are therefore **NOT_RUN**, not zero-cost evidence. Subscription usage has no local USD estimate; API-key monetary estimates remain unavailable until prices and a verification date are supplied. The mock model used synthetic output and zero fixture usage. Failure/cancellation reservations are intentionally conservative.

Default chat retention is seven days with startup/hourly cleanup; frames and prompts are memory-only. Hidden bodies are removed from stored messages, events contain references instead of historical bodies, and public replay projects current state. Whole-database deletion is implemented; off-application backups, SSD forensic erasure and provider/platform data deletion are outside this application's control.

## Remaining operational checks

- **BLOCKED:** clean Windows install and shutdown; real FFmpeg DirectShow device opening; OBS Studio Mode Program/Preview and masks in each scene.
- **BLOCKED:** separate live YouTube gRPC and REST tests with Korean/emoji text, credential expiry, quota and transport fallback.
- **BLOCKED:** CHZZK own-channel OAuth, real token rotation, permission revocation and fresh-session reconnection.
- **BLOCKED:** verified SOOP official contract/approval; separate experimental package provenance/terms review and live join/end/reconnect.
- **PARTIAL:** Groq live transcription and private logging observed; physical broadcaster audio-track identity, recognition quality and provider billing remain unchecked.
- **PARTIAL:** interactive ChatGPT authorization and a real text-only decision reached manual approval after fixing delta-only stream parsing. Visual decisions, hallucination review, manual moderation rehearsal and sustained plan usage remain unchecked.
- **BLOCKED:** API-key price verification.
- **NOT_RUN:** long-duration simultaneous three-platform soak, queue pressure, process memory and sustained latency benchmarks.
- **NOT_RUN:** GitHub Actions workflows. Windows/Linux build/test and Linux browser jobs are supplied but were not run on GitHub here.

The live two-PC operator procedure is in [LIVE_SETUP.md](LIVE_SETUP.md); data removal and detailed behavior are in [README.md](README.md). T01–T12 implementation status is tracked in [TASKS.md](TASKS.md). These remaining live checks are explicitly not reported as completed.
