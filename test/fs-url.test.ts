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

  it('treats a bare Windows path as a c: URL, which ESM will not load', () => {
    const windowsPath = 'C:\\Users\\pop49\\AppData\\Local\\Programs\\AgentMapleVillage\\tools\\deploy-msw-overlay.mjs';
    expect(new URL(windowsPath).protocol).toBe('c:');
    const specifier = `file:///${windowsPath.slice(0, 1)}:${windowsPath.slice(2).replaceAll('\\', '/')}`;
    expect(new URL(specifier).protocol).toBe('file:');
    expect(specifier).toBe('file:///C:/Users/pop49/AppData/Local/Programs/AgentMapleVillage/tools/deploy-msw-overlay.mjs');
  });
});
