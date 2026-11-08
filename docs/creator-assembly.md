# 크리에이터 수동 조립

공식 문서(Utilization of Packages, postId 647)에서 패키지는 크리에이터의 Workspace에서 Export To Package로 저장하고, Import Package로 다시 넣습니다. 리소스를 넣으려면 월드가 서버에 저장된 RUID가 필요합니다. 네이티브 항목은 그대로 패키지에 넣지 못합니다. `.mod` 전체 월드 파일의 바이트 형식은 그 문서에 없습니다.

그래서 이 저장소는 가져오기용 `.mod`나 `.modpackage`를 만들지 않습니다. 만들면 크리에이터가 연다고 보장할 수 없습니다. 아래는 빈 월드에 사람이 붙이는 최소 절차입니다. 맵과 그래프 그림은 아직 없습니다.

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
