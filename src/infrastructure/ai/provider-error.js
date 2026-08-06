export class ProviderError extends Error {
  constructor(message, { code = 'PROVIDER_ERROR', terminal = false, transient = true } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.terminal = terminal;
    this.transient = transient;
  }
}

export function providerHttpError(status) {
  const terminal = status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status);
  return new ProviderError(
    `Provider request failed (${status})`,
    { code: `PROVIDER_HTTP_${status}`, terminal, transient: !terminal }
  );
}
