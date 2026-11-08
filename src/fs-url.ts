/**
 * file: URL to a filesystem path.
 * `new URL(import.meta.url).pathname` is `/C:/...` on Windows. `path.resolve`
 * then roots that on the current drive and the installed tree was opened as
 * `C:\C:\Users\...`. `fileURLToPath` is the supported conversion.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function moduleDir(metaUrl: string | URL): string {
  return path.dirname(fileURLToPath(metaUrl));
}

/** Win32 file URL path, safe to unit-test on other platforms. */
export function windowsFileUrlToPath(fileUrl: string): string {
  const url = new URL(fileUrl);
  if (url.protocol !== 'file:') throw new Error('not a file URL');
  let pathname = decodeURIComponent(url.pathname);
  if (/^\/[A-Za-z]:/.test(pathname)) pathname = pathname.slice(1);
  return pathname.replaceAll('/', '\\');
}
