# 메이플스토리 월드에 붙이기

이 절차는 크리에이터에서 **아직 실행해 보지 않았습니다.** `msw/scripts`는 붙여 넣을 소스입니다. `.modpackage`를 만들지 않았으니, 받은 패키지를 임포트하는 단계는 없습니다.

공식 API 이름은 크리에이터 센터 문서를 따른 것입니다. 동작이 다르면 스크립트가 틀린 것입니다. 넥슨 이미지, 사운드, RUID는 넣지 마세요. 이 월드는 비공식입니다.

## 직접 해야 하는 일

1. 빈 월드를 만듭니다. 기존에 설치된 다른 게임 월드는 수정하지 않습니다.
2. 책상 자리에 NPC 둘을 놓고, 각각 스크립트 `OfficeNpc`를 붙입니다. 파일은 `msw/scripts/OfficeNpc.mlua`입니다.
3. 서버에만 있는 빈 엔티티를 만들고 스크립트 `VillageRelay`를 붙입니다. 파일은 `msw/scripts/VillageRelay.mlua`입니다.
4. 클라이언트 UI 그룹에 텍스트 입력 둘(페어링, 목표), 텍스트 셋(상태, 질문, 결과), 버튼 넷(연결, 목표 보내기, 이대로 진행, 거절)을 만듭니다. 스크립트 `GoalDesk`를 원하는 엔티티에 붙이고, 경로 프로퍼티를 실제 엔티티 경로로 바꿉니다.
5. `VillageRelay.RelayBase`를 `https://<공개 릴레이>/v1`로 바꿉니다. 스크립트는 그 뒤에 `/pair`, `/commands`, `/state`를 붙입니다. 포트는 443이어야 합니다. 1024 미만의 다른 포트는 HttpService 유의 사항에서 막혀 있습니다.
6. 릴레이 앞에 TLS를 둡니다. 개발 프로세스의 기본 수신은 `127.0.0.1:8787`이고, `RELAY_ROOT_TOKEN`은 환경 변수입니다. 토큰은 설정 파일에 넣지 않습니다. 이 저장소는 공개 주소, 인증서, 계정을 만들지 않습니다. 그 주소가 없으면 메이플 서버는 집 PC에 닿지 않습니다. 플레이 중 연결 상태는 지휘석에 `연결 실패: …` 또는 `연결됨`으로 나옵니다. 메이커 콘솔에는 경로와 응답 앞부분만 나오고 토큰은 나오지 않습니다.
7. 집 PC에서 커넥터를 실행하고, 터미널에 한 번 나오는 페어링 코드를 UI에 입력합니다. 코드는 10분 안에 한 번만 됩니다.
8. 맵 프로퍼티에 저장된 `RelayBase`와 `WorldToken`은 플레이를 시작해도 비우지 않습니다. 토큰이 이미 있으면 페어링 코드를 다시 넣지 않아도 `/v1/state`를 폴링합니다.
9. `/v1/state`의 `serverTime`은 릴레이의 유닉스 밀리초입니다. 응답에 없으면 `POST /v1/time`을 같은 토큰으로 봅니다. `DateTime.UtcNow.Elapsed`는 공식 문서에서 밀리초 정수일 뿐 유닉스 기원이라고 되어 있지 않습니다. 스크립트는 `serverTime - Elapsed`를 오프셋으로 저장한 뒤 `Elapsed + 오프셋`을 `issuedAt`으로 보냅니다. 오프셋이 없으면 명령을 보내지 않습니다.
10. 질문 상태에서 작업자 NPC가 플레이어 쪽으로 움직이는지, 답이 끝난 뒤 집 좌표에서 서 있는지 봅니다. 이동은 `MovementComponent:MoveToDirection`이고, 목표에 닿으면 `Stop`합니다. 길찾기와 걷기 애니메이션은 없습니다. `CaptureOwnerOnNextEnter` 기본값은 참이라 처음 입장한 사람이 질문 대상입니다.
11. UI 엔티티는 서버에서 직접 만지지 않습니다. 서버는 `GoalDesk:ShowFromServer`를 호출합니다. 이 호출이 클라이언트에서 실행되는지는 크리에이터 실행 공간 규칙에 따라 확인해야 합니다.
12. 폴링은 2초입니다. 월드의 다른 HttpService 호출과 합쳐 분당 120회를 넘기지 마세요. 넘기면 문서상 30초간 요청이 멈춥니다.
13. HttpService의 `GetAndWait`, `PostAndWait`, `RequestAndWait`는 서버 전용입니다. 이 스크립트의 폴링은 `@ExecSpace("ServerOnly")`입니다. 공식 HttpService 페이지의 `httpEnabled`는 `http://`만 허용하는 스위치이고 기본값은 거짓입니다. 릴레이가 `https://`이면 이 스위치를 켜지 않아도 됩니다. 그 페이지에는 도메인 허용 목록이 없습니다.
14. 포탈은 연결할 맵마다 두고, 프로퍼티 에디터에서 TargetPortal의 [◉]를 누른 뒤 Reference 창에서 반대편 포탈을 고릅니다. 출발과 도착을 서로 지정합니다. 파일에 들어 있는 참조 JSON 예제는 없어서 배포는 TargetPortal을 비워 둡니다. `IsLegacy`는 false로 씁니다.
15. 메이커 테스트 플레이(`Environment:IsPublishedPlay()`가 거짓)는 `LocalRelayBase`(기본 `http://127.0.0.1:8787/v1`)를 쓰고 `httpEnabled`를 켭니다. `127.0.0.1`의 `/health`가 비면 `localhost`로 한 번 더 봅니다. 출시 플레이는 `RelayBase`의 https를 그대로 씁니다. 이 `Environment` 호출은 커뮤니티 예제에 있고, 이 저장소의 문서 팩에는 없습니다.
16. 월드 토큰 기본 수명은 30일, 갱신 토큰은 90일입니다. 코드를 바꾼 뒤에는 같은 `RELAY_STATE_FILE`로 릴레이를 다시 켜야 새 수명이 적용됩니다. 그 파일에 마을과 캐릭터 기록이 있으므로 경로를 바꾸면 빈 마을이 됩니다. 재시작만으로 이미 만료된 토큰이 길어지지는 않습니다. 이어서 `node tools/mint-world-token.mjs`로 다시 발급합니다.

