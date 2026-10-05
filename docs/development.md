# 개발환경과 검증 명령

저장소 루트의 [run-command.sh](../run-command.sh)는 `mise exec --`와 현재 Linux 브라우저 검증 환경을 한 번에 적용한다. 에이전트 진입 안내는 [AGENTS.md](../AGENTS.md)에 있다. 일반 명령에 긴 환경변수 접두사를 붙이거나 임시 라이브러리 위치를 다시 찾을 필요가 없다.

## 평소 사용하는 명령

```sh
# 문서 링크·설정 예시 검사, TypeScript/Vite 빌드, 단위 테스트
sh run-command.sh npm run check

# 실제 Chromium으로 관리자·리더·오버레이 검증
sh run-command.sh npm run build
sh run-command.sh npm run test:browser

# 문서만 확인 / 변경한 파일만 포맷
sh run-command.sh npm run docs:check
sh run-command.sh npx prettier --write README.md

# 도움말
sh run-command.sh --help
```

브라우저 검증은 `dist/web`를 제공하므로 웹 코드를 바꿨으면 먼저 빌드한다. 테스트는 `127.0.0.1:33219`와 `127.0.0.1:33220`, 메모리 DB, 별도 임시 토큰 경로와 인공 입력을 사용한다. 같은 포트로 브라우저 검증을 동시에 여러 개 실행하지 않는다. 결과 JSON과 스크린샷은 ignored `test-results/`에 저장된다. 실제 방송·유료 모델의 품질을 검증하는 명령은 아니다.

스크립트는 호출한 위치와 관계없이 저장소 루트로 이동한다. 다른 디렉터리에서는 스크립트의 절대 경로를 사용한다. 인자는 `"$@"`로 전달하므로 공백이 있는 인자를 그대로 보존하고 명령의 종료 코드를 반환한다. 셸 문법이 필요한 경우 직접 `sh -c '...'`를 명령으로 전달한다.

## 처음 준비할 때

[mise.toml](../mise.toml)에 고정된 Node 24.21.0을 사용한다. 현재 환경에서는 `npm`이 일반 PATH에 없을 수 있어 래퍼를 사용한다. `mise`는 PATH에서 찾고, 없으면 `$HOME/.local/bin/mise`를 확인한다.

```sh
mise trust
mise install
sh run-command.sh npm ci
sh run-command.sh npx playwright install chromium
```

래퍼는 도구나 시스템 패키지를 자동 설치하지 않는다. 이 저장소의 Linux CI는 [.github/workflows/check.yml](../.github/workflows/check.yml)처럼 `npx playwright install --with-deps chromium`으로 시스템 의존성까지 준비한다. 해당 명령은 OS 패키지 설치를 포함한다. 일반 Linux 개발 머신에서는 이 경로를 사용할 수 있고, 현재 호스트는 아래의 별도 추출 라이브러리를 사용한다. Windows PowerShell에서는 Node 환경을 준비한 뒤 기존 `npm run check`, `npm run test:browser`를 직접 사용한다. `run-command.sh`는 POSIX shell용이다.

## 현재 호스트의 브라우저 환경

2026-10-05 검증에 사용한 위치:

| 항목                   | 위치와 의미                                                  |
| ---------------------- | ------------------------------------------------------------ |
| 추출된 공유 라이브러리 | `/tmp/mixed-chat-browser-libs/root/usr/lib/x86_64-linux-gnu` |
| Fontconfig 설정        | `/tmp/mixed-chat-browser-libs/fonts.conf`                    |
| 글꼴                   | `/tmp/mixed-chat-browser-libs/root/usr/share/fonts`          |
| 글꼴 캐시              | `/tmp/mixed-chat-browser-libs/font-cache`                    |

Linux에서 기본 번들이 존재하면 래퍼는 라이브러리 경로를 기존 `LD_LIBRARY_PATH` 앞에 추가한다. `FONTCONFIG_FILE`이 이미 설정돼 있으면 유지하고, 없으면 번들의 `fonts.conf`를 사용한다. Linux가 아니거나 기본 번들이 없으면 환경변수를 추가하지 않고 시스템 환경으로 실행한다. 번들이 없다고 브라우저 실행 가능성을 보장하는 것은 아니다.

따라서 현재 호스트에서는 다음 두 명령이 같은 브라우저 환경을 사용한다.

```sh
sh run-command.sh npm run test:browser

LD_LIBRARY_PATH=/tmp/mixed-chat-browser-libs/root/usr/lib/x86_64-linux-gnu \
FONTCONFIG_FILE=/tmp/mixed-chat-browser-libs/fonts.conf \
mise exec -- npm run test:browser
```

다른 번들을 쓰거나 시스템 환경만 쓰려면:

