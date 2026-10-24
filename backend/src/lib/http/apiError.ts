import { NextResponse } from 'next/server';

/**
 * An error whose message is safe to show to the API caller (validation and
 * business-rule failures). Anything else thrown inside a route handler is
 * treated as internal and never has its message sent to the client.
 */
export class PublicError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = 'PublicError';
  }
}

const isProduction = () => process.env.NODE_ENV === 'production';

// Prisma errors whose meaning maps cleanly to an HTTP status. The client gets
// a plain-language message; field/model names stay in the server log.
const DB_DOWN = { status: 503, error: "The database can't be reached right now. Please try again in a minute." };
const DB_OUTDATED = {
  status: 500,
  error: 'The server database is missing a recent update. Ask an admin to apply the latest database migration.',
};
const PRISMA_STATUS: Record<string, { status: number; error: string }> = {
  P2025: { status: 404, error: "We couldn't find that record. It may have been deleted." },
  P2002: { status: 409, error: 'That already exists. Use a different value and try again.' },
  P2003: { status: 400, error: 'That refers to a record that no longer exists.' },
  P2021: DB_OUTDATED, // table missing
  P2022: DB_OUTDATED, // column missing
  P1001: DB_DOWN,
  P1002: DB_DOWN,
  P1008: DB_DOWN,
  P1017: DB_DOWN,
};

/** Response for a request naming a therapist/client profile the caller doesn't
 *  own. Usually the page is still showing an older signed-in profile; the
 *  frontend reloads the profile when it sees this code. */
export function notYourProfile(what = 'this') {
  return NextResponse.json(
    {
      error: `Your account doesn't have access to ${what}. If you recently switched accounts, refresh the page or sign in again.`,
      code: 'PROFILE_MISMATCH',
    },
    { status: 403 }
  );
}

/**
 * Builds a minimal, non-sensitive description of an error for logging.
 *
 * Error messages can embed patient data (Prisma validation errors print the
 * whole query including argument values; Twilio/SMTP/LLM errors can echo the
 * request), so in production only the error name, code and Prisma schema
 * metadata are logged. Outside production the message and stack are kept for
 * local debugging.
 */
export function safeErrorSummary(err: unknown): Record<string, unknown> {
  const e = (err ?? {}) as any;
  const summary: Record<string, unknown> = {
    name: typeof e.name === 'string' ? e.name : typeof err,
  };
  if (typeof e.code === 'string' || typeof e.code === 'number') summary.code = e.code;
  if (typeof e.status === 'number') summary.status = e.status;
  if (e.meta && typeof e.meta === 'object') {
    // Prisma metadata: schema names only, never values.
    for (const key of ['modelName', 'target', 'field_name']) {
      if (e.meta[key] !== undefined) summary[key] = e.meta[key];
    }
  }
  if (err instanceof PublicError) {
    summary.message = err.message;
  } else if (!isProduction()) {
    summary.message = e.message;
    summary.stack = e.stack;
  }
  return summary;
}

/** Logs an unexpected error under a short context label, without sensitive detail. */
export function logError(context: string, err: unknown) {
  console.error(`[${context}]`, safeErrorSummary(err));
}

/**
 * Converts an error thrown inside a route handler into a client response.
 * PublicError messages pass through with their status; malformed JSON bodies
 * become 400; known Prisma codes (not found, duplicate, database down or missing
 * a migration) get specific messages; everything else is a generic
 * 500. Outside production the original message is added as `detail`.
 */
export function errorResponse(
  err: unknown,
  context: string,
  fallbackMessage = 'Something went wrong on our side. Please try again, and contact support if it keeps happening.'
) {
  if (err instanceof PublicError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  logError(context, err);

  let status = 500;
  let error = fallbackMessage;
  const e = (err ?? {}) as any;
  if (err instanceof SyntaxError) {
    status = 400;
    error = 'Invalid request body';
  } else if (PRISMA_STATUS[e.code] && String(e.name).startsWith('PrismaClient')) {
    ({ status, error } = PRISMA_STATUS[e.code]);
  } else if (e.name === 'PrismaClientInitializationError') {
    ({ status, error } = DB_DOWN);
  }

  const body: Record<string, unknown> = { error };
  if (!isProduction() && typeof e.message === 'string') body.detail = e.message;
  return NextResponse.json(body, { status });
}
