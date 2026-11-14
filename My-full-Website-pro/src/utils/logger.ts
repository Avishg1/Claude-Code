/**
 * Single place for error reporting. Today it writes to the console;
 * to add a monitoring service (Sentry, LogRocket…), wire it in here only.
 */
export const logError = (error: unknown, context?: Record<string, unknown>): void => {
  console.error('[app error]', error, context ?? '');
};
