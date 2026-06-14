/**
 * Sanitize error messages before persisting to database.
 * Removes potential secrets like GitHub tokens (ghp_), truncates long bodies.
 */
export function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  
  const sanitized = message
    .replace(/gh[pousr]_[a-zA-Z0-9]{36,}/g, '[REDACTED]')
    .replace(/github_pat_[a-zA-Z0-9_]{82}/g, '[REDACTED]');
  
  if (sanitized.length > 500) {
    return sanitized.slice(0, 500) + '... (truncated)';
  }
  
  return sanitized;
}
