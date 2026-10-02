# Implementation work items

The original handoff remains local and ignored. This board separates implemented code from operational acceptance.

| Task | Implemented work                                                                                                                                                        | Remaining acceptance                                                                             |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| T01  | Node 24/TypeScript project, React build, strict YAML, private env setup, SQLite schema/WAL, lockfile                                                                    | Clean Windows install is BLOCKED: no Windows runner                                              |
| T02  | Private actors, normalized messages, transactional events/checkpoints, ID dedup/update, snapshots, hidden-body-safe replay                                              | Automated local coverage PASS; sustained load NOT_RUN                                            |
| T03  | Reader, transparent overlay and authenticated admin; shared order; no chat input                                                                                        | Browser checks recorded in verification report                                                   |
| T04  | YouTube video resolution, official REST, cursor persistence, server polling interval                                                                                    | Real live reception BLOCKED: credentials/broadcast absent                                        |
| T05  | Full upstream proto pinned; documented missing-import patch; real gRPC client; separate REST cursor and fallback                                                        | Local proto/normalization PASS; live streaming/fallback BLOCKED                                  |
| T06  | CHZZK OAuth state, encrypted atomic rotating token storage, own-channel check, Session API, isolated Socket.IO 2.0.3                                                    | Refresh and socket fixture PASS; live app approval/reconnect/revocation BLOCKED                  |
| T07  | Explicit official SOOP blocker and evidence record                                                                                                                      | BLOCKED: verified official SDK distribution/contract/approval unavailable                        |
| T08  | Optional pinned SOOP receive worker; opt-in gate; verified installed receive/disconnect types; no send API exposed                                                      | Consent-off PASS; repository-to-tarball equivalence and live reception BLOCKED                   |
| T09  | FFmpeg camera/RTMP image and RTMP audio workers; memory-only JPEGs; masks before resize/upload; preview; stale/resolution checks; bounded retry                         | Pixel test PASS; physical OBS Program/Preview acceptance BLOCKED                                 |
| T10  | Responses text/vision with model-requested inspection; Groq Whisper transcripts; API-key token counting and USD budgets; ChatGPT OAuth; scheduling; evidence validation | OAuth, stream, request/payload/cancellation fixtures PASS; real image quality/plan usage BLOCKED |
| T11  | Synthetic merge, immediate AI-only stop, local hide, origin reveal, session lifecycle                                                                                   | Automated local tests PASS                                                                       |
| T12  | Role/Origin checks, retention/deletion, dependency review, operator guide, verification report                                                                          | Live/Windows/long-run acceptance and residual dependency advisories remain open                  |

## Scope decisions

- This is a single local application with logical shared packages, not separately published packages or a distributed service.
- Reconnects use a bounded current snapshot. The store has safe historical event projection, but the browser does not request an unbounded backfill.
- Only ordinary YouTube text, CHZZK CHAT and experimental SOOP CHAT are normalized. Native moderation and non-text events are not claimed.
- Config edits are made in YAML and applied on restart. Admin previews and confirms masks; it does not provide a graphical mask editor.
- The software can verify configured rectangles and fresh frames; the operator must verify Program selection and mask coverage on every scene.
- Model/API and live-account acceptance cannot be replaced by fixtures.
