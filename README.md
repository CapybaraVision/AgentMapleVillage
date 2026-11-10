# AgentMapleVillage

메이플스토리 월드 안에 두는 **비공식 AI 사무실**의 첫 수직 슬라이스입니다.  
플레이어는 월드에서 목표를 적고, 질문에 답합니다. 실제 작업은 집 PC의 로컬 커넥터가 합니다. 한 세션은 캐릭터 하나입니다.

이 프로젝트는 넥슨, 메이플스토리, 메이플스토리 월드와 관계가 없습니다. 공식 월드를 자동화하거나 에디터를 조작하지 않습니다. 넥슨 에셋은 포함하지 않습니다.

## 지금 되는 것

| 구분 | 내용 |
| --- | --- |
| 구현됨 | 인증 릴레이, 밖으로만 나가는 커넥터, 시뮬 목표 → 과제 → 질문 → 답변 → 완료, 세션 ID 고정, 재시작, 명령 재생, 마을 단위 지식 그래프(출처 기록·세션 요약·제안/승인 연결) |
| 목업 | Claude Code `session_id` / `--resume` 배선. 이 저장소의 테스트는 가짜 프로세스만 사용합니다. 클라우드에서는 `claude`를 실행하지 않았습니다. |
| 크리에이터 | 첫 플레이에서 map01의 책상·NPC·두 패널이 보였고, 서버가 `cannot set WorldToken, no such field`로 멈췄습니다. 그 선언과 패널 배치는 고쳤습니다. 고친 뒤에는 크리에이터에서 다시 플레이하지 않았습니다. |
| 꺼 둠 | `agent-desktop` 어댑터. 기본값이 꺼져 있고, 켜도 소켓을 열지 않습니다. |
| 계획 | 리뷰, 디프, 머지, 워크트리, Codex, 마크다운 기억, 일시정지, 실제 Claude 턴, 에셋 RUID |

전체 대조는 [docs/feature-parity.md](docs/feature-parity.md)에 있습니다.

## 구조

```text
메이플 서버 mLua  --POST-->  릴레이 :443  <--폴링--  집 PC 커넥터  -->  시뮬 또는 Claude Code
```

메이플 서버는 집 PC의 localhost에 직접 닿지 못합니다. 커넥터가 릴레이로 **나갑니다**. 릴레이에는 셸, git, 데스크톱 실행 엔드포인트가 없습니다.

자세한 설명은 [docs/architecture.md](docs/architecture.md), 보안은 [docs/security.md](docs/security.md), 월드에 붙이는 방법은 [docs/msw-setup.md](docs/msw-setup.md)와 [docs/creator-assembly.md](docs/creator-assembly.md)입니다. Windows 검사 절차는 [docs/windows-validate.md](docs/windows-validate.md)입니다. 가져오기용 `.modpackage`는 만들지 않았습니다. 메이플 서버는 집 PC의 `127.0.0.1`에 닿지 않습니다. 월드의 HttpService가 집 릴레이를 부르려면 그 앞의 공개 HTTPS(포트 443)가 따로 있어야 하고, 이 저장소는 그 주소·인증서·계정을 만들지 않습니다. 릴레이 프로세스는 루프백만 엽니다.

## 로컬에서 시뮬 돌리기

이 저장소는 Node.js 22 이상을 사용합니다. 사용 중인 기본 Node 20이나 기존 게임 설치는 바꾸지 않습니다.

```sh
npm install
npm test
npm run typecheck
npm run audit
npm run sim
```

공식 빌더로 만든 맵과 UI를 넣은 뒤 `npm test`는 67개, `npm run typecheck`는 오류 없음입니다. 이 54개는 파일 검사와 로컬 git 검사입니다. 실제 Claude 프로세스는 켜지 않습니다. `015e8a` 플레이에서는 지휘석 버튼이 패널을 열었습니다. 이동은 그 플레이에서 되지 않았고, 이번 바닥 수정도 크리에이터에서 다시 걸어 보지 않았습니다. 의존성 lockfile은 그대로입니다. 크리에이터에서 열어 보지는 않았습니다. 마을 지식은 프로필 폴더의 `library.sqlite`에 둡니다. 공개 릴레이에 SQL 명령은 없습니다.

`npm run sim`은 프로세스 안에서 릴레이와 커넥터를 띄우고, 한국어 목표 하나를 끝까지 진행합니다. 이것은 메이플 세션이 아니고 Claude 호출도 아닙니다. 유료 모델 호출은 없습니다.

릴레이와 커넥터를 따로 띄울 때:

```sh
export RELAY_ROOT_TOKEN='16자 이상의 임의 값'
npm run relay
# 다른 터미널
npm run connector -- config/connector.example.json
```

커넥터가 한 번만 페어링 코드를 출력합니다. 그 코드로 `POST /v1/pair`를 호출하면 월드 토큰이 나옵니다. 토큰과 프로필은 `.agentmaple/`에 저장되며 git에 올라가지 않습니다.

## 테스트가 증명하는 것

- 잘못된 토큰, 만료, 페어링 재사용, 리프레시 재사용
- 같은 `commandId`의 중복과, 본문이 다른 중복의 거부
- 마을 A의 토큰으로 마을 B를 읽지 못함
- 워커 세션 두 개의 질문 분리
- `shell.exec`, `git.push`, `desktop.exec` 같은 명령은 큐에 들어가지 않음
- 프로필을 다시 열어도 `ses_foreman` / `ses_worker`와 Claude 가짜 `session_id`가 유지됨
- 커서를 되감아도 목표가 두 번 생기지 않음
- 쓰기 승인이 거부되면 Claude 프로세스를 시작하지 않음

로컬 루프백 지연은 테스트 로그의 `MEASURED_LOCAL_*`입니다. 월드 반영 1–2초는 **설계 목표**이며, 메이플 서버에서 측정한 값이 아닙니다. [docs/measured-latency.md](docs/measured-latency.md)를 보세요.

## Claude Code

이 클라우드 작업 환경에는 `claude` 바이너리가 없고, 로그인된 Claude Code 세션도 없습니다. 사용자 PC의 자격 증명을 복사하거나 Claude Code를 설치하지 않았습니다. 병렬 작업은 Claude Code로 실행되지 않았습니다.

드라이버 코드는 로컬에 인증된 CLI가 있을 때의 `--resume` 계약을 테스트로 고정해 두었습니다. `claudeEnabled`의 기본값은 `false`입니다.

## 라이선스

이 저장소의 코드는 MIT입니다. 제3자 출처는 [NOTICE.md](NOTICE.md)에 있습니다.
