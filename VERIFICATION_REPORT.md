# Verification report

## Result and environment

**Local demo and automated implementation checks: PASS. Complete live-broadcast acceptance: BLOCKED.** No fixture or mock result below represents successful live platform reception or real model vision.

- Date: 2026-10-02 UTC.
- OS: Ubuntu 26.04 LTS, Linux x86_64.
- Runtime: Node.js 24.21.0, npm 11.19.0.
- Browser: Playwright 1.63.0, Chromium 153.0.8010.12, headless.
- OBS: unavailable; version and physical camera behavior not verified.
- FFmpeg: the pinned container FFmpeg published and read a synthetic RTMP H264 stream; a controlled JPEG-emitting executable also exercised the capture worker. No external OBS stream was used.
- Lockfile SHA-256: `2f1eb9c6156b5bd7845e8e41c54ec06d80be4e21e96fbd32a5cd0f823fca4b97`.
- `npm run check`: PASS, TypeScript + production Vite build + **25 tests**, zero failures/skips on this Linux host.
- `npm run test:browser`: PASS, no browser page errors. Admin, reader, overlay and 390-pixel-wide admin checks completed.
- Authenticated MediaMTX smoke check: PASS. The approved RTMP container is running with a restart policy on app-PC LAN and loopback port 1935. A synthetic H264 publisher connected; a reader without credentials was rejected and a credentialed reader decoded a frame. No actual OBS stream was tested.
- Live server LAN smoke check: PASS. `10.10.142.3:3210/overlay` and `/health` returned 200, while `/admin` returned 403 via the LAN address; admin and generated OBS links returned 200 and the LAN host respectively through loopback. No external OBS PC was tested.
- Actual demo entry point: PASS. HTTP health, authenticated status, three `demo_fixture` inputs, artificial frame reception and initial `ai: stopped` verified. SIGTERM shutdown completed; no demo server is intentionally left running.
- Formatting and whitespace checks: PASS (`npm run format:check`, `git diff --check`). All seven repository Markdown files are English; the Korean handoff stays ignored under `.local/`.

The environment initially lacked Chromium shared libraries and all system fonts. Test-only libraries and English/Korean fonts were extracted under `/tmp`; no system package installation was performed. Browser checks used `LD_LIBRARY_PATH` and `FONTCONFIG_FILE` pointing there. Initial browser failures were environment failures; the completed run above passed. The browser now bundles Noto Sans KR for Korean chat; the Linux browser check still used a temporary fontconfig setup. A bare headless Linux demo may still emit a fontconfig warning when drawing its optional SVG test-frame label; the artificial shapes and browser-level demo disclosure remain available.

## Measured behavior

The browser fixture verified persistent administrator login after reload, the bundled Korean font, and an actionable CHZZK demo-mode error. It then inserted **12 artificial messages**, waiting for both reader and overlay DOMs after each insertion. The final measured P95 from insertion start (including SQLite ingestion) to both DOM elements being present was **28 ms**. This small sequential local test meets the initial 1-second target but is not a throughput, long-run or production latency guarantee. It excludes platform transmission/polling and real model latency.

Reader and overlay text/order matched. Hidden text did not return after an overlay reload. The overlay's HTML and body backgrounds were transparent; the disclosure remained in the viewport. Script-like chat was rendered as text and did not execute. Manual AI approval published the same mock response to both views. Stopping AI still allowed a subsequent platform fixture to render. No observed duplicates or missing messages in this bounded test.

Screenshots and machine-readable browser timings are generated under ignored `test-results/` by the reproducible browser script. They contain artificial data only.

## Platforms and real integrations

