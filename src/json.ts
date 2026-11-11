import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashesEqual(leftHex: string, rightHex: string): boolean {
  const left = Buffer.from(leftHex, 'hex');
  const right = Buffer.from(rightHex, 'hex');
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function randomToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString('base64url')}`;
}

const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function pairingCode(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i += 1) out += PAIRING_ALPHABET[bytes[i]! % PAIRING_ALPHABET.length];
  return out;
}

export function secretsMatch(expected: string, presented: string): boolean {
  const left = createHash('sha256').update(expected).digest();
  const right = createHash('sha256').update(presented).digest();
  return timingSafeEqual(left, right);
}
