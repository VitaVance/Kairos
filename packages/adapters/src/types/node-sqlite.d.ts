/**
 * Minimal ambient types for Node's built-in SQLite (Node 22.5+ / stable in 24+).
 * TypeScript 5.9 does not ship these yet, and pulling @types/node's newest
 * version just for one test file is not worth the dependency drift.
 * Only the members used by `test/sqlite-real.test.ts` are declared.
 */
declare module 'node:sqlite' {
  interface Statement {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): Statement;
    close(): void;
  }
}
