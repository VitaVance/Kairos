/** Typed failures so callers never have to parse driver error strings. */

export type EntityKind = 'task' | 'list' | 'event';

/**
 * Thrown by write operations when the target row is missing.
 *
 * Reads (`get`) do **not** use this error: the core port returns `null` for a
 * miss. The distinction is intentional — a missing read is a normal outcome,
 * while an update against a missing row means the caller raced a delete and
 * must be told loudly.
 */
export class EntityNotFoundError extends Error {
  constructor(
    readonly entity: EntityKind,
    readonly id: string,
    readonly operation: 'create' | 'update' | 'remove',
  ) {
    super(`Cannot ${operation} ${entity} "${id}": not found`);
    this.name = 'EntityNotFoundError';
  }
}

/** Input cannot be persisted (e.g. a task without a list). */
export class InvalidEntityError extends Error {
  constructor(
    readonly entity: EntityKind,
    message: string,
  ) {
    super(`Invalid ${entity}: ${message}`);
    this.name = 'InvalidEntityError';
  }
}

/** A database row exists but does not match the domain contract. */
export class RowDecodeError extends Error {
  constructor(
    readonly table: string,
    message: string,
  ) {
    super(`Cannot decode row from "${table}": ${message}`);
    this.name = 'RowDecodeError';
  }
}
