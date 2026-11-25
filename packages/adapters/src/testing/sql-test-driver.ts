import type { SqlDriver } from '../sql-driver.js';

/**
 * Test-only recording driver.
 *
 * There is deliberately NO native sqlite dependency in this package: the real
 * driver is supplied by the host (Tauri's plugin-sql, RN's op-sqlite). Tests
 * therefore take two complementary approaches:
 *
 * 1. Behavioural round trips run against `MemoryUnitOfWork` (same semantics,
 *    no platform).
 * 2. SQL shape is asserted with this `RecordingSqlDriver`: it records every
 *    statement so tests can prove `migrate` is idempotent and that writes use
 *    `?` placeholders with allowlisted column names and no interpolated values.
 *
 * If a future host needs end-to-end SQL verification, inject that host's
 * driver here — the repositories only ever see the `SqlDriver` port.
 */

export interface RecordedStatement {
  readonly kind: 'execute' | 'query';
  readonly sql: string;
  readonly params: readonly unknown[];
}

export class RecordingSqlDriver implements SqlDriver {
  readonly statements: RecordedStatement[] = [];
  /** Rows returned by successive `query` calls (consumed FIFO). */
  private readonly queuedRows: unknown[][] = [];

  constructor(initialRows: readonly (readonly unknown[])[] = []) {
    for (const rows of initialRows) this.queueRows(rows);
  }

  async execute(sql: string, params?: readonly unknown[]): Promise<void> {
    this.statements.push({ kind: 'execute', sql, params: params ?? [] });
  }

  async query<T>(sql: string, params?: readonly unknown[]): Promise<readonly T[]> {
    this.statements.push({ kind: 'query', sql, params: params ?? [] });
    const next = this.queuedRows.shift();
    return (next ?? []) as readonly T[];
  }

  /** Queue the rows a future `query` call should return. */
  queueRows(rows: readonly unknown[]): void {
    this.queuedRows.push([...rows]);
  }

  /** All SQL strings, in issue order. */
  sql(): readonly string[] {
    return this.statements.map((statement) => statement.sql);
  }

  /** Recorded statements whose SQL contains `fragment` (case-insensitive). */
  find(fragment: string): readonly RecordedStatement[] {
    const needle = fragment.toLowerCase();
    return this.statements.filter((statement) => statement.sql.toLowerCase().includes(needle));
  }

  clear(): void {
    this.statements.length = 0;
    this.queuedRows.length = 0;
  }
}
