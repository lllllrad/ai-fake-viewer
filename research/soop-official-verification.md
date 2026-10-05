# SOOP contract verification

Checked 2026-10-02. Official and experimental paths have independent statuses.

## Current repository implementation

Code review on 2026-10-05 found an implemented official OAuth and browser SDK path in [packages/soop.ts](../packages/soop.ts), [server routes](../apps/server/app.ts) and [administrator UI](../apps/web/src/main.tsx). The signed-in admin page hosts the SDK and receives messages for the authenticated broadcaster. See the [current setup guide](../README.md#soop-official-chat). This is code evidence, not new verification of the external SDK contract, account approval or live reception.

## Historical official investigation — 2026-10-02

The [official overview](https://developers.sooplive.com/docs/chatsdk/overview) returned no readable detailed contract through the available documentation retrieval. The [getting-started entry](https://developers.sooplive.co.kr/docs/chatsdk/getting-started) is a follow-up location provided by the handoff, not a verified API contract.

| Requirement                                       | Evidence/status |
| ------------------------------------------------- | --------------- |
| Official distribution/version/license/runtime     | Not established |
| Registration and personal broadcaster eligibility | Not established |
| OAuth endpoints/scopes/rotation                   | Not established |
| Constructor/connect/stop methods                  | Not established |
| Message schema/IDs/timestamps/events              | Not established |
| Reconnect/heartbeat/limits/end notifications      | Not established |
| Redisplay/model processing permissions            | Not established |

At the time of this investigation, `mode: official` reported `official_spec_pending` and made no connection. That implementation description is superseded by the official browser SDK path above; the original investigation results are retained as historical evidence.

## Experimental path — implemented, live validation BLOCKED

The [author repository](https://github.com/reindeer002/soop) describes an unofficial library. The installed npm distribution is `soop-extension@1.3.3`, MIT, integrity:

```
sha512-4C6Oc/isKMsCouvCwBHoxjGzwWXG5tZpUpdhHf3XobAVSfrv/cqSGoqk9ImP5Sq8Mwqutcc0XmE6KIu7xwOtYA==
```

Installed declarations confirm `SoopClient.chat({streamerId})`, `SoopChatEvent.CHAT`, `connect(): Promise<void>` and `disconnect(): Promise<void>`. CHAT carries `userId`, `username`, `comment`; no stable source message ID is assumed. `receivedTime` is not treated as the author's publication time. Other event types are ignored.

The npm manifest points at the historical `maro5397/soop` repository whereas the supplied source reference uses `reindeer002/soop`. An exact source-commit-to-tarball equivalence was not established. The lockfile pins the actual distribution integrity; this does not establish platform approval or current live compatibility.

The worker requires explicit experimental mode and consent, never receives passwords, never invokes a chat-send method, and terminates independently. Live connection, end/reconnect behavior and applicable usage conditions need operator verification. No experimental success is reported as official success.

## 2026-10-05 official fixed-notice contract recheck

The public documentation bundle for [send-message](https://developers.sooplive.com/docs/chatsdk/send-message) and the [official SDK distribution](https://static.sooplive.com/asset/app/chat-sdk/sooplive-chat-sdk.js) established `sendMessage(message)` and the `MESSAGE` response event. The [get-message documentation](https://developers.sooplive.com/docs/chatsdk/get-message) describes receiving successful responses through `handleMessageReceived`. The send method does not supply Promise-based success; the app checks an exact fixed-text echo from the authenticated broadcaster. Since ordinary extraction did not return the dynamic page body, the referenced `chatsdk.BKRmx3Wy.js` documentation bundle was also inspected.

The current app automatically sends only fixed participation/stage notices. No real-account send was performed; SDK fixtures verify calls, responses and failures. Actual permissions and quotas remain operational checks. Historical statements that the send contract was unconfirmed or the sender unimplemented do not describe current code. No unofficial sender or native-platform AI publication was added.
