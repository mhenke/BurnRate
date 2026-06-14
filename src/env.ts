/**
 * Expand `${ENV_VAR}` placeholders in a string using `process.env`.
 * Unresolved variables are replaced with an empty string.
 *
 * @param value String potentially containing `${VAR_NAME}` tokens.
 * @returns The input string with all `${VAR_NAME}` tokens substituted.
 */
export function expandEnv(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => process.env[name] ?? '');
}
