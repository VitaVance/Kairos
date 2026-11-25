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
  it('seeds four lists and a dozen entries', async () => {
    const uow = new MemoryUnitOfWork();
    const clock = new SystemClock();
    const ids = new CryptoIdGenerator();

    await seedDemoData({ uow, clock, ids });

    const lists = await uow.lists.list();
    expect(lists.map((l) => l.name)).toEqual(['收集箱', '工作', '学习', '生活']);
    expect(lists.map((l) => l.color)).toEqual(['#dd7366', '#5b8def', '#8b79c9', '#d99a3d']);

    const tasks = await uow.tasks.list();
    const events = await uow.events.list();
    expect(tasks.length + events.length).toBeGreaterThanOrEqual(12);

    const titles = new Set([...tasks, ...events].map((e) => e.title));
    for (const expected of [
      '晨跑',
      '制定营销策略',
      '产品评审',
      '拿快递',
      '部门培训',
      '线上会议',
      '瑜伽课',
      '阅读名人传记',
      '和妈妈逛街',
      '整理音乐播放列表',
    ]) {
      expect(titles.has(expected)).toBe(true);
    }

    // Demo dates are laid out relative to *today*, in the host's local zone
    // (which is how seedDemoData places wall-clock times). Assert the shape and
    // the offsets rather than a hardcoded calendar day.
    const localDate = (instant: string): string => {
      const d = new Date(instant);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    const today = localDate(new Date().toISOString());
    const marketing = events.find((e) => e.title === '制定营销策略')!;
    expect(localDate(marketing.startAt)).toBe(today);
    expect(new Date(marketing.startAt).getHours()).toBe(9);

    // 和妈妈逛街 is seeded one day before today.
    const shopping = events.find((e) => e.title === '和妈妈逛街')!;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(localDate(shopping.startAt)).toBe(localDate(yesterday.toISOString()));
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

  it('also seeds a completed task so the "done" UI has content', async () => {
    const uow = new MemoryUnitOfWork();
    await seedDemoData({ uow, clock: new SystemClock(), ids: new CryptoIdGenerator() });
    const done = await uow.tasks.list({ status: 'done' });
    expect(done.length).toBeGreaterThan(0);
    expect(done[0]!.completedAt).not.toBeNull();
  });
});
