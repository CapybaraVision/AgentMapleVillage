# 아키텍처

## 한 줄

메이플스토리 월드의 서버 스크립트는 공개 HTTPS 릴레이만 호출합니다. 집 PC의 커넥터가 같은 릴레이를 밖으로 폴링해서 명령을 가져가고, 로컬에서만 시뮬 또는 Claude Code를 실행합니다.

```text
플레이어 UI (클라이언트 mLua)
        |  실행 공간 호출 (크리에이터에서 미검증)
월드 서버 VillageRelay
        |  HttpService:PostAndWait  HTTPS 443
        v
릴레이  (인증, 큐, 이벤트 로그, 마을 격리)
        ^
        |  커넥터가 주기적으로 POST /v1/connector/poll
집 PC 커넥터
        |
        +-- 시뮬 백엔드 (기본, 모델 호출 없음)
        +-- Claude Code 드라이버 (기본 꺼짐, 승인 전 프로세스 시작 안 함)
        +-- agent-desktop 어댑터 (기본 꺼짐, 소켓 없음)
```

메이플 서버는 플레이어 PC의 `127.0.0.1`에 닿을 수 없습니다. 그래서 인바운드 포트 포워딩이나 릴레이의 원격 셸은 만들지 않습니다.

## 조사한 AgentCraft Foreman

기준 커밋은 `CapybaraVision/agentcraft`의 `941170544b5298458928b3adcb50640ffaf498f1`입니다. 라이선스는 MIT입니다. 소스 파일은 복사하지 않았습니다.

확인한 실제 API:

- 프로토콜 버전 1. 웹소켓 한 프레임에 JSON 하나. 클라이언트 메시지는 `hello`, `goal.submit`, `user.message`, `decision.answer`, `task.action`, `agent.action`, `diff.request`, `repo.add`입니다.
- 서버는 `snapshot` 이후 `agent.upsert`, `task.upsert`, `decision.upsert`, `goal.upsert` 등을 흘립니다.
- 결정 종류는 `question`, `permission`, `merge`입니다. 권한 선택지는 Allow once / Always allow for this agent / Deny입니다. 머지 선택지는 Merge / Request changes / Reject입니다.
- 상태 디렉터리는 프로필 아래 `state.json`입니다. `sessions[sessionKey].sessionId`에 Claude 세션을 저장합니다. 세션 키는 `${agentId}:${taskId}` 또는 `${lead}:${goalId}`입니다.
- `ClaudeEngine.runTurn`은 `@anthropic-ai/claude-agent-sdk`의 `query()`에 `resume`을 넘기고, 스트림의 `sessionId`를 `onSession`으로 기록합니다.
- Foreman 서버는 `127.0.0.1` 웹소켓이며, 브라우저 Origin과 비루프백 Host를 거절합니다. 이 모델은 메이플 서버가 집 PC에 들어오는 구조라 그대로 쓸 수 없습니다.
- `policy.ts`는 약 2,000줄이고 Foreman 객체에 묶여 있습니다. 공개 릴레이에 붙이면 명령 실행면이 생깁니다.

그래서 Foreman 프로세스를 의존성으로 띄우지 않습니다. 이 슬라이스는 같은 상태 이름과 세션 키 아이디어만 새 코드로 구현합니다. 마인크래프트 렌더러, 모드, 텍스처는 가져오지 않습니다.

## 릴레이 API

GET과 POST만 받습니다. 다른 메서드는 405입니다. 메이플 `RequestAndWait` 문서에는 put/delete/head가 적혀 있지만, 같은 페이지의 유의 사항은 Get/Post만 지원한다고 되어 있어서 스크립트는 `PostAndWait`만 사용합니다.

