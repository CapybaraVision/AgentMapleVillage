# Process-local Windows check. Does not change the machine Node, AgentCraft, or open a port.
# Close this window to drop the temporary PATH. Claude starts only with -RunClaude.
param(
  [string]$NodeExe = "",
  [switch]$RunClaude
)

$ErrorActionPreference = "Stop"
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $repo

if ($NodeExe -eq "") {
  Write-Error "Pass -NodeExe with the full path of a Node 24 node.exe. Do not rely on the default node on PATH."
}

$nodeDir = Split-Path $NodeExe -Parent
$env:PATH = "$nodeDir;$env:PATH"
& $NodeExe --version
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not $RunClaude) {
  Write-Output "Claude probe not started. Re-run with -RunClaude only after this Windows user is already signed in to claude."
  exit 2
}

if (-not (Test-Path (Join-Path $repo "node_modules\tsx"))) {
  npm ci
}
$env:AGENTMAPLE_RUN_CLAUDE_PROBE = "1"
try {
  npx tsx (Join-Path $repo "src\bin\claude-readonly-probe.ts")
  exit $LASTEXITCODE
} finally {
  Remove-Item Env:AGENTMAPLE_RUN_CLAUDE_PROBE -ErrorAction SilentlyContinue
}
