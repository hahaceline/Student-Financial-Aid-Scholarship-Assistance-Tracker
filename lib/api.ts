
import { NextResponse } from 'next/server';
import type { ZodType, ZodTypeDef } from 'zod';
import { fieldErrorsOf } from '@/lib/utils';

export function jsonError(
  message: string,
  status: number,
  extra?: Record<string, unknown>
) {
  return NextResponse.json(
    { error: message, ...extra },
    { status }
  );
}

type Parsed<T> =
  | { data: T; error?: undefined }
  | { data?: undefined; error: NextResponse };

export function parseWith<T>(
  raw: unknown,
  schema: ZodType<T, ZodTypeDef, unknown>
): Parsed<T> {
  const parsed = schema.safeParse(raw);

  if (!parsed.success) {
    return {
      error: jsonError(
        parsed.error.issues[0]?.message ?? 'Invalid input.',
        422,
        { fieldErrors: fieldErrorsOf(parsed.error) }
      ),
    };
  }

  return { data: parsed.data };
}

export async function parseJson<T>(
  request: Request,
  schema: ZodType<T, ZodTypeDef, unknown>
): Promise<Parsed<T>> {
  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    return { error: jsonError('Invalid JSON body.', 400) };
  }

  return parseWith(raw, schema);
}

type DatabaseError = {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
};

function safeDiagnostic(value: string | null | undefined) {
  return (
    value
      ?.replace(
        /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
        '[redacted-email]'
      )
      .replace(
        /\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi,
        '[redacted-id]'
      )
      .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
      .replace(
        /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
        '[redacted-token]'
      ) ?? null
  );
}

function logDatabaseError(
  label: string,
  error: DatabaseError,
  operation?: string
) {
  console.error(label, {
    operation: operation ?? 'unclassified database operation',
    sqlstate: error.code ?? null,
    message: safeDiagnostic(error.message),
    details: safeDiagnostic(error.details),
    hint: safeDiagnostic(error.hint),
  });
}

// Maps Postgres/PostgREST errors to safe HTTP responses.
export function dbError(
  error: DatabaseError,
  operation?: string
) {
  switch (error.code) {
    case '42P01':
    case '42883':
    case '42703':
    case 'PGRST200':
    case 'PGRST202':
    case 'PGRST204':
    case 'PGRST205':
      logDatabaseError(
        'Required database schema is missing:',
        error,
        operation
      );

      return jsonError(
        'Scholarship database setup is incomplete. Apply the required database migrations and refresh the Supabase API schema cache.',
        503
      );

    case 'PGRST301':
    case 'PGRST302':
      return jsonError(
        'Your sign-in session is no longer valid. Please sign in again.',
        401
      );

    case '42501':
      logDatabaseError(
        'Database authorization denied:',
        error,
        operation
      );

      return jsonError(
        'The database denied this operation. Please check the server logs for the exact cause.',
        403
      );

    case 'P0002':
      return jsonError(error.message, 404);

    case 'P0001':
      return jsonError(error.message, 422);

    case '23505':
      return jsonError(
        'A matching record already exists.',
        409
      );

    case '23503':
      return jsonError(
        'A related record could not be found.',
        422
      );

    case '23514':
    case '22P02':
      return jsonError(
        'Some of the submitted values are not valid.',
        422
      );

    default:
      logDatabaseError('Database error:', error, operation);

      return jsonError(
        'A database error occurred. Please try again.',
        500
      );
  }
}