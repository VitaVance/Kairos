import { describe, expect, it } from 'vitest';
import type {
  CalendarEvent,
  EventId,
  Instant,
  ListId,
  LocalDate,
  Task,
  TaskId,
  TaskList,
} from '@todolist/core';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  CSV_COLUMNS,
  exportTasksToCsv,
  exportToJson,
  parseImport,
  planMerge,
  serializeBackup,
} from '../src/data/export-import.js';
import type { BackupData } from '../src/data/export-import.js';
import {
  ReminderState,
  computeUpcoming,
  shouldFire,
} from '../src/reminders/ReminderScheduler.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const T = (iso: string) => iso as Instant;
const D = (date: string) => date as LocalDate;

const LIST_ID = 'list-1' as ListId;

const list: TaskList = {
  id: LIST_ID,
  name: '工作',
  color: '#5b8def',
  order: 0,
  archived: false,
  createdAt: T('2026-09-01T00:00:00.000Z'),
  updatedAt: T('2026-09-01T00:00:00.000Z'),
};

const task: Task = {
  id: 'task-1' as TaskId,
  listId: LIST_ID,
  title: '写周报',
  notes: '包含数据, 图表',
  status: 'open',
  important: true,
  urgent: false,
  dueAt: T('2026-09-06T08:00:00.000Z'),
  dueDate: D('2026-09-06'),
  allDay: false,
  duePeriod: null,
  recurrence: null,
  completedAt: null,
  createdAt: T('2026-09-01T00:00:00.000Z'),
  updatedAt: T('2026-09-02T00:00:00.000Z'),
};

const event: CalendarEvent = {
  id: 'event-1' as EventId,
  listId: null,
  title: '产品评审',
  notes: '',
  startAt: T('2026-09-06T09:00:00.000Z'),
  endAt: T('2026-09-06T10:00:00.000Z'),
  allDay: false,
  createdAt: T('2026-09-01T00:00:00.000Z'),
  updatedAt: T('2026-09-01T00:00:00.000Z'),
};

const data: BackupData = { tasks: [task], lists: [list], events: [event] };

// ---------------------------------------------------------------------------
// JSON export / parse round trip
// ---------------------------------------------------------------------------

