/**
 * Throw this to signal a permanent failure that should NOT be retried.
 * e.g. missing credentials, 404 Not Found, 401 Unauthorized.
 */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentError";
  }
}

/**
 * Retry helper with exponential backoff.
 * Throws the last error after maxAttempts.
 * Throws immediately if a PermanentError is encountered.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 5,
  baseDelayMs = 500
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      // Don't retry permanent failures
      if (err instanceof PermanentError) break;
      if (attempt === maxAttempts) break;
      const delay = baseDelayMs * Math.pow(2, attempt - 1); // 500, 1000, 2000, 4000…
      const jitter = Math.random() * 200;
      console.warn(
        `[retry] attempt ${attempt}/${maxAttempts} failed, retrying in ${Math.round(delay + jitter)}ms`,
        err instanceof Error ? err.message : err
      );
      await sleep(delay + jitter);
    }
  }
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
