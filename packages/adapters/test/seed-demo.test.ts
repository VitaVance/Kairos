import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { duePrecisionOf, quadrantOf } from '@todolist/core';
import type { Task } from '@todolist/core';
import {
  CryptoIdGenerator,
  MemoryUnitOfWork,
  ONBOARDING_DISMISSED_KEY,
  SystemClock,
  resetAllData,
  seedDemoData,
} from '../src/index.js';
import type { SeedDeps } from '../src/index.js';
import { migrate } from '../src/sqlite/schema.js';
import { SqliteUnitOfWork } from '../src/sqlite/SqliteUnitOfWork.js';
import type { SqlDriver } from '../src/sql-driver.js';

function memoryDeps(): SeedDeps {
  return { uow: new MemoryUnitOfWork(), clock: new SystemClock(), ids: new CryptoIdGenerator() };
}

async function snapshot(uow: SeedDeps['uow']) {
  const [lists, tasks, events] = await Promise.all([
    uow.lists.list(),
    uow.tasks.list(),
    uow.events.list(),
  ]);
  return { lists, tasks, events };
}

/** Local calendar day of an instant, matching how the seed places wall clocks. */
function localDay(instant: string): string {
  const d = new Date(instant);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayLocal(): string {
  return localDay(new Date().toISOString());
}

describe('seedDemoData — content', () => {
  it('seeds the four lists in a stable order and colour', async () => {
    const deps = memoryDeps();
    await seedDemoData(deps);
    const { lists } = await snapshot(deps.uow);
    expect(lists.map((l) => l.name)).toEqual(['收集箱', '工作', '学习', '生活']);
    expect(lists.map((l) => l.color)).toEqual(['#dd7366', '#5b8def', '#8b79c9', '#d99a3d']);
  });

  it('demonstrates all four scheduling precisions, one task each', async () => {
    const deps = memoryDeps();
    await seedDemoData(deps);
    const { tasks } = await snapshot(deps.uow);

    const byPrecision = new Map<string, Task[]>();
    for (const task of tasks) {
      const key = duePrecisionOf(task);
      byPrecision.set(key, [...(byPrecision.get(key) ?? []), task]);
    }

    for (const precision of ['none', 'day', 'period', 'time'] as const) {
      expect(byPrecision.get(precision)?.length ?? 0, `no task with precision "${precision}"`).toBeGreaterThan(0);
    }

    // The precision is also legible from the title alone — a month cell shows
    // only that, so the tour has to survive there.
    const titles = tasks.map((t) => t.title);
    expect(titles).toContain('未排期：随手记');
    expect(titles).toContain('全天：整理相册');
    expect(titles).toContain('下午：回客户邮件');
    expect(titles.some((t) => /^\d{1,2}:\d{2}\s/.test(t))).toBe(true);

    const period = byPrecision.get('period')![0]!;
    expect(period.duePeriod).toBe('afternoon');
    expect(period.allDay).toBe(true);
  });

  it('populates all four quadrants', async () => {
    const deps = memoryDeps();
    await seedDemoData(deps);
    const { tasks } = await snapshot(deps.uow);
    const quadrants = new Set(tasks.map((t) => quadrantOf(t)));
    expect([...quadrants].sort()).toEqual(
      ['not-urgent-important', 'unimportant', 'urgent-important', 'urgent-not-important'].sort(),
    );
  });

  it('includes one recurring task whose notes say it repeats', async () => {
    const deps = memoryDeps();
    await seedDemoData(deps);
    const { tasks } = await snapshot(deps.uow);
    const recurring = tasks.filter((t) => t.recurrence !== null);
    expect(recurring).toHaveLength(1);
    expect(recurring[0]!.recurrence?.frequency).toBe('weekly');
    expect(recurring[0]!.notes).toMatch(/重复/);
    // The first instance is always ahead of today, never in the past.
    expect(recurring[0]!.dueDate! >= todayLocal()).toBe(true);
  });

  it('mentions the drag-between-quadrants and Ctrl+K affordances in notes', async () => {
    const deps = memoryDeps();
    await seedDemoData(deps);
    const { tasks } = await snapshot(deps.uow);
    const notes = tasks.map((t) => t.notes).join('\n');
    expect(notes).toMatch(/象限/);
    expect(notes).toMatch(/Ctrl\+K/);
  });

  it('seeds exactly one completed task with a completion timestamp', async () => {
    const deps = memoryDeps();
    await seedDemoData(deps);
    const { tasks } = await snapshot(deps.uow);
    const done = tasks.filter((t) => t.status === 'done');
    expect(done).toHaveLength(1);
    expect(done[0]!.completedAt).not.toBeNull();
  });

  it('stays inside the agreed budget: ~15–18 tasks, 10–12 events', async () => {
    const deps = memoryDeps();
    await seedDemoData(deps);
    const { tasks, events } = await snapshot(deps.uow);
    expect(tasks.length).toBeGreaterThanOrEqual(15);
    expect(tasks.length).toBeLessThanOrEqual(18);
    expect(events.length).toBeGreaterThanOrEqual(10);
    expect(events.length).toBeLessThanOrEqual(12);
  });

  it('lays events out on the current week, include one today, without piling up', async () => {
    const deps = memoryDeps();
    await seedDemoData(deps);
    const { events } = await snapshot(deps.uow);

    const today = todayLocal();
    expect(events.some((e) => localDay(e.startAt) === today)).toBe(true);

    // A 7-day window from today must contain a meaningful share of the events,
    // otherwise the week/day views open empty even though the data exists.
    const weekFar = new Date();
    weekFar.setDate(weekFar.getDate() + 6);
    const weekEnd = localDay(weekFar.toISOString());
    const inWeek = events.filter((e) => {
      const day = localDay(e.startAt);
      return day >= today && day <= weekEnd;
    });
    expect(inWeek.length).toBeGreaterThanOrEqual(4);

    // No two events start at the same hour on the same day: the month grid
    // must not look like one dense block.
    const slots = events.map((e) => `${localDay(e.startAt)} ${new Date(e.startAt).getHours()}`);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it('dates everything relative to today, not to a hardcoded calendar', async () => {
    const deps = memoryDeps();
    await seedDemoData(deps);
    const { tasks, events } = await snapshot(deps.uow);

    // Every timestamp must be within a couple of weeks of now. A hardcoded
    // date would fall outside this window almost immediately.
    const now = Date.now();
    for (const event of events) {
      expect(Math.abs(Date.parse(event.startAt) - now)).toBeLessThan(21 * 86_400_000);
    }
    for (const task of tasks) {
      if (task.dueAt !== null) {
        expect(Math.abs(Date.parse(task.dueAt) - now)).toBeLessThan(21 * 86_400_000);
      }
    }
  });
});

describe('seedDemoData — idempotence', () => {
  it('seeds one dataset when run twice (StrictMode double-invoke)', async () => {
    const deps = memoryDeps();
    await seedDemoData(deps);
    const first = await snapshot(deps.uow);

    await seedDemoData(deps);
    const second = await snapshot(deps.uow);

    expect(second.lists).toHaveLength(first.lists.length);
    expect(second.tasks).toHaveLength(first.tasks.length);
    expect(second.events).toHaveLength(first.events.length);
  });

  it('records the dismissed flag so a non-empty database is never re-seeded', async () => {
    const deps = memoryDeps();
    await seedDemoData(deps);
    expect(await (deps.uow as MemoryUnitOfWork).settings.get(ONBOARDING_DISMISSED_KEY)).not.toBeNull();
  });
});

describe('resetAllData', () => {
  it('removes tasks, events and lists', async () => {
    const deps = memoryDeps();
    await seedDemoData(deps);
    await resetAllData(deps);

    const { lists, tasks, events } = await snapshot(deps.uow);
    expect(lists).toHaveLength(0);
    expect(tasks).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it('does NOT re-seed on a subsequent boot (the flag is the whole point)', async () => {
    const deps = memoryDeps();
    await seedDemoData(deps);
    await resetAllData(deps);

    // Exactly what App.tsx's boot() does on the next launch.
    await seedDemoData(deps);

    const { lists, tasks, events } = await snapshot(deps.uow);
    expect(lists).toHaveLength(0);
    expect(tasks).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it('is safe to run twice', async () => {
    const deps = memoryDeps();
    await seedDemoData(deps);
    await resetAllData(deps);
    await expect(resetAllData(deps)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The same guarantees against a real SQLite engine: the memory adapter falling
// back to a flag is not proof that the shipped (SQLite) path behaves.
// ---------------------------------------------------------------------------

function realDriver(): SqlDriver {
  const db = new DatabaseSync(':memory:');
  return {
    async execute(sql: string, params: readonly unknown[] = []) {
      db.prepare(sql).run(...(params as unknown[]));
    },
    async query<T>(sql: string, params: readonly unknown[] = []) {
      return db.prepare(sql).all(...(params as unknown[])) as T[];
    },
  };
}

describe('seed + reset on real SQLite', () => {
  async function freshDb(): Promise<{ driver: SqlDriver; deps: SeedDeps }> {
    const driver = realDriver();
    await migrate(driver);
    const clock = new SystemClock();
    const uow = new SqliteUnitOfWork(driver, new CryptoIdGenerator(), clock);
    return { driver, deps: { uow, clock, ids: new CryptoIdGenerator() } };
  }

  it('creates the settings table via migration v4', async () => {
    const { driver } = await freshDb();
    const rows = await driver.query<{ name: unknown }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'",
    );
    expect(rows).toHaveLength(1);
  });

  it('persists the dismissed flag across a new unit of work (restart)', async () => {
    const { driver, deps } = await freshDb();
    await seedDemoData(deps);
    await resetAllData(deps);

    // A second process over the same file: same driver, fresh repositories.
    const rebooted = new SqliteUnitOfWork(driver, new CryptoIdGenerator(), deps.clock);
    await seedDemoData({ ...deps, uow: rebooted });
    expect(await rebooted.lists.list()).toHaveLength(0);
  });

  it('leaves a bootable empty database: no orphan tasks, no FK violations', async () => {
    const { driver, deps } = await freshDb();
    await seedDemoData(deps);
    await resetAllData(deps);

    const uow = deps.uow as SqliteUnitOfWork;
    expect(await uow.lists.list()).toHaveLength(0);
    expect(await uow.tasks.list()).toHaveLength(0);
    expect(await uow.events.list()).toHaveLength(0);
    expect(await uow.settings.get(ONBOARDING_DISMISSED_KEY)).not.toBeNull();

    // PRAGMA foreign_key_check returns one row per violation; an empty result
    // is the "the app can boot from this" assertion for the relational side.
    const violations = await driver.query<Record<string, unknown>>('PRAGMA foreign_key_check');
    expect(violations).toHaveLength(0);

    // And seeding again is a no-op, so the first screen is genuinely empty.
    await seedDemoData({ ...deps, uow });
    expect(await uow.lists.list()).toHaveLength(0);
  });
});
