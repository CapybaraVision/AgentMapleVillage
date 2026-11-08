import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { windowsFileUrlToPath } from '../src/fs-url.js';

const installed = 'file:///C:/Users/pop49/AppData/Local/Programs/AgentMapleVillage/test/msw-contract.test.ts';

describe('Windows file URL paths', () => {
  it('does not turn the installed tree into C:\\C:\\Users', () => {
    const filePath = windowsFileUrlToPath(installed);
    expect(filePath).toBe('C:\\Users\\pop49\\AppData\\Local\\Programs\\AgentMapleVillage\\test\\msw-contract.test.ts');
    const scripts = path.win32.resolve(path.win32.dirname(filePath), '..', 'msw', 'scripts');
    expect(scripts).toBe('C:\\Users\\pop49\\AppData\\Local\\Programs\\AgentMapleVillage\\msw\\scripts');
    expect(scripts.includes('C:\\C:\\')).toBe(false);
  });

  it('shows why URL.pathname is the wrong input on Windows', () => {
    const pathname = new URL(installed).pathname;
    expect(pathname.startsWith('/C:')).toBe(true);
    const doubled = `C:${pathname.replaceAll('/', '\\')}`;
    expect(doubled.startsWith('C:\\C:\\')).toBe(true);
  });
});
