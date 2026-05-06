export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class ProviderError extends Error {
  public readonly providerStatusCode?: number;
  public readonly retryable: boolean;
  public readonly code: string;

  constructor(code: string, message: string, retryable: boolean, providerStatusCode?: number) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.providerStatusCode = providerStatusCode;
  }
}