| 메서드 | 호출자 | 역할 |
| --- | --- | --- |
| `POST /v1/villages` | 루트 토큰 | 마을 생성. 커넥터 토큰과 1회용 페어링 코드를 한 번만 반환 |
| `POST /v1/pair` | 페어링 코드 | 월드 토큰과 리프레시 토큰 |
| `POST /v1/world/refresh` | 리프레시 토큰 | 월드 토큰 교체. 이전 리프레시는 재사용 불가 |
| `POST /v1/commands` | 월드 토큰 | `goal.submit`, `decision.answer`, `character.bind`만 큐에 넣음 |
| `POST /v1/connector/poll` | 커넥터 토큰 | `afterCommandSeq` 이후 명령을 순서대로 반환 |
| `POST /v1/events` | 커넥터 토큰 | 허용된 이벤트 타입만 기록. `eventId`가 같으면 같은 순번 |
| `POST /v1/state` | 월드 토큰 | `afterEventSeq`가 0이거나 간격이 비면 스냅샷, 아니면 델타 |
| `GET` 또는 `POST /v1/health` | 없음 | 생존 확인 |

명령 본문:

```json
{
  "commandId": "goal-village-1",
  "type": "goal.submit",
  "issuedAt": 1700000000000,
  "payload": { "text": "게시판을 정리해 주세요", "targetSessionId": "ses_worker" }
}
```

- `commandId`가 같고 본문이 같으면 처음 응답을 다시 줍니다. 본문이 다르면 409입니다.
- 처음 수신한 `issuedAt`이 서버 시각과 5분 넘게 차이 나면 거절합니다. 이미 받은 명령의 재전송은 이 창과 관계없이 같은 응답을 줍니다.
- `shell.exec`, `git.push`, `git.exec`, `tool.run`, `desktop.exec`, `claude.exec`는 400이며 큐에 남지 않습니다.
- 토큰은 SHA-256만 저장합니다. 마을 A의 토큰으로 마을 B의 명령이나 이벤트를 읽지 못합니다.
- 월드 토큰 기본 수명은 24시간, 페어링 코드는 10분이며 한 번 쓰면 끝입니다.

식별자는 재시작 후에도 같습니다.

| 식별자 | 예시 | 수명 |
| --- | --- | --- |
| `villageId` | `vil_...` | 릴레이 상태 파일 |
| `sessionId` | `ses_foreman`, `ses_worker` | 커넥터 `state.json` |
| `mapleActorId` | `npc-foreman` | 세션에 1:1. 다른 세션으로 다시 묶으면 충돌 |
| `commandId` | `goal-village-1` | 마을 안에서 영구 멱등 키 |
| Claude `session_id` | 스트림에서 수신 | `sessions["ses_worker:task_1"]` |

## 로컬 사무실

기본 백엔드는 시뮬입니다. 목표를 받으면 감독관은 책상에서 나누고, 작업자는 책상에서 작업 중으로 바뀐 뒤 질문 상태로 플레이어에게 가는 스테이션 `user`가 됩니다. 선택지는 `이대로 진행`과 `거절`입니다. 진행을 고르면 과제와 목표가 완료되고 작업자는 책상으로 돌아갑니다. 거절하면 과제는 `blocked`, 목표는 `failed`입니다.

이 슬라이스는 워커 세션마다 열린 목표를 하나만 허용합니다. 세션이 다르면 질문을 동시에 열 수 있습니다.

Claude 백엔드를 테스트에 주입하면 첫 턴은 `intent: "ask"`이고 `resumeSessionId`가 없습니다. 드라이버가 돌려준 `sessionId`를 저장합니다. 프로세스를 새로 만들어도 다음 `intent: "work"` 턴에 그 값을 `resumeSessionId`로 넘깁니다. 쓰기가 거절되면 작업을 완료하지 않습니다.

CLI 드라이버는 `enabled !== true`이면 프로세스를 만들지 않습니다. 쓰기 턴은 `approve()`가 `allow`를 반환하기 전에 `spawn`을 호출하지 않습니다. `shell: false`로만 띄우도록 테스트합니다. 이 환경에서는 그 테스트를 가짜 스폰으로만 실행했습니다.

## 상태 반영과 호출 한도

공식 HttpService 유의 사항(아래 출처) 기준:

- 분당 120회를 넘기면 30초 동안 요청이 막힙니다.
- 요청당 타임아웃 30초, 응답 10MB, TLS 1.2 이상.
- 80과 443을 제외한 1024 미만 포트는 제한됩니다.
- 서버 전용입니다.

