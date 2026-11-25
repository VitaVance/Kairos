import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { duePrecisionOf, isSystemInbox, quadrantOf } from '@todolist/core';
import type { Task, TaskList } from '@todolist/core';
import {
  CryptoIdGenerator,
  DEMO_EVENT_KEYS,
  DEMO_TASK_KEYS,
  MemoryUnitOfWork,
  ONBOARDING_DISMISSED_KEY,
  SEED_CORPORA,
  SystemClock,
  resetAllData,
  seedDemoData,
  seedLanguage,
} from '../src/index.js';
import type { SeedDeps } from '../src/index.js';
import { migrate } from '../src/sqlite/schema.js';
import { SqliteUnitOfWork } from '../src/sqlite/SqliteUnitOfWork.js';
import type { SqlDriver } from '../src/sql-driver.js';

function memoryDeps(language: string | null = 'en'): SeedDeps {
  return {
    uow: new MemoryUnitOfWork(),
    clock: new SystemClock(),
    ids: new CryptoIdGenerator(),
    language,
  };
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

describe('seedLanguage', () => {
  it('maps Chinese tags onto the zh-CN corpus and everything else to English', () => {
    expect(seedLanguage('zh-CN')).toBe('zh-CN');
    expect(seedLanguage('zh')).toBe('zh-CN');
    expect(seedLanguage('zh-TW')).toBe('zh-CN');
    expect(seedLanguage('en')).toBe('en');
    expect(seedLanguage('en-GB')).toBe('en');
  });

  it('falls back to English for unknown, empty or missing locales', () => {
    expect(seedLanguage('fr-FR')).toBe('en');
    expect(seedLanguage('')).toBe('en');
    expect(seedLanguage(null)).toBe('en');
    expect(seedLanguage(undefined)).toBe('en');
  });
});

describe('seedDemoData — language selection', () => {
  it('seeds English content for "en"', async () => {
    const deps = memoryDeps('en');
    await seedDemoData(deps);
    const { lists, tasks, events } = await snapshot(deps.uow);

    expect(lists.map((l) => l.name)).toEqual(['Inbox', 'Work', 'Study', 'Personal']);
    expect(tasks.map((t) => t.title)).toContain('Unscheduled: quick note');
    expect(tasks.map((t) => t.title)).toContain('15:30 pick up the kids');
    expect(events.map((e) => e.title)).toContain('Product review');
    // No row may leak the other language's wording.
    expect(tasks.map((t) => t.title).join(' ')).not.toMatch(/[一-鿿]/);
    expect(events.map((e) => e.title).join(' ')).not.toMatch(/[一-鿿]/);
  });

  it('seeds Chinese content for "zh-CN"', async () => {
    const deps = memoryDeps('zh-CN');
    await seedDemoData(deps);
    const { lists, tasks, events } = await snapshot(deps.uow);

    expect(lists.map((l) => l.name)).toEqual(['收集箱', '工作', '学习', '生活']);
    expect(tasks.map((t) => t.title)).toContain('未排期：随手记');
    expect(tasks.map((t) => t.title)).toContain('15:30 接孩子');
    expect(events.map((e) => e.title)).toContain('产品评审会');
    expect(tasks.map((t) => t.title).join(' ')).toMatch(/[一-鿿]/);
  });

  it('falls back to English for an unknown locale', async () => {
    const deps = memoryDeps('de-DE');
    await seedDemoData(deps);
    const { lists, tasks } = await snapshot(deps.uow);

    expect(lists.map((l) => l.name)).toEqual(['Inbox', 'Work', 'Study', 'Personal']);
    expect(tasks.map((t) => t.title)).toContain('Unscheduled: quick note');
  });

  it('defaults to English when no language is passed at all', async () => {
    const uow = new MemoryUnitOfWork();
    await seedDemoData({ uow, clock: new SystemClock(), ids: new CryptoIdGenerator() });
    expect((await uow.lists.list()).map((l) => l.name)[0]).toBe('Inbox');
  });
});

describe('seed corpora — both languages teach the same lessons', () => {
  const languages = ['en', 'zh-CN'] as const;

  it('every corpus has text for every task and event key', () => {
    for (const language of languages) {
      const corpus = SEED_CORPORA[language];
      expect(Object.keys(corpus.tasks).sort()).toEqual([...DEMO_TASK_KEYS].sort());
      expect(Object.keys(corpus.events).sort()).toEqual([...DEMO_EVENT_KEYS].sort());
      for (const key of DEMO_TASK_KEYS) {
        expect(corpus.tasks[key].title.length, `${language}:${key}`).toBeGreaterThan(0);
        expect(corpus.tasks[key].notes.length, `${language}:${key}`).toBeGreaterThan(0);
      }
      for (const key of DEMO_EVENT_KEYS) {
        expect(corpus.events[key].title.length, `${language}:${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the two corpora structurally parallel (same keys, different words)', () => {
    expect(Object.keys(SEED_CORPORA.en.tasks).sort()).toEqual(
      Object.keys(SEED_CORPORA['zh-CN'].tasks).sort(),
    );
    expect(SEED_CORPORA.en.tasks.unscheduled.title).not.toBe(
      SEED_CORPORA['zh-CN'].tasks.unscheduled.title,
    );
  });

  for (const language of languages) {
    describe(language, () => {
      it('covers all four quadrants', async () => {
        const deps = memoryDeps(language);
        await seedDemoData(deps);
        const { tasks } = await snapshot(deps.uow);
        const quadrants = new Set(tasks.map((t) => quadrantOf(t)));
        expect([...quadrants].sort()).toEqual(
          ['not-urgent-important', 'unimportant', 'urgent-important', 'urgent-not-important'].sort(),
        );
      });

      it('covers all four scheduling precisions, labelled in the titles', async () => {
        const deps = memoryDeps(language);
        await seedDemoData(deps);
        const { tasks } = await snapshot(deps.uow);

        const byPrecision = new Map<string, Task[]>();
        for (const task of tasks) {
          const key = duePrecisionOf(task);
          byPrecision.set(key, [...(byPrecision.get(key) ?? []), task]);
        }
        for (const precision of ['none', 'day', 'period', 'time'] as const) {
          expect(
            byPrecision.get(precision)?.length ?? 0,
            `no task with precision "${precision}"`,
          ).toBeGreaterThan(0);
        }

        const titles = tasks.map((t) => t.title);
        expect(titles).toContain(SEED_CORPORA[language].tasks.unscheduled.title);
        expect(titles).toContain(SEED_CORPORA[language].tasks.allDay.title);
        expect(titles).toContain(SEED_CORPORA[language].tasks.afternoon.title);
        expect(titles.some((t) => /^\d{1,2}:\d{2}\s/.test(t))).toBe(true);

        const period = byPrecision.get('period')![0]!;
        expect(period.duePeriod).toBe('afternoon');
        expect(period.allDay).toBe(true);
      });

      it('has exactly one recurring task, one completed task and both affordance notes', async () => {
        const deps = memoryDeps(language);
        await seedDemoData(deps);
        const { tasks } = await snapshot(deps.uow);

        const recurring = tasks.filter((t) => t.recurrence !== null);
        expect(recurring).toHaveLength(1);
        expect(recurring[0]!.recurrence?.frequency).toBe('weekly');
        expect(recurring[0]!.dueDate! >= todayLocal()).toBe(true);

        expect(tasks.filter((t) => t.status === 'done')).toHaveLength(1);

        const notes = tasks.map((t) => t.notes).join('\n');
        expect(notes).toContain('Ctrl+K');
        expect(notes).toMatch(language === 'en' ? /quadrant/i : /象限/);
      });

      it('stays inside the agreed budget and places events relative to today', async () => {
        const deps = memoryDeps(language);
        await seedDemoData(deps);
        const { tasks, events } = await snapshot(deps.uow);

        expect(tasks.length).toBeGreaterThanOrEqual(15);
        expect(tasks.length).toBeLessThanOrEqual(18);
        expect(events.length).toBeGreaterThanOrEqual(10);
        expect(events.length).toBeLessThanOrEqual(12);

        const today = todayLocal();
        expect(events.some((e) => localDay(e.startAt) === today)).toBe(true);

        const slots = events.map((e) => `${localDay(e.startAt)} ${new Date(e.startAt).getHours()}`);
        expect(new Set(slots).size).toBe(slots.length);
      });
    });
  }
});

describe('seedDemoData — inbox identity', () => {
  for (const language of ['en', 'zh-CN'] as const) {
    it(`marks the inbox with the system key (${language})`, async () => {
      const deps = memoryDeps(language);
      await seedDemoData(deps);
      const { lists } = await snapshot(deps.uow);

      const inbox = lists.find((l) => isSystemInbox(l));
      expect(inbox).toBeDefined();
      // The stored name is a fallback only; the flag is the identity.
      expect(inbox!.name).toBe(SEED_CORPORA[language].lists.inbox);
      // Exactly one list is system-owned; the other three stay user content.
      expect(lists.filter((l) => isSystemInbox(l))).toHaveLength(1);
      expect(lists.filter((l) => !isSystemInbox(l))).toHaveLength(3);
    });
  }
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

    // Exactly what App.tsx's boot() does on the next launch — even if the
    // language has changed in between, the reset must still win.
    await seedDemoData({ ...deps, language: 'zh-CN' });

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
    return { driver, deps: { uow, clock, ids: new CryptoIdGenerator(), language: 'en' } };
  }

  it('persists the inbox system_key through create and read', async () => {
    const { deps } = await freshDb();
    await seedDemoData(deps);
    const lists = await deps.uow.lists.list();
    const inbox = lists.find((l) => isSystemInbox(l));
    expect(inbox).toBeDefined();
    expect(inbox!.systemKey).toBe('inbox');
    // Read back through the mapper (not the in-memory object).
    expect((await deps.uow.lists.get(inbox!.id))?.systemKey).toBe('inbox');
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

    const violations = await driver.query<Record<string, unknown>>('PRAGMA foreign_key_check');
    expect(violations).toHaveLength(0);

    await seedDemoData({ ...deps, uow });
    expect(await uow.lists.list()).toHaveLength(0);
  });

  it('upgrades a pre-v5 install without inventing an inbox identity', async () => {
    // A database that shipped before system_key existed: real lists, no column.
    const driver = realDriver();
    await driver.execute('PRAGMA foreign_keys = ON');
    await driver.execute(
      `CREATE TABLE schema_version (version INTEGER PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)`,
    );
    await driver.execute(
      `CREATE TABLE lists (
        id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL,
        "order" INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )`,
    );
    await driver.execute(
      `CREATE TABLE tasks (
        id TEXT PRIMARY KEY NOT NULL, list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
        title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
        important INTEGER NOT NULL DEFAULT 0, urgent INTEGER NOT NULL DEFAULT 0,
        due_at TEXT, due_date TEXT, all_day INTEGER NOT NULL DEFAULT 0, completed_at TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, recurrence TEXT,
        due_period TEXT CHECK (due_period IS NULL OR due_period IN ('morning','afternoon','evening'))
      )`,
    );
    await driver.execute(
      `CREATE TABLE events (
        id TEXT PRIMARY KEY NOT NULL, list_id TEXT REFERENCES lists(id) ON DELETE SET NULL,
        title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', start_at TEXT NOT NULL,
        end_at TEXT NOT NULL, all_day INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )`,
    );
    await driver.execute(
      `CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    );
    for (const version of [1, 2, 3, 4]) {
      await driver.execute(
        `INSERT INTO schema_version (version, applied_at) VALUES (?, '2026-01-01')`,
        [version],
      );
    }
    const now = '2026-09-01T00:00:00.000Z';
    await driver.execute(
      `INSERT INTO lists (id, name, color, "order", archived, created_at, updated_at)
       VALUES ('legacy-inbox', '收集箱', '#dd7366', 0, 0, ?, ?)`,
      [now, now],
    );

    await migrate(driver);
    const uow = new SqliteUnitOfWork(driver, new CryptoIdGenerator());

    const legacy = (await uow.lists.get('legacy-inbox' as never)) as TaskList;
    // Position is not identity: an old row stays unflagged and keeps its frozen
    // name, which is exactly what it rendered before this change.
    expect(legacy.systemKey).toBeNull();
    expect(isSystemInbox(legacy)).toBe(false);
    expect(legacy.name).toBe('收集箱');
  });
});
