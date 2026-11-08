# 크리에이터 문서 출처

2026-11-08에 읽은 범위만 적습니다. 크리에이터 센터 전체를 읽었다고 보지 않습니다. 전문은 공개 저장소에 복사하지 않았고, 받은 원문은 이 작업 환경의 `/tmp/msw-docs-pack`에만 있습니다.

## 학습 경로

`postId=61` 페이지의 사이드 메뉴에서 확인한 기본 제작 가이드입니다.

| 메뉴 id | 제목 | 주소 | 상태 |
| --- | --- | --- | --- |
| 19 | 기본 제작 가이드 | 사이드 메뉴 | 목록만 |
| 23 | 지형과 이동 | 사이드 메뉴 | 목록만 |
| 726 | 지형 | 사이드 메뉴 | 목록만 |
| 61 | 맵 생성과 관리 | https://maplestoryworlds-creators.nexon.com/ko/docs?postId=61 | 본문 읽음 |
| 115 | 게임 시작 위치 설정 | https://maplestoryworlds-creators.nexon.com/ko/docs?postId=115 | 본문 읽음. 61에서 링크 |
| 747 | 메이플 타일맵 만들기 | https://maplestoryworlds-creators.nexon.com/ko/docs?postId=747 | 본문 읽음 |
| 71 | 발판 만들기 | https://maplestoryworlds-creators.nexon.com/ko/docs?postId=71 | 본문 읽음 |
| 579 | 이동 발판 만들기 | https://maplestoryworlds-creators.nexon.com/ko/docs?postId=579 | 본문 읽음 |
| 589 | RectTileMap의 활용 | https://maplestoryworlds-creators.nexon.com/ko/docs?postId=589 | 본문 읽음 |
| 758 | SideViewRectTile모드로 맵 만들기 | https://maplestoryworlds-creators.nexon.com/ko/docs?postId=758 | 본문 읽음 |
| 727 | 이동 | 사이드 메뉴 | 자식 글 목록을 이 페이지에서 받지 못함 |
| 728 | 객체 표현 | 사이드 메뉴 | 본문 안 읽음 |
| 28 | UI | 사이드 메뉴 | 본문 안 읽음 |
| 741 | 리소스 제작 | 사이드 메뉴 | 본문 안 읽음 |

받은 시각은 2026-11-08 13:39 UTC 근처입니다. 제목은 페이지 `<title>`과 본문 첫 머리입니다.

61에서 확인한 점: 새 맵은 Hierarchy의 Create New Map 또는 Map List에서 만듭니다. 시작 맵과 현재 작업 맵은 지울 수 없습니다. 기본 시작 맵은 map01입니다. 115에서 확인한 점: 시작 맵의 SpawnLocation이 플레이어 아바타의 처음 위치이고, 기본 좌표는 0, 0입니다. 758에서 확인한 점: RectTile과 Kinematicbody는 탑다운에 맞고, 횡스크롤은 SideViewRectTile 모드입니다. 모드 전환은 그 가이드의 메이커 절차입니다. 이 저장소는 map01과 SpawnLocation을 지우지 않고, TileMapMode 숫자를 파일에서 바꾸지 않습니다.

## API 레퍼런스

안내: https://maplestoryworlds-creators.nexon.com/ko/apiReference/How-to-use-API-Reference  
제목은 API Reference 가이드라인입니다. 구성은 Components, Events, Services, Logics, Misc, Enums, Lua, LogMessages입니다. 이 아홉 묶음의 자식 전체를 읽지는 않았습니다.

같은 날 연 페이지:

| 주소 | 적용 |
| --- | --- |
| `/ko/apiReference/Events/ButtonClickEvent` | 버튼 클릭 이벤트. 프로퍼티는 클릭된 `Entity` |
| `/ko/apiReference/Components/ButtonComponent` | 예제는 버튼 엔티티 자신의 `[self] HandleButtonClickEvent`, `OnBeginPlay`는 client only |
| `/ko/apiReference/Events/TouchEvent` | TouchReceiveComponent가 있는 엔티티를 터치할 때. TouchId, TouchPoint |
| `/ko/apiReference/Components/TouchReceiveComponent` | 예제는 `[self] HandleTouchEvent`, Space는 Client |
| `/ko/apiReference/Events/UITouchDownEvent` | UI 터치는 UITouchReceiveComponent. 버튼 클릭과 다른 이벤트 |
| `/ko/apiReference/Components/MovementComponent` | `SetWorldPosition(Vector2 position)` |
| `/ko/apiReference/Components/SpriteRendererComponent` | `SpriteRUID`는 스프라이트 또는 애니메이션 클립 id |
| `/ko/apiReference/Components/AvatarRendererComponent` | 아바타 렌더. 파츠 RUID는 이 페이지 목록만으로 확인하지 않음 |
| `/ko/apiReference/Services/HttpService` | 월드 인스턴스당 분당 최대 120회, 초과 시 30초 중단, 요청 Timeout 30초. https를 권장 |

UI 버튼은 빌더가 넣은 버튼 UUID로 `Entity:ConnectEvent(ButtonClickEvent, handler)`를 호출하고, 핸들러는 ClientOnly입니다. 공식 ButtonComponent 예제는 버튼 자신의 `[self] HandleButtonClickEvent`이기도 합니다. 어느 쪽이 이번 채팅 오픈의 원인인지는 확인하지 않았습니다. 맵 엔티티 터치는 TouchReceiveComponent 예제처럼 그 엔티티의 `[self]` TouchEvent, Space Client입니다. HttpService 페이지는 월드 인스턴스당 분당 120회와 요청 Timeout 30초를 적습니다. 우리 `WorldToken` 프로퍼티는 그 페이지의 내장 설정으로 확인되지 않았습니다. DataStorage 용량 문서 1044/1045와 ModelBuilder/UIBuilder 프로토콜 전체는 이 구현의 근거로 쓰지 않았습니다.
