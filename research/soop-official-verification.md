# SOOP contract verification

Checked 2026-10-02. Official and experimental paths have independent statuses.

## Official path — BLOCKED

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

`mode: official` therefore reports `official_spec_pending` and makes no connection. No unofficial fallback is performed.

## Experimental path — implemented, live validation BLOCKED

The [author repository](https://github.com/reindeer002/soop) describes an unofficial library. The installed npm distribution is `soop-extension@1.3.3`, MIT, integrity:

```
sha512-4C6Oc/isKMsCouvCwBHoxjGzwWXG5tZpUpdhHf3XobAVSfrv/cqSGoqk9ImP5Sq8Mwqutcc0XmE6KIu7xwOtYA==
```

Installed declarations confirm `SoopClient.chat({streamerId})`, `SoopChatEvent.CHAT`, `connect(): Promise<void>` and `disconnect(): Promise<void>`. CHAT carries `userId`, `username`, `comment`; no stable source message ID is assumed. `receivedTime` is not treated as the author's publication time. Other event types are ignored.

The npm manifest points at the historical `maro5397/soop` repository whereas the supplied source reference uses `reindeer002/soop`. An exact source-commit-to-tarball equivalence was not established. The lockfile pins the actual distribution integrity; this does not establish platform approval or current live compatibility.

The worker requires explicit experimental mode and consent, never receives passwords, never invokes a chat-send method, and terminates independently. Live connection, end/reconnect behavior and applicable usage conditions need operator verification. No experimental success is reported as official success.
