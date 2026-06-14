export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_DELAYS = [1000, 2000, 4000];

export type RetryOptions = {
  maxAttempts?: number;
  delays?: number[];
  onRetry?: (attempt: number, error: Error) => void;
  delayFn?: (ms: number) => Promise<void>;
};

/**
 * Retry an async operation with exponential backoff delays.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  let lastError: Error | undefined;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const delays = options.delays ?? DEFAULT_DELAYS;
  const delay = options.delayFn ?? ((ms: number) => new Promise(r => setTimeout(r, ms)));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts) {
        options.onRetry?.(attempt, lastError);
        await delay(delays[attempt - 1] ?? 1000);
      }
    }
  }
  throw lastError!;
}
