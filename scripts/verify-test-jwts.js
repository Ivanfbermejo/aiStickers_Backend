/**
 * Minimal verification for TEST_JWTS parsing.
 * Covers the cases requested in issue #9:
 *   - absent variable
 *   - empty variable
 *   - invalid JSON
 *   - non-array JSON
 *   - valid array with tokens
 *
 * Run with: node scripts/verify-test-jwts.js
 */

import { parseTestJwts, env } from '../src/config/env.js';

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${message}`);
}

assert(Array.isArray(env.TEST_JWTS), 'env.TEST_JWTS is always an array');
assert(env.TEST_JWTS.length === 0, 'env.TEST_JWTS is empty when variable is absent');

assert(parseTestJwts(undefined).length === 0, 'undefined returns empty array');
assert(parseTestJwts('').length === 0, 'empty string returns empty array');
assert(parseTestJwts('   ').length === 0, 'whitespace-only string returns empty array');
assert(parseTestJwts('not-json').length === 0, 'invalid JSON returns empty array');
assert(parseTestJwts('{}').length === 0, 'non-array JSON returns empty array');
assert(parseTestJwts('["token-1"]').length === 1, 'valid array with one token returns one token');
assert(parseTestJwts('["token-1", "token-2"]').length === 2, 'valid array with two tokens returns two tokens');
assert(parseTestJwts('["token-1", "", 123, "token-2"]').length === 2, 'filters out empty strings and non-strings');

console.log('All TEST_JWTS parsing checks passed.');
