export type RetryOptions = {
  maxAttempts: number;
  delays: number[];
  onRetry?: (attempt: number, error: Error) => void;
  delayFn?: (ms: number) => Promise<void>;
};

/**
 * Retry an async operation with exponential backoff delays.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  let lastError: Error | undefined;
  const delay = options.delayFn ?? ((ms: number) => new Promise(r => setTimeout(r, ms)));

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < options.maxAttempts) {
        options.onRetry?.(attempt, lastError);
        await delay(options.delays[attempt - 1] ?? 1000);
      }
    }
  }
  throw lastError!;
}
