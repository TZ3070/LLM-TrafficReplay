import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createUuid } from '../src/uuid';

function withCrypto(provider: unknown, run: () => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: provider });
  try { run(); }
  finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else Reflect.deleteProperty(globalThis, 'crypto');
  }
}

test('UUID generation uses the native method with its Crypto receiver when available', () => {
  const uuid = '00112233-4455-4677-8899-aabbccddeeff';
  const provider = {
    randomUUID() { assert.equal(this, provider); return uuid; },
    getRandomValues() { throw new Error('native UUID should be used'); }
  };
  withCrypto(provider, () => assert.equal(createUuid(), uuid));
});

test('HTTP fallback produces UUID v4 with the RFC variant and preserves random bits', () => {
  for (const fill of [0, 255]) {
    const provider = {
      getRandomValues(bytes: Uint8Array) {
        assert.equal(this, provider);
        assert.equal(bytes.length, 16);
        return bytes.fill(fill);
      }
    };
    withCrypto(provider, () => assert.equal(createUuid(), fill === 0
      ? '00000000-0000-4000-8000-000000000000'
      : 'ffffffff-ffff-4fff-bfff-ffffffffffff'));
  }
});

test('missing random APIs report an actionable error instead of using weak randomness', () => {
  for (const provider of [undefined, {}]) {
    withCrypto(provider, () => assert.throws(createUuid, /无法生成回放标识/));
  }
});
