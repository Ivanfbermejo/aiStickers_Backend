import { describe, it, expect } from 'vitest';
import { parseTestJwts } from '../../src/config/env.js';

describe('parseTestJwts', () => {
  it('returns an empty array for undefined or empty values', () => {
    expect(parseTestJwts(undefined)).toEqual([]);
    expect(parseTestJwts('')).toEqual([]);
    expect(parseTestJwts('   ')).toEqual([]);
  });

  it('returns an empty array for invalid JSON', () => {
    expect(parseTestJwts('not-json')).toEqual([]);
  });

  it('returns an empty array for non-array JSON', () => {
    expect(parseTestJwts('{"token":"abc"}')).toEqual([]);
  });

  it('returns only non-empty string entries', () => {
    const input = JSON.stringify(['valid.token', '', 123, null, '   ', 'another.token']);
    expect(parseTestJwts(input)).toEqual(['valid.token', 'another.token']);
  });
});
