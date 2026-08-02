import { describe, it, expect } from 'vitest';
import { randomId } from '../../src/utils/random-id.util.js';

describe('randomId', () => {
  it('returns a UUID when no byte length is provided', () => {
    const id = randomId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('returns a hex string of the requested byte length', () => {
    const id = randomId(12);
    expect(id).toMatch(/^[0-9a-f]{24}$/i);
  });

  it('generates different values on successive calls', () => {
    const a = randomId();
    const b = randomId();
    expect(a).not.toBe(b);
  });
});