## 도서관과 바닥

`LibraryHall.mlua`를 UI에 붙이고, `VillageRelay.LibraryHallPath`를 그 엔티티로 지정합니다. 검색, 본문(`kn_` id), 이웃, 출처 기록 올리기, 세션 요약 올리기, 연결, 연결 승인이 버튼입니다. 항목을 골라도 본문이 명령으로 실행되지 않습니다.

NPC는 시작할 때 서 있던 Y를 바닥으로 기억하고, 질문 중에는 플레이어의 X로만 이동합니다. `LibraryX`와 `SlotLabel`(S01, S02)은 크리에이터가 `config/village-anchors.json`과 맞춥니다. 개념도의 위아래 구역으로는 걷지 않습니다.

이 배치와 스크립트는 월드에서 실행해 보지 않았습니다. `.modpackage`는 없습니다.

## 스크립트와 릴레이가 맞추는 이름

- 명령 타입: `character.bind`, `goal.submit`, `decision.answer`
- 기본 세션: `ses_foreman`, `ses_worker`
- 기본 액터: `npc-foreman`, `npc-worker`
- 선택지 문자열: `이대로 진행`, `거절`
- 상태 폴링: `POST /v1/state`의 `afterEventSeq`

`test/msw-contract.test.ts`는 이 문자열이 소스에 있는지만 봅니다. 루아를 실행하지는 않습니다.

## 하지 않는 일

- 메이플 크리에이터나 에디터 매크로를 돌리지 않습니다.
- `agent-desktop`으로 월드 편집기를 조종하지 않습니다. 그 도구는 모델 루프가 없는 PC 조작용 CLI이고, 여기서는 꺼져 있습니다.
- 공식 클라이언트를 수정하지 않습니다.
