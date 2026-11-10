/** Domain error with a stable code, an HTTP status and a German user message. */
export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500,
    readonly userMessage: string,
    readonly details?: unknown,
  ) {
    super(code);
  }
}

export const Errors = {
  slotTaken: () => new AppError('SLOT_TAKEN', 409, 'Dieser Termin ist leider nicht mehr frei. Bitte wählen Sie eine andere Uhrzeit.'),
  ruleViolation: (details: unknown) =>
    new AppError('RULE_VIOLATION', 422, 'Nicht möglich: Zeit belegt, in der Pause oder außerhalb der Öffnungszeiten.', details),
  ageRestricted: () =>
    new AppError('AGE_RESTRICTED', 422, 'Diese Behandlung ist für Minderjährige aus gesundheitlichen Gründen nicht verfügbar.'),
  invalidSelection: (code: string) => new AppError('INVALID_SELECTION', 422, 'Diese Leistung ist so nicht buchbar.', { code }),
  validation: (details: unknown) => new AppError('VALIDATION', 400, 'Bitte prüfen Sie Ihre Eingaben.', details),
  notFound: () => new AppError('NOT_FOUND', 404, 'Nicht gefunden.'),
  invalidLink: () => new AppError('INVALID_LINK', 404, 'Link ungültig oder abgelaufen.'),
  cutoffPassed: (phone: string) =>
    new AppError('CUTOFF_PASSED', 409, `Online-Änderungen sind nicht mehr möglich. Bitte rufen Sie uns an: ${phone}.`),
  notChangeable: () => new AppError('NOT_CHANGEABLE', 409, 'Dieser Termin kann nicht mehr geändert werden.'),
  versionConflict: () =>
    new AppError('VERSION_CONFLICT', 409, 'Der Termin wurde inzwischen geändert. Die Ansicht wurde aktualisiert.'),
  absenceConflict: (appointments: unknown) =>
    new AppError('ABSENCE_CONFLICT', 409, 'In diesem Zeitraum gibt es bereits Termine.', { appointments }),
  idempotencyMismatch: () =>
    new AppError('IDEMPOTENCY_MISMATCH', 422, 'Diese Anfrage wurde bereits mit anderen Daten gesendet.'),
  unauthorized: () => new AppError('UNAUTHORIZED', 401, 'Bitte melden Sie sich an.'),
  forbidden: () => new AppError('FORBIDDEN', 403, 'Keine Berechtigung.'),
  badCredentials: () => new AppError('BAD_CREDENTIALS', 401, 'Anmeldename oder Passwort ist falsch.'),
  rateLimited: () => new AppError('RATE_LIMITED', 429, 'Zu viele Anfragen. Bitte versuchen Sie es gleich noch einmal.'),
  csrf: () => new AppError('CSRF', 403, 'Anfrage abgelehnt.'),
};
