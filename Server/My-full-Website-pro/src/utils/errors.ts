export type AppErrorCode = 'NOT_CONFIGURED' | 'NETWORK' | 'TIMEOUT' | 'SERVER';

/** An error with a stable code the UI can map to a user-facing message. */
export class AppError extends Error {
  readonly code: AppErrorCode;

  constructor(code: AppErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AppError';
    this.code = code;
  }
}

const USER_MESSAGES: Record<AppErrorCode, string> = {
  NOT_CONFIGURED: 'טופס יצירת הקשר עדיין לא הוגדר. נסו שוב מאוחר יותר.',
  NETWORK: 'אין חיבור לרשת. בדקו את החיבור ונסו שוב.',
  TIMEOUT: 'השליחה לוקחת יותר מדי זמן. נסו שוב בעוד רגע.',
  SERVER: 'אירעה שגיאה בשליחה. נסו שוב מאוחר יותר.',
};

export const toUserMessage = (error: unknown): string =>
  error instanceof AppError ? USER_MESSAGES[error.code] : USER_MESSAGES.SERVER;