| Path                         | Contract / fixture result                                                                                                              | Live result | Blocker or limit                                                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| YouTube official gRPC        | PASS: complete official proto loads; request serialization, snake_case enum normalization                                              | BLOCKED     | No API key/OAuth token or target live broadcast; reconnect/fallback not exercised against Google                                       |
| YouTube official REST        | PASS: fixed-host video lookup, normalized text, separate checkpoint; two fixture polls waited at least the supplied 1100 ms            | BLOCKED     | No real broadcast/credentials/quota verification                                                                                       |
| CHZZK official OAuth/session | PASS: top-level token response, encrypted atomic rotation, concurrent refresh single-flight; Socket.IO 2.0.3 local SYSTEM/CHAT fixture | BLOCKED     | No approved client credentials, broadcaster OAuth, scopes or live own-channel session                                                  |
| SOOP official SDK            | BLOCKED                                                                                                                                | BLOCKED     | Official distribution, method/event/auth contract and applicable approval are not established; adapter exposes `official_spec_pending` |
| SOOP unofficial library      | PASS: explicit opt-in gate, version/integrity pin and installed type inspection                                                        | BLOCKED     | No streamer/terms review/live test; exact source-commit-to-tarball equivalence not established                                         |
| OBS Program / RTMP input     | PASS: real JPEG bytes through RTMP-configured capture process; configured ROI becomes black; source-size changes invalidate approval   | BLOCKED     | Local authenticated MediaMTX tested with synthetic frames; no external OBS/physical camera or Studio Mode Program-versus-Preview test  |
| OpenAI API-key image model   | PASS: mock HTTP inspection verifies JPEG data URL, structured output, input counting, `store:false`, no tools                          | BLOCKED     | No key or selected model; no paid call, actual image comprehension or provider billing verified                                        |
| ChatGPT subscription model   | PASS: OAuth PKCE/state/encrypted storage fixture and streamed completion/image payload fixture                                         | BLOCKED     | No interactive account consent or live model call; actual plan access and image comprehension unverified                               |

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

Source labels and a permanent mixed-chat disclosure are implemented. No blind-source mode, viewer-count inflation, account creation, participant chat room or native-send feature is provided. Model processing permissions default off; provider review also defaults off. Actual platform/purpose-specific processing and retention review remains **BLOCKED pending the operator's substantive review**. Configuration acknowledgment does not establish legal permission.

No real model was selected or configured. Real provider calls and cost are therefore **NOT_RUN**, not zero-cost evidence. Subscription usage has no local USD estimate; API-key monetary estimates remain unavailable until prices and a verification date are supplied. The mock model used synthetic output and zero fixture usage. Failure/cancellation reservations are intentionally conservative.

Default chat retention is seven days with startup/hourly cleanup; frames and prompts are memory-only. Hidden bodies are removed from stored messages, events contain references instead of historical bodies, and public replay projects current state. Whole-database deletion is implemented; off-application backups, SSD forensic erasure and provider/platform data deletion are outside this application's control.

## Remaining operational checks

- **BLOCKED:** clean Windows install and shutdown; real FFmpeg DirectShow device opening; OBS Studio Mode Program/Preview and masks in each scene.
- **BLOCKED:** separate live YouTube gRPC and REST tests with Korean/emoji text, credential expiry, quota and transport fallback.
- **BLOCKED:** CHZZK own-channel OAuth, real token rotation, permission revocation and fresh-session reconnection.
- **BLOCKED:** verified SOOP official contract/approval; separate experimental package provenance/terms review and live join/end/reconnect.
- **BLOCKED:** interactive ChatGPT account authorization, real image model reacting to distinct visual events, hallucination review, manual moderation rehearsal and API-key price verification.
- **NOT_RUN:** long-duration simultaneous three-platform soak, queue pressure, process memory and sustained latency benchmarks.
- **NOT_RUN:** GitHub Actions workflows. Windows/Linux build/test and Linux browser jobs are supplied but were not run on GitHub here.

Operator setup, local URLs, reauthentication, stop, recovery and data removal are documented in [README.md](README.md). T01–T12 implementation status is tracked in [TASKS.md](TASKS.md). These remaining live checks are explicitly not reported as completed.
