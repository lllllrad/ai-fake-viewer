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

## 2026-10-05 공식 고정 안내 발송 계약 재확인

[채팅 메시지 전송 문서](https://developers.sooplive.com/docs/chatsdk/send-message)의 공개 문서 번들과 [공식 배포 SDK](https://static.sooplive.com/asset/app/chat-sdk/sooplive-chat-sdk.js)를 읽어 `sendMessage(message)`와 응답 이벤트 `MESSAGE`를 확인했다. [메시지 조회 문서](https://developers.sooplive.com/docs/chatsdk/get-message)는 성공 응답을 `handleMessageReceived`에서 받는 구조를 설명한다. 발송 메서드는 Promise 성공값을 제공하지 않아 앱은 인증된 방송자 계정의 동일 고정 문구 echo로 확인한다. 일반 웹 문서 추출기는 동적 본문을 반환하지 않아 공개 페이지가 참조하는 `chatsdk.BKRmx3Wy.js` 문서 번들도 확인했다.

현재 앱은 미동의 채팅과 동의 단계에 고정 안내만 자동 발송한다. 실계정 발송은 수행하지 않았고 SDK fixture로 호출·응답·실패를 검증한다. 실제 앱 권한과 허용량은 운영자 확인이 필요하다. 이전 기록의 “발송 계약 미확인/발송기 미구현”은 현재 구현 설명으로 사용하지 않는다. 비공식 sender나 AI native-platform 게시 기능은 추가하지 않았다.
