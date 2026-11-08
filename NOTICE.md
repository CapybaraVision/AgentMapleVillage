# Notices

AgentMapleVillage is an unofficial project. It is not affiliated with, endorsed by, or sponsored by Nexon, MapleStory, or MapleStory Worlds.

## MapleStory Worlds

Scripts under `msw/` are original source meant to be pasted into MapleStory Worlds Creator. They do not contain MapleStory or Nexon art, audio, map files, RUIDs, or a `.modpackage`. Platform API names are referenced from the public Creator Center documentation. Those names remain the property of their owners.

## AgentCraft

Behavior for goals, tasks, decisions, stations, and Claude session resume was investigated in:

- https://github.com/blendi-remade/agentcraft (MIT, Copyright (c) 2026 AgentCraft contributors)
- https://github.com/CapybaraVision/agentcraft commit `941170544b5298458928b3adcb50640ffaf498f1` on branch `cursor/security-ko-locale-782a`

No AgentCraft source file, asset, or Minecraft renderer is copied into this repository. The Foreman was not imported as a library. Session resume follows the same idea as AgentCraft's Claude engine (`resume` id captured from the stream and stored per session key) but the implementation here is new.

## agent-desktop

https://github.com/vercel-labs/agent-desktop is Apache-2.0. It is a computer-use CLI and does not contain a model loop. Its source is not vendored. `src/desktop.ts` is an original fail-closed interface.

## Claude Code

The CLI flag contract (`claude -p`, `--output-format stream-json`, `--resume`, `session_id`) is implemented behind a disabled-by-default driver. This repository does not ship Claude credentials or a Claude binary.
