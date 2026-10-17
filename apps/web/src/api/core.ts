// Shared plumbing for the demo API. Every service function in src/api/ goes
// through `handle`, which adds a short network-like delay and returns deep
// copies, so the UI behaves as it will against the real HTTP API (spec decision #9).

export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'CYCLE'
  | 'TOO_MANY_PARENTS';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ApiError';
    this.code = code;
    this.status =
      code === 'UNAUTHENTICATED'
        ? 401
        : code === 'FORBIDDEN'
          ? 403
          : code === 'NOT_FOUND'
            ? 404
            : code === 'VALIDATION'
              ? 422
              : 409;
  }
}

const LATENCY_MS = 120;

export async function handle<T>(fn: () => T): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS + Math.random() * 120));
  return structuredClone(fn());
}
