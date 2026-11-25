import { describe, expect, it } from 'vitest';
import {
  CryptoIdGenerator,
  MemoryUnitOfWork,
  SystemClock,
  seedDemoData,
} from '../src/index.js';

describe('SystemClock', () => {
  it('returns a parseable ISO instant', () => {
    const instant = new SystemClock().now();
    expect(typeof instant).toBe('string');
    expect(Number.isNaN(Date.parse(instant))).toBe(false);
    // ISO-8601 UTC with milliseconds, as the domain's Instant expects.
    expect(instant).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(instant).toISOString()).toBe(instant);
  });

  it('moves forward', async () => {
    const clock = new SystemClock();
    const first = Date.parse(clock.now());
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = Date.parse(clock.now());
    expect(second).toBeGreaterThanOrEqual(first);
  });
});

describe('CryptoIdGenerator', () => {
  it('returns unique branded ids for each entity kind', () => {
    const ids = new CryptoIdGenerator();
    const seen = new Set<string>();

    for (let i = 0; i < 500; i++) {
      for (const id of [ids.task(), ids.list(), ids.event()]) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
    expect(seen.size).toBe(1500);
  });

  it('prefixes ids by entity kind', () => {
    const ids = new CryptoIdGenerator();
    expect(ids.task()).toMatch(/^task_/);
    expect(ids.list()).toMatch(/^list_/);
    expect(ids.event()).toMatch(/^event_/);
  });
});

describe('seedDemoData', () => {
  // Content coverage (four precisions, four quadrants, recurrence, reset)
  // lives in seed-demo.test.ts. This file keeps the smoke checks only.
  it('seeds the four lists and puts an event on today', async () => {
    const uow = new MemoryUnitOfWork();
    await seedDemoData({ uow, clock: new SystemClock(), ids: new CryptoIdGenerator(), language: 'zh-CN' });

    const lists = await uow.lists.list();
    expect(lists.map((l) => l.name)).toEqual(['收集箱', '工作', '学习', '生活']);
    expect(lists.map((l) => l.color)).toEqual(['#dd7366', '#5b8def', '#8b79c9', '#d99a3d']);

    const localDate = (instant: string): string => {
      const d = new Date(instant);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const today = localDate(new Date().toISOString());
    const events = await uow.events.list();
    expect(events.some((e) => localDate(e.startAt) === today)).toBe(true);
  });

  it('is idempotent (StrictMode double-invoke does not duplicate)', async () => {
    const uow = new MemoryUnitOfWork();
    const deps = { uow, clock: new SystemClock(), ids: new CryptoIdGenerator() };

    await seedDemoData(deps);
    const listCount = (await uow.lists.list()).length;
    const taskCount = (await uow.tasks.list()).length;
    const eventCount = (await uow.events.list()).length;

    await seedDemoData(deps);
    expect((await uow.lists.list()).length).toBe(listCount);
    expect((await uow.tasks.list()).length).toBe(taskCount);
    expect((await uow.events.list()).length).toBe(eventCount);
  });
});