월드 스크립트의 설계 폴링은 2초입니다. 분당 30회로, 목표 전송과 다른 HTTP를 남깁니다. 반영 지연의 설계 목표는 1–2초(폴링 간격)입니다. 로컬 목 측정값은 [measured-latency.md](measured-latency.md)에 있고, 메이플 서버에서 잰 값이 아닙니다.

`reflectionBudgetMs(poll, rtt) = poll + rtt`입니다. 2초 폴링에 왕복 50ms를 더하면 2050ms로, 설계 구간의 상한 근처입니다. 1초 폴링은 분당 60회라 한도 안이지만, 월드의 다른 HttpService 사용과 겹칠 수 있어 기본값은 2초입니다.

## HttpService 출처

- 공식 페이지: https://maplestoryworlds-creators.nexon.com/en/apiReference/Services/HttpService  
  검색에 잡힌 갱신 시각은 2026-10-06입니다. 페이지 본문은 클라이언트에서 그려져, 이 실행에서는 라이브 DOM을 그대로 추출하지 못했습니다.
- 본문은 공개 데이터셋 `msw-ai-tf/maplestory-worlds-creator-docs`의 영어/한국어 `id=805`에서 읽었습니다. 한국어 유의 사항은 "HttpMethod Get/Post만 지원합니다", "분당 최대 120회", "초과 시 30초", "Timeout 30초", "Tls1.2 이상", "80, 443을 제외한 1024 미만 포트 제한", "응답 버퍼 10MB"입니다.
- 같은 영어 코퍼스에서 WebSocket이라는 단어는 찾지 못했습니다. 웹소켓이 플랫폼 전체에 없다고 단정하지는 않습니다. 이 릴레이는 웹소켓을 요구하지 않습니다.
- 포트 443이 허용 예외이므로, 공개 엔드포인트는 HTTPS 443 뒤에 두는 설계가 맞습니다. 개발 서버 기본 포트는 권한 없는 `8787`이고, TLS는 앞단 프록시의 몫입니다.

## 도서관

그래프의 원본은 커넥터 프로필입니다. 릴레이는 그 마을의 카드와 마지막 검색 패널만 중계합니다.

- 노드 `kn_N`: `source`(출처 기록, assertion `citation`) 또는 `summary`(세션 요약, assertion `summary`). 둘 다 `assertsFact: false`.
- 간선 `ke_N`: 올릴 때 출처를 지정하면 `grounded_in`은 승인된 출처 연결입니다. `library.link`는 `related`이고 상태는 `proposed`입니다. `library.approveLink`는 연결만 승인합니다.
- 검색과 이웃은 한 마을 안입니다. 이웃은 깊이 1, 최대 12개입니다.
- 세션 프롬프트에 넣는 참고는 최대 3건, 본문 400자이며, 제안된 연결은 따라가지 않습니다.
- 삭제는 없습니다. 개정은 최대 20개이고 이전 개정은 남습니다.

필드 이름은 `docs/design.md`에 초안과 나란히 적혀 있습니다.

## 화면 배치

`config/village-anchors.json`은 제안입니다. 크리에이터 검증은 하지 않았습니다. 이동 스크립트는 바닥 Y를 유지한 채 X만 바꿉니다. 상태 연출 도우미는 `src/presentation.ts`이고 애니메이션 클립을 고르지 않습니다. 에셋 칸은 `docs/resource-ledger.md`에 비어 있습니다.

## 데이터 파일

| 파일 | 위치 | git |
| --- | --- | --- |
| 릴레이 상태 | `RELAY_STATE_FILE` 또는 예시의 `.agentmaple/relay-state.json` | 무시 |
| 커넥터 토큰 | `<profile>/auth.json` | 무시 |
| 사무실 상태 | `<profile>/state.json` | 무시 |

공개 트리에는 예시 설정만 있습니다. 비밀, 로그, 사용자 경로, 상태 스냅샷은 커밋하지 않습니다.
