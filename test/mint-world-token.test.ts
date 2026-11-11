import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { postJson } from '../src/http-client.js';
import { startRelay, type Relay } from '../src/relay.js';
import { mintWorldToken } from '../tools/mint-world-token.mjs';

class ManualClock {
  t = 1_700_000_000_000;
  now(): number {
    return this.t;
  }
}

const relays: Relay[] = [];

afterEach(async () => {
  await Promise.all(relays.splice(0).map((relay) => relay.close()));
});

function runCli(args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status: status ?? 1, stdout, stderr }));
  });
}

describe('mint world token', () => {
  it('reissues tokens for the saved village without printing them', async () => {
    const clock = new ManualClock();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amv-mint-'));
    const state = path.join(dir, 'relay-state.json');
    const rootToken = 'root-token-for-tests-only';
    const relay = await startRelay({ rootToken, clock, file: state });
    relays.push(relay);
    const created = await postJson<{ villageId: string; connectorToken: string; pairingCode: string }>(`${relay.url}/v1/villages`, { displayName: '마을' }, rootToken);
    const paired = await postJson<{ worldToken: string; refreshToken: string }>(`${relay.url}/v1/pair`, { pairingCode: created.pairingCode });
    await postJson(
      `${relay.url}/v1/commands`,
      { commandId: 'bind-keep', type: 'character.bind', issuedAt: clock.now(), payload: { sessionId: 'ses_worker', mapleActorId: 'npc-worker', displayName: '작업자', role: 'worker' } },
      paired.worldToken,
    );
    const rootFile = path.join(dir, 'relay-root-token');
    fs.writeFileSync(rootFile, `${rootToken}\n`);
    const mapPath = path.join(dir, 'map01.map');
    fs.writeFileSync(
      mapPath,
      JSON.stringify({
        ContentProto: {
          Entities: [
            {
              path: '/maps/map01/VillageRelay',
              jsonString: {
                '@components': [{ '@type': 'script.VillageRelay', RelayBase: 'https://tunnel.example/v1', WorldToken: paired.worldToken, LocalRelayBase: 'http://127.0.0.1:9999/v1' }],
              },
            },
          ],
        },
      }),
    );
    const minted = await mintWorldToken({
      rootFile,
      relay: relay.url,
      state,
      map: mapPath,
      outDir: path.join(dir, '.agentmaple'),
    });
    expect(minted.villageId).toBe(created.villageId);
    expect(minted.worldTokenLen).toBeGreaterThan(16);
    expect(minted.refreshTokenExpiresAt - minted.worldTokenExpiresAt).toBe(60 * 24 * 60 * 60 * 1000);
    const worldToken = fs.readFileSync(minted.worldFile, 'utf8').trim();
    const refreshToken = fs.readFileSync(minted.refreshFile, 'utf8').trim();
    expect(worldToken).not.toBe(paired.worldToken);
    const stateAfter = await postJson<{ ok: boolean }>(`${relay.url}/v1/state`, { afterEventSeq: 0 }, worldToken);
    expect(stateAfter.ok).toBe(true);
    await expect(postJson(`${relay.url}/v1/state`, { afterEventSeq: 0 }, paired.worldToken)).rejects.toMatchObject({ status: 403 });
    const saved = JSON.parse(fs.readFileSync(state, 'utf8')) as { villages: Array<{ commands: Array<{ commandId: string }> }> };
    expect(saved.villages[0]?.commands.map((command) => command.commandId)).toContain('bind-keep');
    const map = JSON.parse(fs.readFileSync(mapPath, 'utf8')) as {
      ContentProto: { Entities: Array<{ jsonString: { '@components': Array<Record<string, unknown>> } }> };
    };
    const component = map.ContentProto.Entities[0]?.jsonString['@components'][0];
    expect(component?.WorldToken).toBe(worldToken);
    expect(component?.WorldRefreshToken).toBe(refreshToken);
    expect(component?.WorldTokenExpiresAt).toBe(minted.worldTokenExpiresAt);
    expect(component?.RelayBase).toBe('https://tunnel.example/v1');
    expect(component?.LocalRelayBase).toBe('http://127.0.0.1:9999/v1');
    const backup = JSON.parse(fs.readFileSync(minted.backup, 'utf8')) as {
      ContentProto: { Entities: Array<{ jsonString: { '@components': Array<Record<string, string>> } }> };
    };
    expect(backup.ContentProto.Entities[0]?.jsonString['@components'][0]?.WorldToken).toBe(paired.worldToken);
    const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../tools/mint-world-token.mjs');
    const ran = await runCli([script, '--root-file', rootFile, '--relay', relay.url, '--state', state, '--out-dir', path.join(dir, 'cli-out')]);
    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.stdout).toContain('worldTokenLen=');
    expect(ran.stdout).not.toContain(worldToken);
    expect(ran.stdout).not.toContain(refreshToken);
    expect(ran.stdout).not.toContain(rootToken);
    expect(ran.stderr).not.toContain(worldToken);
  });
});
