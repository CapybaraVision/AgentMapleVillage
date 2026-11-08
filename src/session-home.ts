import fs from 'node:fs';
import path from 'node:path';

const SESSION_RE = /^ses_[A-Za-z0-9_-]{1,64}$/;

export function sessionHome(profileDir: string, sessionId: string): string {
  if (!SESSION_RE.test(sessionId)) throw new Error('invalid session id for a workspace path');
  return path.join(profileDir, 'sessions', sessionId);
}

export function ensureSessionHome(profileDir: string, sessionId: string, role: string): string {
  const dir = sessionHome(profileDir, sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const marker = path.join(dir, 'bound.json');
  if (!fs.existsSync(marker)) {
    fs.writeFileSync(marker, `${JSON.stringify({ sessionId, role }, null, 2)}\n`);
  }
  return dir;
}
