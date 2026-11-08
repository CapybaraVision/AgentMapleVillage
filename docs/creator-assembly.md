# 크리에이터에 넣기

공식 제작 경로로 만든 파일은 `msw/workspace-overlay`에 있습니다. `MapBuilder.fromTemplate(sideview)`와 `UIBuilder`가 썼습니다. 스킬 저장소 `MSW-Git/msw-ai-coding-plugins-official` 커밋 `96133b2991d71b66bbe1e2494d28e4cc4bf57f82`입니다. RUID는 그 스킬 안에 이미 있던 값만 복사했습니다. 새로 만든 RUID는 없습니다. 크리에이터에서 열어 보지는 않았습니다.

## 백업 후 복사

메이커가 플레이 중이 아닐 때, 월드의 LocalWorkspace 폴더에서:

```powershell
node tools/deploy-msw-overlay.mjs C:\path\to\the\exported\LocalWorkspace
```

모든 검사는 첫 쓰기 전에 끝납니다. 통과한 뒤에만, 덮어쓸 파일을 월드 폴더 바깥 `AgentMapleVillage-backup-<시각>`에 복사합니다. 쓰다가 실패하면 그 백업으로 되돌립니다. 끝난 뒤 메이커에서 refresh가 필요합니다. 이 스크립트는 refresh와 play를 하지 않았고, 크리에이터에서 확인하지 않았습니다.

공식 맵 빌더 문서(`builder-protocol-map.md`, `entity.md`, 스킬 커밋 `96133b2991d71b66bbe1e2494d28e4cc4bf57f82`)는 새 맵 id를 월드에서 열어야 할 때 `Global/SectorConfig.config`의 `entries`에 `map://{id}`를 넣어야 할 수 있다고 적습니다. SectorConfig 편집 자체는 빌더가 다루지 않는 항목입니다. 크리에이터 Basic 내보내기에는 그 파일이 없고 `map/map01.map`가 맵입니다. 이 스크립트는 SectorConfig를 만들지 않고, 파일 모양을 추측하지 않습니다.

- 파일이 없으면 마을 엔티티를 기존 `map/map01.map`에 넣습니다. 별도 `map/AgentMapleVillage.map`는 복사하지 않습니다. NPC의 Body는 그 맵의 `TileMapMode`에 맞춥니다. 0은 Rigidbody, 1은 Kinematicbody, 2는 Sideviewbody입니다.
- 파일이 있고 `entries`가 문자열 배열이면 `map://AgentMapleVillage`를 덧붙이고 별도 맵 파일을 복사합니다. `map01`은 그대로 둡니다.
- `entries`가 문자열 배열이 아니거나 JSON이 아니면 아무 파일도 쓰지 않습니다.

`UseExtendedScriptFormat`은 `ContentProto.Json` 아래이거나 파일 맨 위에 `true`여야 합니다. 아니면 WorldConfig를 고치지 않고 멈춥니다.

꼭 있어야 하는 것:

- 내보낸 LocalWorkspace의 `Global`, `map`, `ui`, `RootDesk`.
- `Global/WorldConfig.config`의 확장 스크립트 형식.
- SectorConfig가 없을 때 `map/map01.map`. `ContentType`은 `x-mod/map`이고, `MapComponent.TileMapMode`는 0, 1, 2 중 하나입니다.

없어도 되는 것:

- `Global/SectorConfig.config`
- `Environment`
- UIPopup, UIToast, `.codeblock`

추가로 받아야 하는 시드 파일은 없습니다. 맵에 넣을 엔티티와 UI는 이미 `msw/workspace-overlay`에 있습니다.

`npm run sim`은 이 프로세스 안에서 목표를 끝까지 진행합니다. 메이플 세션을 열지 않고 Claude를 호출하지 않습니다.

요구가 바뀌었습니다. 끝난 세션의 짧은 작업 기록은 그 마을 저장소에 그래프로 남습니다. 재시작 후에도 `kn_` id가 같습니다. 세션이 만든 연결은 `proposed`이고 사실이 아닙니다. 출처 문장은 여전히 명시적으로 올릴 때만 생깁니다. 지운 기록은 같은 내용이 다시 자동으로 들어오지 않습니다. 비밀 문자열 걸러내기는 완전하지 않습니다. 보이는 패턴만 `[가림]`으로 바꿉니다.

