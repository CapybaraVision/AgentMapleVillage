import fs from 'node:fs';
import { Connector } from '../connector.js';
import { claudeBackend, simBackend } from '../office.js';
import { ClaudeCodeCliDriver } from '../claude-driver.js';
import { createDesktopAdapter } from '../desktop.js';

interface FileConfig {
  relayUrl: string;
  profileDir: string;
  backend?: 'sim' | 'claude';
  pollIntervalMs?: number;
  desktopEnabled?: boolean;
  claudeEnabled?: boolean;
}

const configPath = process.argv[2] ?? 'config/connector.example.json';
if (!fs.existsSync(configPath)) {
  console.error(`Config not found: ${configPath}`);
  console.error('Copy config/connector.example.json and set RELAY_ROOT_TOKEN in the environment.');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as FileConfig;
const backendName = config.backend ?? 'sim';
const desktop = createDesktopAdapter({ enabled: config.desktopEnabled === true });
const claude = new ClaudeCodeCliDriver({ enabled: config.claudeEnabled === true });
const backend = backendName === 'claude' ? claudeBackend(claude) : simBackend();

if (backendName === 'claude' && config.claudeEnabled !== true) {
  console.error('backend claude requires claudeEnabled true, and that path is unverified in this workspace.');
  process.exit(1);
}

const connector = new Connector({
  relayUrl: config.relayUrl,
  profileDir: config.profileDir,
  ...(process.env.RELAY_ROOT_TOKEN ? { rootToken: process.env.RELAY_ROOT_TOKEN } : {}),
  backend,
  desktop,
});

const created = await connector.ensureVillage();
console.log(`village ${created.villageId}`);
if (created.pairingCode) {
  console.log(`pairing code (one time, expires soon): ${created.pairingCode}`);
}
console.log(`desktop: ${desktop.describe()}`);
console.log(`backend: ${backendName}`);

const interval = config.pollIntervalMs ?? 1000;
setInterval(() => {
  void connector.pollOnce().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'poll failed';
    console.error(`poll failed: ${message}`);
  });
}, interval);