```sh
MIXED_CHAT_BROWSER_LIBS_DIR=/absolute/path/to/browser-libs \
  sh run-command.sh npm run test:browser

MIXED_CHAT_BROWSER_LIBS_DIR= sh run-command.sh npm run test:browser
```

사용자 지정 번들은 동일한 `root/usr/lib/x86_64-linux-gnu` 구조를 사용해야 한다. 명시한 경로가 없으면 오타를 숨기지 않고 실패한다. 경로는 절대 경로를 권장하며, 상대 경로는 저장소 루트 기준이다. 빈 값은 래퍼의 자동 주입만 끈다. 호출자가 이미 설정한 `LD_LIBRARY_PATH`와 `FONTCONFIG_FILE`은 지우지 않는다.

이 번들은 Linux x86_64 호스트용이며 저장소에 포함되지 않는다. `/tmp` 정리나 재부팅으로 사라질 수 있다. 다른 호스트로 복사한 라이브러리가 OS와 호환된다고 가정하지 않는다. `fonts.conf`에는 글꼴·캐시의 절대 경로가 들어 있으므로 번들을 옮기면 함께 수정해야 한다.

## 실패했을 때

| 증상                                      | 확인과 조치                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| `npm: command not found`                  | `sh run-command.sh npm ...` 사용. 먼저 `mise` 설치와 `mise install` 확인                   |
| `mise not found`                          | PATH 또는 `$HOME/.local/bin/mise`에 실행 파일 준비                                         |
| Chromium 실행 파일 없음                   | `sh run-command.sh npx playwright install chromium` 실행                                   |
| `libatk-1.0.so.0` 등 공유 라이브러리 없음 | 현재 번들이 남아 있는지 확인. 없으면 OS 의존성을 준비하거나 호환되는 번들을 지정           |
| Fontconfig 경고·글꼴 누락                 | `fonts.conf` 내부 경로와 글꼴 디렉터리 확인. 기존 `FONTCONFIG_FILE`이 자동 설정보다 우선함 |
| UI 수정이 브라우저에 반영되지 않음        | `sh run-command.sh npm run build` 후 브라우저 검증 재실행                                  |
| 33219 포트 사용 중                        | 먼저 실행한 브라우저 검증이 종료됐는지 확인                                                |

현재 번들 안에 다운로드한 `.deb` 파일만 남아 있고 `root/`가 없을 경우, 같은 호스트에서는 `dpkg-deb -x`로 각 패키지를 번들의 `root/`로 다시 추출할 수 있다. 이 작업은 패키지 다운로드나 시스템 설치를 수행하지 않는다. `fonts.conf`와 글꼴도 함께 존재해야 한다. 번들 전체가 없으면 래퍼가 재생성하지 않으므로 위의 의존성 준비 경로를 사용한다.

검증 결과는 [VERIFICATION_REPORT](../VERIFICATION_REPORT.md)에 실행 범위와 함께 기록한다. 실방송 프로세스 관리는 [LIVE_SETUP](../LIVE_SETUP.md)과 `justfile`을 따른다. 래퍼 자체는 `.env`를 읽거나 서버를 시작하지 않으며, 전달한 명령만 실행한다.

## 메모리 전용 운영과 호스트 점검

라이브 채팅·동의·페르소나는 메모리 전용이다. `run-command.sh`는 `ulimit -c 0`으로 일반 core dump를 비활성화한다. 이 제한만으로 OS 오류 수집, 서비스 관리자의 덤프, 컨테이너 스냅샷이나 스왑 기록까지 제어하지 않는다. 운영 전 해당 호스트의 systemd-coredump/오류 보고, swap·암호화, 메모리 스냅샷, 백업 포함 경로를 확인하고 원문이 남는 경로를 끄거나 정책에 맞게 제한한다. 실제 운영 호스트에 대한 이 검토는 아직 수행됐다고 주장하지 않는다.

Fastify body logging은 비활성이고 UI는 채팅을 localStorage/IndexedDB에 저장하지 않는다. SDK debug, 브라우저 개발자 도구의 네트워크 저장, 프롬프트 추적과 외부 오류 수집에 실채팅을 추가하지 않는다. 테스트 산출물은 인공 입력만 사용한다. 실제 운영 요청을 fixture/스크린샷으로 복제하지 않는다.

옛 `database` 파일은 새 앱에서 열지 않는다. 업그레이드 전에 이전 프로세스를 중지하고 지정했던 SQLite 본체/WAL/SHM·transcript export·복구 사본·백업을 식별해 정리한다. 자격증명과 최소 권리행사 DB는 일반 채팅과 목적·수명이 다르므로 일괄 채팅 삭제 대상으로 혼동하지 않는다. 참조 해제와 파일 삭제가 물리 매체의 포렌식 소거를 보장하는 것은 아니다.
