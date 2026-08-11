import { describe, it, expect } from 'vitest';
import { scrub, scrubString, CENSOR } from '../../src/infrastructure/observability/scrub.js';

describe('scrub', () => {
  it('redacts sensitive keys regardless of case', () => {
    const input = {
      authorization: 'Bearer secret-token',
      Cookie: 'session=abc',
      hmac: 'deadbeef',
      idToken: 'eyJhbGciOiJIUzI1NiJ9',
      accessToken: 'at',
      refreshToken: 'rt',
      purchaseToken: 'pt',
      receipt: 'receipt-data',
      email: 'user@example.com',
      prompt: 'a private prompt',
      password: 'hunter2',
      apiKey: 'pk_live_123',
      nested: { signature: 'sig' }
    };
    const out = scrub(input);
    expect(out.authorization).toBe(CENSOR);
    expect(out.Cookie).toBe(CENSOR);
    expect(out.hmac).toBe(CENSOR);
    expect(out.idToken).toBe(CENSOR);
    expect(out.accessToken).toBe(CENSOR);
    expect(out.refreshToken).toBe(CENSOR);
    expect(out.purchaseToken).toBe(CENSOR);
    expect(out.receipt).toBe(CENSOR);
    expect(out.email).toBe(CENSOR);
    expect(out.prompt).toBe(CENSOR);
    expect(out.password).toBe(CENSOR);
    expect(out.apiKey).toBe(CENSOR);
    expect(out.nested.signature).toBe(CENSOR);
  });

  it('redacts base64 strings when they are long', () => {
    const longBase64 = Buffer.alloc(64).toString('base64');
    expect(scrub(longBase64)).toBe(CENSOR);
  });

  it('keeps short safe strings', () => {
    expect(scrub('hello')).toBe('hello');
    expect(scrub(42)).toBe(42);
    expect(scrub(true)).toBe(true);
  });

  it('redacts emails inside arbitrary strings', () => {
    const input = 'Contact admin@example.com for help';
    expect(scrubString(input)).toBe(`Contact ${CENSOR} for help`);
  });

  it('redacts signed URLs when a sensitive query param is present', () => {
    const url = 'https://storage.example.com/object?X-Amz-Signature=abc123&token=secret&access_token=xyz&foo=bar';
    expect(scrubString(url)).toBe(CENSOR);
  });

  it('redacts data URI base64 payloads', () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const out = scrubString(dataUri);
    expect(out).toBe(`data:image/png;base64,${CENSOR}`);
  });

  it('sanitizes error objects without leaking stack in production mode', () => {
    const error = new Error('boom');
    error.code = 'E_BOOM';
    const out = scrub(error, { redactStack: true });
    expect(out.type).toBe('Error');
    expect(out.message).toBe('boom');
    expect(out.code).toBe('E_BOOM');
    expect(out.stack).toBeUndefined();
  });

  it('handles circular objects', () => {
    const a = { x: 1 };
    a.self = a;
    const out = scrub(a);
    expect(out.self).toBe('[Circular]');
  });

  it('redacts Authorization and Bearer tokens in free text while keeping the label', () => {
    const authHeader = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const bearer = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
    expect(scrubString(authHeader)).toBe(`Authorization: Bearer ${CENSOR}`);
    expect(scrubString(bearer)).toBe(`Bearer ${CENSOR}`);
  });

  it('does not leak sensitive values in scrubbed output', () => {
    const input = {
      email: 'admin@example.com',
      prompt: 'a private prompt',
      receipt: 'receipt-data',
      jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SHnOFAfQW0VvM61KS-abc',
      base64Payload: Buffer.from('secret payload').toString('base64'),
      objectKey: 'private/object/key.png',
      signedUrl: 'https://s3.example.com/bucket/private/object?X-Amz-Signature=abc123&access_token=xyz'
    };
    const out = JSON.stringify(scrub(input));
    expect(out).not.toMatch(/admin@example\.com/);
    expect(out).not.toMatch(/a private prompt/);
    expect(out).not.toMatch(/receipt-data/);
    expect(out).not.toMatch(/eyJ[A-Za-z0-9_-]+/);
    expect(out).not.toMatch(/secret payload/);
    expect(out).not.toMatch(/private\/object\/key/);
    expect(out).not.toMatch(/s3\.example\.com/);
    expect(out).not.toMatch(/X-Amz-Signature/);
    expect(out).not.toMatch(/abc123/);
    expect(out).not.toMatch(/xyz/);
    expect(out).toContain(CENSOR);
  });
});
