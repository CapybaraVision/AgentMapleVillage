# Windows에서 이 커밋을 검사하는 절차

이 문서는 집 PC의 한 PowerShell 창에서만 실행하는 절차입니다. 기본 Node, Minecraft AgentCraft 설치, 방화벽, 계정은 바꾸지 않습니다. 클라우드에서는 Claude를 호출하지 않았습니다.

## 받아 둔 소스

검사 대상은 `git rev-parse HEAD`의 전체 SHA입니다. 짧은 해시로 나머지 글자를 만들지 마세요. 배포 zip은 그 커밋의 `git archive`입니다. zip 안의 파일이 저장소에 없는 비밀이나 프로필을 포함하면 안 됩니다.

zip을 푼 디렉터리는 AgentCraft 폴더와 달라야 합니다. 예: `%USERPROFILE%\AgentMapleVillage`. AgentCraft 쪽 파일은 수정하지 않습니다.

## Node 24는 이 창에서만

기본 `node`가 20이어도 그대로 둡니다. Node 24의 `node.exe` 전체 경로를 이 창의 PATH 앞에만 붙입니다. 설치 프로그램으로 시스템 Node를 바꾸지 않습니다.

```powershell
$node = "C:\path\to\node-v24\node.exe"
& $node --version
$env:PATH = "$(Split-Path $node);$env:PATH"
npm ci
npm test
npm run typecheck
```

`npm test`는 가짜 Claude 프로세스만 사용합니다. 모델 호출이 아닙니다.

## 릴레이와 커넥터

수신 주소는 `127.0.0.1`입니다. `0.0.0.0`으로 열지 않습니다. 포트를 외부에 열지 않습니다.

```powershell
$env:RELAY_ROOT_TOKEN = "<이 창에서만 정한 16자 이상. 채팅에 붙여 넣지 말 것>"
$env:RELAY_HOST = "127.0.0.1"
$env:RELAY_PORT = "8787"
npx tsx src/bin/relay.ts
```

다른 창에서 `config/connector.example.json`의 `relayUrl`이 `http://127.0.0.1:8787`인지 확인하고 `npx tsx src/bin/connector.ts config/connector.example.json`을 실행합니다. 페어링 코드는 그 창에만 표시됩니다.

## 메이플 클라우드가 이 릴레이에 닿지 않는 이유

메이플스토리 월드 서버는 집 PC의 `127.0.0.1`로 들어올 수 없습니다. 공개 HTTPS로 올리는 작업은 이번 범위에 없습니다. 기존 Cloudflare 연결이 있어도 여기서 계정을 고르거나 배포하지 않습니다. 월드를 붙이려면 그 배포를 따로 정해야 합니다. 그때도 릴레이는 셸을 실행하지 않습니다.

## Claude Code 읽기 전용 확인

클라우드에는 `claude` 로그인과 `AGENTMAPLE_RUN_CLAUDE_PROBE`가 없습니다. 집 PC에서 이미 `claude` 로그인이 끝난 뒤에만, 빈 임시 폴더에서 다음을 실행합니다.

```powershell
powershell -File scripts\windows\validate-claude.ps1 -NodeExe $node -RunClaude
```

하는 일:

1. 빈 디렉터리를 만듭니다.
2. `claude -p`에 `--output-format json`, `--max-turns 1`, `--max-budget-usd 0.05`, `--tools` 빈 목록, `--permission-mode default`만 붙입니다.
3. `session_id`를 읽고, 같은 빈 디렉터리에서 `--resume`으로 한 번 더 묻습니다.
4. 두 `session_id`가 같아야 성공입니다.
5. 각 실행은 45초를 넘기면 프로세스를 끝냅니다.

`--dangerously-skip-permissions`, `bypassPermissions`, `--allowedTools`는 코드에서 거부합니다. 출력 JSON에 환경 변수는 찍지 않습니다. 이 확인은 읽기 전용 한 단어 응답입니다. 사무실의 쓰기 작업이 검증된 것은 아닙니다.
