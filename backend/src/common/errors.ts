/**
 * Error hierarchy. Every error leaving the API is rendered by the error handler
 * into the envelope of ARCHITECTURE.md §8:
 *   { statusCode, error, code, message, details?, timestamp, path, requestId }
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly error: string,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown, message = 'Request validation failed') {
    super(400, 'VALIDATION_ERROR', 'VALIDATION_ERROR', message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', code = 'UNAUTHORIZED') {
    super(401, 'UNAUTHORIZED', code, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action', code = 'FORBIDDEN', details?: unknown) {
    super(403, 'FORBIDDEN', code, message, details);
  }
}

/** Two halves of a controlled pair attempted by the same person (§11.3). */
export class SegregationOfDutiesError extends AppError {
  constructor(message: string, details?: unknown) {
    super(403, 'SEGREGATION_OF_DUTIES', 'SEGREGATION_OF_DUTIES', message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, id?: string) {
    super(404, 'NOT_FOUND', 'NOT_FOUND', id ? `${entity} ${id} not found` : `${entity} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = 'CONFLICT', details?: unknown) {
    super(409, 'CONFLICT', code, message, details);
  }
}

export class StaleVersionError extends ConflictError {
  constructor(entity = 'Record') {
    super(`${entity} was changed by another user. Reload and try again.`, 'STALE_VERSION');
  }
}

/** A business rule was violated (422). `code` is a stable machine-readable identifier. */
export class BusinessRuleError extends AppError {
  constructor(code: string, message: string, details?: unknown) {
    super(422, 'BUSINESS_RULE_VIOLATION', code, message, details);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests, please slow down') {
    super(429, 'TOO_MANY_REQUESTS', 'RATE_LIMITED', message);
  }
}

interface PgErrorLike {
  code?: string;
  constraint?: string;
  detail?: string;
  table?: string;
}

/** Maps PostgreSQL errors to domain errors (unique → 409, FK → 409, check → 422, append-only → 409). */
export function mapPgError(err: unknown): AppError | undefined {
  const e = err as PgErrorLike;
  if (!e || typeof e.code !== 'string') return undefined;
  switch (e.code) {
    case '23505':
      return new ConflictError('A record with the same unique value already exists', 'DUPLICATE', { constraint: e.constraint });
    case '23503':
      return new ConflictError('The record references, or is referenced by, another record', 'REFERENCE_CONSTRAINT', {
        constraint: e.constraint,
      });
    case '23514':
      if (e.constraint?.endsWith('_sod')) {
        return new SegregationOfDutiesError('The same person cannot perform both controlled steps', { constraint: e.constraint });
      }
      return new BusinessRuleError('CHECK_CONSTRAINT', 'The values violate a data rule', { constraint: e.constraint });
    case 'P0A01':
      return new ConflictError('This ledger is append-only; post a reversal instead', 'APPEND_ONLY', { table: e.table });
    case '40001':
    case '40P01':
      return new ConflictError('Concurrent update detected, please retry', 'CONCURRENT_UPDATE');
    default:
      return undefined;
  }
}
