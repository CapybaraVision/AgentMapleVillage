# 공간과 화면 (제안)

2026-11-08 설계 초안을 이 저장소의 실제 필드에 맞춰 적었습니다. 초안은 공식 문서 조사와 배치 제안입니다. 메이플 크리에이터에서 월드를 만들거나 검증하지 않았습니다. 저작권이 있는 리소스 파일과 RUID는 없습니다.

개념 배치는 32×18 격자처럼 보이지만, 스크립트의 이동은 바닥 Y 한 줄에서 X만 바꿉니다. 위아래 방 이동이나 자동 길찾기는 하지 않습니다. `config/village-anchors.json`의 `conceptY`는 나중에 꾸밀 구역이고, `floorY`는 모두 0입니다. 실제 타일 좌표는 크리에이터가 정합니다.

## 초안 이름과 코드 이름

초안 5절의 `nodeId` / `documentVersion` / `sourceRef`는 제안이었습니다. 코드는 그 이름으로 저장하지 않습니다.

| 초안 | 이 저장소 |
| --- | --- |
| nodeId | `id`, 형식 `kn_1` |
| edgeId | `id`, 형식 `ke_1` |
| documentVersion | `revision` (1부터, 이전 개정은 삭제하지 않음) |
| sourceRef | `sourceLabel` |
| sessionId | `ses_foreman`, `ses_worker` 또는 `ses_`로 시작하는 묶인 세션 |
| S01 | 이름표용 짧은 글자. `config/village-anchors.json`의 `slotLabel`. 세션 id가 아님 |
| npcId | 아직 없습니다. 액터 문자열은 `mapleActorId` (`npc-foreman`, `npc-worker`) |

지식의 `assertion`은 `citation` 또는 `summary`입니다. `assertsFact`는 항상 거짓입니다. 연결을 승인해도 사실이 되지 않습니다.

## 상태가 화면을 움직입니다

`src/presentation.ts`는 서버가 준 `state`, `activity`, 과제 상태, 열린 질문 수만 봅니다.

- 질문 연출은 `waiting_user`이면서 열린 결정이 있을 때만 지휘석 앵커로 수평 이동을 제안합니다.
- 완료 배지는 과제 상태가 `done`이고 세션 상태도 `done`일 때만 켭니다. 걷기가 끝나도 완료가 아닙니다.
- 애니메이션 클립은 `null`입니다. 클립 이름과 RUID는 고르지 않았습니다.
- `staleAfterMs` 기본값은 없습니다. 초안의 15초는 제안이며, 릴레이가 그 시간으로 명령을 막지는 않습니다. 화면 도우미에 15초를 넘기면 쓰기 버튼만 목록에서 빠집니다.

이름표는 `별명 · S01 · 서버가 준 activity`입니다. NPC 스크립트의 `SlotLabel`은 사람이 매니페스트와 같게 적습니다.

## 아직 크리에이터에서 할 일

1. 빈 월드에 수평 바닥, 스폰, 카메라를 놓습니다.
2. 앵커 JSON의 자리를 타일 좌표로 옮기고, 빈 책상 네 곳에는 세션을 만들지 않습니다.
3. NPC 둘의 `SlotLabel`을 S01, S02로 맞춥니다. `LibraryX`는 도서관 바닥의 X입니다.
4. 도서관 UI 경로를 `LibraryHall` 프로퍼티와 같게 연결합니다.
5. 질문 때 NPC가 바닥 줄에 머무는지, 멈춘 것이 완료로 보이지 않는지 확인합니다.
6. 에셋 장부(`docs/resource-ledger.md`)에 실제로 고른 RUID만 나중에 적습니다. 지금은 비어 있습니다.

검토 구역 앵커는 예약만 되어 있습니다. diff와 머지 화면은 없습니다.