지식 그래프의 기준 저장소는 프로필 옆 `library.sqlite`입니다. Node에 들어 있는 SQLite를 쓰고, 클라우드 DB나 추가 패키지는 없습니다. 예전 `state.json` 그래프는 처음 열 때 그 파일로 옮기고, 옮기기 전 내용을 `library.sqlite.json-backup`에 남깁니다. 같은 제목의 다음 작업은 새 노드가 아니라 같은 `kn_`의 수정 기록입니다. 책은 그 노드를 가리키는 세계 오브젝트이고 NPC가 아닙니다. 안내원이 질문과 안내를 맡습니다. 릴레이는 SQL을 받지 않습니다. 메이플 쪽 갱신은 기존 조회 명령을 정해진 횟수 안에서 다시 부르는 방식입니다. 연결이 끊기면 기록은 파일에 남고, 화면은 끊긴 상태를 유지합니다.

버튼이 기본 채팅만 연 원인은 아직 확정하지 않았습니다. 보이는 버튼과 입력을 받는 버튼은 다를 수 있습니다. 지금 스크립트는 버튼 UUID로 `ConnectEvent(ButtonClickEvent)`를 걸고, 핸들러는 ClientOnly입니다. UI 갱신은 서버에서 `/ui`를 찾지 않고, 맵 엔티티의 ClientOnly 메서드로 넘깁니다. 맵 터치는 TouchReceiveComponent의 `[self]` TouchEvent이고 UITouchDownEvent와 바꾸지 않습니다. 이 연결은 크리에이터에서 다시 확인하지 않았습니다. 슬래시 명령은 쓰지 않습니다. 읽은 범위는 [creator-sources.md](creator-sources.md)입니다. 꾸미기 대기는 [polish-backlog.md](polish-backlog.md)입니다.

게시판은 피드에 있는 목표, 질문, 시스템 문장만 보여 줍니다. 바꾼 파일이나 테스트 결과를 만들어 넣지 않습니다. NPC와 책은 공식 빌더의 기본 스프라이트입니다. 캐릭터 스킨 RUID는 확인된 목록에 없어 넣지 않았습니다.

첫 크리에이터 플레이에서 서버 로그는 `cannot set WorldToken, no such field (at /maps/map01/VillageRelay)`였습니다. 공식 UI 런타임 문서는 선언하지 않은 `self` 대입이 그 오류로 메서드를 멈춘다고 적습니다. `.codeblock`은 메이커 refresh가 `.mlua`에서 만들고, 이 저장소는 그 파일을 쓰지 않습니다. 스크립트가 `OnBeginPlay`까지 실행되었으므로 빠진 것은 WorldToken 프로퍼티 선언입니다. `WorldToken`, `ClockOffset`, `OpenDecisionId`, `Busy`, `Cursor`, `CommandCounter`를 프로퍼티로 선언했습니다. `@Sync`는 붙이지 않았고, 시작할 때 토큰을 비웁니다.

지휘석과 도서관 패널은 닫힌 채로 두고, `지휘석`과 `도서관` 버튼으로 하나씩 엽니다. 버튼 높이는 88이고 다음 칸과 겹치지 않게 간격을 두었습니다. 상태 문구는 `공개 릴레이가 없습니다.`입니다. 공개 HTTPS가 없으므로 `마을 연결 전`이라고 쓰지 않습니다.

다시 배포하면 이미 있는 맵 엔티티의 사용자 값은 유지하고, 없는 스크립트 프로퍼티만 채웁니다. 예전 백업 폴더는 지우지 않습니다. 이 수정은 크리에이터에서 다시 플레이하지 않았습니다.

## 들어 있는 것

- `map/AgentMapleVillage.map`: 공식 사이드뷰 템플릿으로 만든 원본. TileMapMode 2. 책상 6. 세션 NPC는 `ses_foreman`(S01)과 `ses_worker`(S02)만. 나머지 책상은 빈 자리입니다. SectorConfig가 없는 Basic 월드에서는 이 파일 대신 `map01`에 같은 엔티티를 넣습니다.
- `ui/AgentMapleDesk.ui`, `ui/AgentMapleLibrary.ui`: 지휘석과 도서관. 지식 그래프 그림이 아니라 검색, 본문, 이웃 목록입니다.
- `RootDesk/MyDesk/AgentMapleVillage/*.mlua`: 확장 스크립트 형식의 원본.

