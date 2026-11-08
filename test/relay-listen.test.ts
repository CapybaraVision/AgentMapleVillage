import { describe, expect, it } from 'vitest';
import { resolveListenHost } from '../src/relay-listen.js';

describe('relay listen host', () => {
  it('stays on loopback unless a public bind is explicitly allowed', () => {
    expect(resolveListenHost(undefined, false)).toBe('127.0.0.1');
    expect(resolveListenHost('localhost', false)).toBe('localhost');
    expect(() => resolveListenHost('0.0.0.0', false)).toThrow(/loopback/);
    expect(resolveListenHost('0.0.0.0', true)).toBe('0.0.0.0');
  });
});
