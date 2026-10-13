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

// Prisma request errors whose meaning maps cleanly to an HTTP status. The
// client gets a generic message; field/model names stay in the server log.
const PRISMA_STATUS: Record<string, { status: number; error: string }> = {
  P2025: { status: 404, error: 'Not found' },
  P2002: { status: 409, error: 'Conflict' },
};

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
 * become 400; known Prisma codes map to 404/409; everything else is a generic
 * 500. Outside production the original message is added as `detail`.
 */
export function errorResponse(err: unknown, context: string, fallbackMessage = 'Internal server error') {
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
  } else if (e.name === 'PrismaClientKnownRequestError' && PRISMA_STATUS[e.code]) {
    ({ status, error } = PRISMA_STATUS[e.code]);
  }

  const body: Record<string, unknown> = { error };
  if (!isProduction() && typeof e.message === 'string') body.detail = e.message;
  return NextResponse.json(body, { status });
}