# 크리에이터 수동 조립

공식 문서(Utilization of Packages, postId 647)에서 패키지는 크리에이터의 Workspace에서 Export To Package로 저장하고, Import Package로 다시 넣습니다. 리소스를 넣으려면 월드가 서버에 저장된 RUID가 필요합니다. 네이티브 항목은 그대로 패키지에 넣지 못합니다. `.mod` 전체 월드 파일의 바이트 형식은 그 문서에 없습니다.

그래서 이 저장소는 가져오기용 `.mod`나 `.modpackage`를 만들지 않습니다. 만들면 크리에이터가 연다고 보장할 수 없습니다. 위 배포가 Basic 월드의 `map01`과 UI 파일을 넣는 경로입니다. 아래는 그 파일을 쓰지 않을 때 사람이 빈 월드에 붙이는 절차입니다. 지식 그래프 그림은 만들지 않습니다.

## 순서

1. 메이플스토리 월드 크리에이터에서 빈 월드를 새로 만듭니다. 이미 있는 AgentCraft나 다른 월드를 열지 않습니다.
2. 가로로 걸을 수 있는 바닥을 하나 놓습니다. 위아래 방으로는 스크립트가 걷지 않습니다.
3. 서버 엔티티에 `msw/scripts/VillageRelay.mlua`를 스크립트 이름 `VillageRelay`로 붙입니다.
4. NPC 둘에 `OfficeNpc.mlua`를 이름 `OfficeNpc`으로 붙입니다. 감독관 `SlotLabel`은 `S01`, 작업자는 `S02`입니다. `LibraryX`는 도서관으로 쓸 바닥의 X입니다.
5. 질문을 받을 사람만 정하려면 `CaptureOwnerOnNextEnter`를 켠 뒤 그 사람이 한 번 입장하게 합니다. 끄면 첫 입장자를 주인으로 삼지 않습니다. `User.ProfileCode`는 릴레이 비밀번호가 아닙니다. 공식 UserService에는 월드 주인 UserId가 없습니다.
6. UI 그룹에 목표 입력과 도서관 입력을 만들고 `GoalDesk.mlua`, `LibraryHall.mlua`를 붙입니다. 경로 프로퍼티를 실제 엔티티 경로로 바꿉니다.
7. `VillageRelay.RelayBase`는 나중에 정한 HTTPS 주소입니다. `127.0.0.1`은 월드 서버가 닿지 못합니다.
8. 페어링 후 응답의 `serverTime`(유닉스 밀리초)에서 `DateTime.UtcNow.Elapsed`를 뺀 값을 시계 오프셋으로 씁니다. `Elapsed`를 그대로 `issuedAt`으로 보내지 않습니다.

## 스크립트와 공식 필드

| 스크립트 | 공식 API | 필드 |
| --- | --- | --- |
| VillageRelay | `HttpService:PostAndWait`, `JSONEncode`, `JSONDecode`, `HttpContentType.ApplicationJson` | 명령 `issuedAt` = `DateTime.UtcNow.Elapsed + ClockOffset` |
| VillageRelay | `DateTime.UtcNow` | `Elapsed`는 밀리초 정수. 유닉스 기원이라고 문서에 없음 (postId 695, 691) |
| VillageRelay | `TimerService:SetTimerRepeat` | 상태 폴링 2초 |
| OfficeNpc | `UserEnterEvent.UserId` | `CaptureOwnerOnNextEnter`가 켜져 있을 때만 `OwnerUserId` |
| OfficeNpc | `UserService:GetUserEntityByUserId` | 질문 이동의 대상. 비어 있으면 책상 X에 머무름 |
| OfficeNpc | `MovementComponent:SetWorldPosition`, `TransformComponent.WorldPosition` | Y는 시작 때 저장한 바닥. X만 변경 |
| OfficeNpc | `NameTagComponent.Name` | 서버 `activity`와 크리에이터가 적은 `SlotLabel` |
| GoalDesk, LibraryHall | `TextInputComponent.Text`, `TextComponent.Text`, `ButtonClickEvent` | 문자열만 서버로 전달 |
| 실행 공간 | `@ExecSpace("ServerOnly")`, `@ExecSpace("ClientOnly")` | UI 엔티티는 클라이언트. HttpService는 서버 |

라이브 크리에이터에서 이 표를 눌러 본 기록은 없습니다.