describe('exportToJson / parseImport round trip', () => {
  it('produces a versioned envelope with fixed key order', () => {
    const file = exportToJson(data, { exportedAt: T('2026-09-06T12:00:00.000Z') });
    expect(file.format).toBe(BACKUP_FORMAT);
    expect(file.version).toBe(BACKUP_VERSION);
    expect(file.exportedAt).toBe('2026-09-06T12:00:00.000Z');
    expect(Object.keys(file)).toEqual(['format', 'version', 'exportedAt', 'data']);
    expect(Object.keys(file.data)).toEqual(['tasks', 'lists', 'events']);
    expect(Object.keys(file.data.tasks[0]!).slice(0, 4)).toEqual(['id', 'listId', 'title', 'notes']);
  });

  it('is deterministic for identical data', () => {
    const a = serializeBackup(exportToJson(data, { exportedAt: T('2026-09-06T12:00:00.000Z') }));
    const b = serializeBackup(exportToJson(data, { exportedAt: T('2026-09-06T12:00:00.000Z') }));
    expect(a).toBe(b);
    expect(a.endsWith('\n')).toBe(true);
  });

  it('round-trips export → parse with no data loss', () => {
    const json = serializeBackup(exportToJson(data, { exportedAt: T('2026-09-06T12:00:00.000Z') }));
    const result = parseImport(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.tasks).toEqual([task]);
    expect(result.data.lists).toEqual([list]);
    expect(result.data.events).toEqual([event]);
  });

  it('keeps an all-day task and a null dueAt task', () => {
    const allDay: Task = { ...task, id: 'task-2' as TaskId, allDay: true };
    const inbox: Task = { ...task, id: 'task-3' as TaskId, dueAt: null, dueDate: null };
    const json = serializeBackup(
      exportToJson({ tasks: [allDay, inbox], lists: [list], events: [] }, { exportedAt: T('2026-09-06T12:00:00.000Z') }),
    );
    const result = parseImport(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.tasks[1]?.dueAt).toBeNull();
    expect(result.data.tasks[1]?.dueDate).toBeNull();
    expect(result.data.tasks[0]?.allDay).toBe(true);
  });

  it('round-trips a recurrence rule', () => {
    const recurring: Task = {
      ...task,
      id: 'task-recurring' as TaskId,
      recurrence: { frequency: 'weekly', interval: 2, weekdays: [0, 2], until: D('2026-12-31') },
    };
    const json = serializeBackup(
      exportToJson({ tasks: [recurring], lists: [list], events: [] }, { exportedAt: T('2026-09-06T12:00:00.000Z') }),
    );
    const result = parseImport(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.tasks[0]?.recurrence).toEqual(recurring.recurrence);
  });

  it('treats a missing recurrence (v1 backup) as "does not repeat"', () => {
    const { recurrence: _omit, ...legacyTask } = task;
    const json = JSON.stringify({
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: '2026-09-06T12:00:00.000Z',
      data: { tasks: [legacyTask], lists: [list], events: [] },
    });
    const result = parseImport(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.tasks[0]?.recurrence).toBeNull();
  });

  it('rejects a structurally invalid recurrence with a field path', () => {
    const json = JSON.stringify({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: '2026-09-06T12:00:00.000Z',
      data: {
        tasks: [{ ...task, recurrence: { frequency: 'weekly', interval: 1, weekdays: [] } }],
        lists: [],
        events: [],
      },
    });
    const result = parseImport(json);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes('tasks[0].recurrence'))).toBe(true);
  });

  it('round-trips a half-day bucket (v3)', () => {
    expect(BACKUP_VERSION).toBe(3);
    const morning: Task = {
      ...task,
      id: 'task-morning' as TaskId,
      allDay: true,
      dueAt: T('2026-09-05T16:00:00.000Z'),
      duePeriod: 'morning',
    };
    const json = serializeBackup(
      exportToJson({ tasks: [morning], lists: [list], events: [] }, { exportedAt: T('2026-09-06T12:00:00.000Z') }),
    );
    const result = parseImport(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.tasks[0]?.duePeriod).toBe('morning');
  });

  it('reads a missing duePeriod (v1/v2 backup) as null', () => {
    const { duePeriod: _omit, ...legacyTask } = task;
    const json = JSON.stringify({
      format: BACKUP_FORMAT,
      version: 2,
      exportedAt: '2026-09-06T12:00:00.000Z',
      data: { tasks: [legacyTask], lists: [list], events: [] },
    });
    const result = parseImport(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.tasks[0]?.duePeriod).toBeNull();
  });

  it('rejects an unknown duePeriod with a field path', () => {
    const json = JSON.stringify({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: '2026-09-06T12:00:00.000Z',
      data: { tasks: [{ ...task, duePeriod: 'night' }], lists: [], events: [] },
    });
    const result = parseImport(json);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes('tasks[0].duePeriod'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

describe('exportTasksToCsv', () => {
  it('writes the documented header', () => {
    const csv = exportTasksToCsv([], []);
    expect(csv.split('\r\n')[0]).toBe(CSV_COLUMNS.join(','));
    expect(csv).toBe(`${CSV_COLUMNS.join(',')}\r\n`);
  });

  it('quotes values containing commas and doubles quotes', () => {
    const tricky: Task = {
      ...task,
      title: '买菜, 顺便买 "牛奶"',
      notes: '第一行\n第二行',
    };
    const csv = exportTasksToCsv([tricky], [list]);
    const row = csv.split('\r\n')[1]!;
    expect(row).toContain('"买菜, 顺便买 ""牛奶"""');
    expect(row).toContain('"第一行\n第二行"');
    // Newlines inside quoted cells keep the record on one logical row.
    expect(row).toContain('工作');
  });

  it('does not quote plain cells and resolves the list name', () => {
    const csv = exportTasksToCsv([task], [list]);
    const row = csv.split('\r\n')[1]!;
    expect(row.startsWith('写周报,工作,未完成,是,否,2026-09-06,')).toBe(true);
  });

  it('falls back to an empty list name and empty due fields', () => {
    const orphan: Task = { ...task, listId: 'missing' as ListId, dueAt: null, dueDate: null, notes: '' };
    const row = exportTasksToCsv([orphan], [list]).split('\r\n')[1]!;
    expect(row).toBe('写周报,,未完成,是,否,,,');
  });
});

// ---------------------------------------------------------------------------
// parseImport validation
// ---------------------------------------------------------------------------

describe('parseImport validation', () => {
  it('rejects malformed JSON without throwing', () => {
    expect(() => parseImport('{ not json')).not.toThrow();
    const result = parseImport('{ not json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('JSON 解析失败');
  });

  it('rejects a wrong format with a clear message', () => {
    const json = JSON.stringify({
      format: 'something-else',
      version: 1,
      exportedAt: '2026-09-06T12:00:00.000Z',
      data: { tasks: [], lists: [], events: [] },
    });
    const result = parseImport(json);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes('format'))).toBe(true);
  });

  it('rejects an unknown future version with an upgrade hint', () => {
    const json = JSON.stringify({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION + 1,
      exportedAt: '2026-09-06T12:00:00.000Z',
      data: { tasks: [], lists: [], events: [] },
    });
    const result = parseImport(json);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes('不支持的备份版本'))).toBe(true);
  });

  it('collects every record error rather than stopping at the first', () => {
    const json = JSON.stringify({
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: '2026-09-06T12:00:00.000Z',
      data: {
        tasks: [
          { ...task, title: 42 }, // wrong type
          { ...task, id: 'task-2', status: 'archived' }, // bad status
        ],
        lists: [{ ...list, order: 'first' }], // wrong type
        events: [{ ...event, endAt: 'not-a-date' }], // bad instant
      },
    });
    const result = parseImport(json);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const joined = result.errors.join('\n');
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
    expect(joined).toMatch(/tasks\[0\]\.title/);
    expect(joined).toMatch(/tasks\[1\]\.status/);
    expect(joined).toMatch(/lists\[0\]\.order/);
    expect(joined).toMatch(/events\[0\]\.endAt/);
  });

  it('reports a missing data object', () => {
    const result = parseImport(
      JSON.stringify({ format: BACKUP_FORMAT, version: 1, exportedAt: '2026-09-06T12:00:00.000Z' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes('data'))).toBe(true);
  });

  it('accepts an empty but valid backup', () => {
    const result = parseImport(
      JSON.stringify({
        format: BACKUP_FORMAT,
        version: 1,
        exportedAt: '2026-09-06T12:00:00.000Z',
        data: { tasks: [], lists: [], events: [] },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('rejects an invalid calendar date', () => {
    const json = JSON.stringify({
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: '2026-09-06T12:00:00.000Z',
      data: { tasks: [{ ...task, dueDate: '2026-02-31' }], lists: [], events: [] },
    });
    const result = parseImport(json);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.includes('dueDate'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// planMerge
// ---------------------------------------------------------------------------

describe('planMerge', () => {
  const newer: Task = { ...task, id: 'task-1' as TaskId, updatedAt: T('2026-09-05T00:00:00.000Z') };
  const same: Task = { ...task, id: 'task-2' as TaskId, createdAt: T('2026-08-01T00:00:00.000Z') , updatedAt: T('2026-08-01T00:00:00.000Z') };
  const existing: BackupData = { tasks: [task, same], lists: [list], events: [event] };

  it('replace counts every incoming row as add and absent rows as remove', () => {
    const incoming: BackupData = { tasks: [newer], lists: [], events: [] };
    const plan = planMerge(existing, incoming, 'replace');
    // 1 task + 0 lists + 0 events added
    expect(plan.counts.added).toBe(1);
    expect(plan.counts.updated).toBe(0);
    expect(plan.counts.skipped).toBe(0);
    // existing task-2, list, event are not in the payload → removed
    expect(plan.counts.removed).toBe(3);
    expect(plan.tasks.byId['task-1']).toBe('add');
    expect(plan.tasks.byId['task-2']).toBe('remove');
  });

  it('merge adds new ids, updates newer collisions, skips older ones', () => {
    const updatedTask: Task = { ...task, updatedAt: T('2026-09-30T00:00:00.000Z') };
    const incoming: BackupData = {
      tasks: [updatedTask, same, { ...task, id: 'task-3' as TaskId }],
      lists: [list],
      events: [],
    };
    const plan = planMerge(existing, incoming, 'merge');
    expect(plan.tasks.byId['task-1']).toBe('update');
    expect(plan.tasks.byId['task-2']).toBe('skip');
    expect(plan.tasks.byId['task-3']).toBe('add');
    // list collides with identical updatedAt → skip
    expect(plan.lists.byId[list.id]).toBe('skip');
    // merge never removes
    expect(plan.tasks.remove).toHaveLength(0);
    expect(plan.counts.removed).toBe(0);
    expect(plan.counts.added).toBe(1);
    expect(plan.counts.updated).toBe(1);
    expect(plan.counts.skipped).toBe(2); // task-2 + list
  });

  it('keys decisions by id and exposes the id lists', () => {
    const incoming: BackupData = {
      tasks: [{ ...task, id: 'task-9' as TaskId }],
      lists: [],
      events: [],
    };
    const plan = planMerge({ tasks: [], lists: [], events: [] }, incoming, 'merge');
    expect(Object.keys(plan.tasks.byId)).toEqual(['task-9']);
    expect(plan.tasks.add).toEqual(['task-9']);
  });
});

// ---------------------------------------------------------------------------
// computeUpcoming
// ---------------------------------------------------------------------------

describe('computeUpcoming', () => {
  const now = T('2026-09-06T08:00:00.000Z');
  const at = (minutes: number): Instant => T(new Date(Date.parse(now) + minutes * 60_000).toISOString());

  const dueTask = (id: string, dueAt: Instant, status: Task['status'] = 'open'): Task => ({
    ...task,
    id: id as TaskId,
    dueAt,
    dueDate: D('2026-09-06'),
    status,
  });

  it('includes an item exactly at now (inclusive lower edge)', () => {
    const items = computeUpcoming([dueTask('a', now)], [], now, 10);
    expect(items).toHaveLength(1);
    expect(items[0]?.minutesUntil).toBe(0);
  });

  it('includes an item exactly at the window edge (inclusive upper edge)', () => {
    const items = computeUpcoming([dueTask('a', at(10))], [], now, 10);
    expect(items).toHaveLength(1);
    expect(items[0]?.minutesUntil).toBe(10);
  });

  it('excludes items just past the window', () => {
    expect(computeUpcoming([dueTask('a', at(11))], [], now, 10)).toHaveLength(0);
  });

  it('excludes past items and completed tasks', () => {
    const items = computeUpcoming(
      [dueTask('past', at(-1)), dueTask('done', at(5), 'done'), dueTask('soon', at(5))],
      [],
      now,
      10,
    );
    expect(items.map((i) => i.id)).toEqual(['soon']);
  });

  it('mixes tasks and events, sorted by due time', () => {
    const e1: CalendarEvent = { ...event, id: 'ev-1' as EventId, startAt: at(5), endAt: at(65) };
    const items = computeUpcoming([dueTask('t-late', at(8))], [e1], now, 10);
    expect(items.map((i) => i.kind)).toEqual(['event', 'task']);
    expect(items.map((i) => i.minutesUntil)).toEqual([5, 8]);
  });

  it('returns an empty array for a negative or invalid window', () => {
    expect(computeUpcoming([dueTask('a', now)], [], now, -1)).toEqual([]);
    expect(computeUpcoming([dueTask('a', now)], [], 'nope' as Instant, 10)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ReminderState
// ---------------------------------------------------------------------------

describe('ReminderState', () => {
  const now = T('2026-09-06T08:00:00.000Z');
  const due: Task = { ...task, dueAt: T('2026-09-06T08:05:00.000Z') };

  it('fires a new item once and does not re-fire it', () => {
    const state = new ReminderState({ tasks: [due], events: [], windowMinutes: 10 });
    const first = state.tick(now);
    expect(first).toHaveLength(1);
    expect(first[0]?.kind).toBe('task');
    const second = state.tick(now);
    expect(second).toHaveLength(0);
  });

  it('shouldFire reads the ledger', () => {
    const state = new ReminderState({ tasks: [due], events: [], windowMinutes: 10 });
    const [item] = state.tick(now);
    expect(item).toBeDefined();
    if (!item) return;
    const empty = new Set<string>();
    expect(shouldFire(item, empty)).toBe(true);
    // hasFired/ledger reflect the tick immediately.
    expect(state.hasFired(item)).toBe(true);
    expect(shouldFire(item, new Set(state.firedIds))).toBe(false);
  });

  it('fires again for a rescheduled due time (new key)', () => {
    const state = new ReminderState({ tasks: [due], events: [], windowMinutes: 10 });
    expect(state.tick(now)).toHaveLength(1);
    state.setSources([{ ...due, dueAt: T('2026-09-06T08:06:00.000Z') }], []);
    expect(state.tick(now)).toHaveLength(1);
  });

  it('caps remembered ids at 200, evicting the oldest', () => {
    const state = new ReminderState({ tasks: [], events: [], windowMinutes: 0, capacity: 5 });
    for (let i = 0; i < 7; i++) {
      state.markFired({ kind: 'task', id: `t${i}`, dueAt: T('2026-09-06T08:00:00.000Z') });
    }
    expect(state.firedIds).toHaveLength(5);
    expect(state.firedIds[0]).toBe('task:t2:2026-09-06T08:00:00.000Z');
  });

  it('clear forgets everything', () => {
    const state = new ReminderState({ tasks: [due], events: [], windowMinutes: 10 });
    expect(state.tick(now)).toHaveLength(1);
    state.clear();
    expect(state.tick(now)).toHaveLength(1);
  });
});
