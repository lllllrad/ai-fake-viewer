# Upstream contract review

Historical external-document review dated 2026-10-02. This is not live-account acceptance or legal permission. Implementation decisions below describe that revision: current public messages are blinded until reveal, and viewer consent now gates storage/display/context with all supported platforms eligible after consent. The old per-platform AI-context approval configuration has been removed; see [current behavior](../README.md#persona-studio-and-viewer-consent).

| Area                 | Primary source                                                                                      | Implementation decision                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| YouTube streaming    | [Official gRPC guide](https://developers.google.com/youtube/v3/live/streaming-live-chat)            | TLS StreamList, metadata auth, full fixed proto, snake_case and string enums                                     |
| YouTube polling      | [Official list reference](https://developers.google.com/youtube/v3/live/docs/liveChatMessages/list) | Fixed Google endpoint, returned polling interval, separate cursor                                                |
| CHZZK sessions       | [Official Session API](https://chzzk.gitbook.io/chzzk/chzzk-api/session)                            | Socket.IO 2.0.3, user-auth session, connected then own-channel CHAT subscription                                 |
| CHZZK authentication | [Official authorization](https://chzzk.gitbook.io/chzzk/chzzk-api/authorization)                    | Top-level token response; general API content envelope; one-time state and rotating refresh                      |
| OBS                  | [Virtual Camera guide](https://obsproject.com/kb/virtual-camera-guide)                              | Operator confirms Program, not Preview                                                                           |
| Capture              | [FFmpeg device documentation](https://ffmpeg.org/ffmpeg-devices.html)                               | Shell-free process arguments and OS-specific device backends                                                     |
| Vision               | [OpenAI image input](https://developers.openai.com/api/docs/guides/images-vision)                   | JPEG data URL input_image; no text-only substitute                                                               |
| Output               | [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)       | Responses text.format JSON schema; validation before local publication                                           |
| Input limit          | [OpenAI token counting](https://developers.openai.com/api/docs/guides/token-counting)               | Count input before generation and reject over-limit requests                                                     |
| Data policy          | [YouTube developer policies](https://developers.google.com/youtube/terms/developer-policies)        | Follow-up operator review required; no legal compliance claim; source labels and model-context default exclusion |

YouTube policy content and account-specific processing permissions are not resolved by a checkbox or a nonempty review reference. Image masking requires actual operator review of all layouts. At that revision, platform AI-context flags defaulted off. This no longer describes the current configuration.

## Remaining behavior limits

No guarantee of complete replay, exact upstream timestamps across platforms, original custom badge rendering, full emote support, native moderation propagation or image-grounded truthfulness. No native chat-writing endpoint is exposed or called by application code. OAuth subscription POST requests are not chat messages.
