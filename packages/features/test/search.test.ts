import { describe, expect, it } from 'vitest';
import type { Instant, ListId, LocalDate, Task, TaskId } from '@todolist/core';
import {
  applyFilters,
  highlightRanges,
  matchesQuery,
  sortByRelevance,
} from '../src/search/search.js';

const LIST_A = 'list-a' as ListId;
const LIST_B = 'list-b' as ListId;

let seq = 0;

function task(overrides: Partial<Task> & Pick<Task, 'title'>): Task {
  seq += 1;
  const base: Task = {
    id: `task-${seq}` as TaskId,
    listId: LIST_A,
    title: overrides.title,
    notes: '',
    status: 'open',
    important: false,
    urgent: false,
    dueAt: null,
    dueDate: null,
    allDay: false,
    duePeriod: null,
    recurrence: null,
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z' as Instant,
    updatedAt: '2026-01-01T00:00:00.000Z' as Instant,
  };
  return { ...base, ...overrides };
}

describe('matchesQuery', () => {
  it('matches on the title', () => {
    expect(matchesQuery({ title: '写周报' }, '周报')).toBe(true);
  });

  it('matches on notes when the title does not', () => {
    expect(matchesQuery({ title: '周会', notes: '准备季度预算表' }, '预算')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchesQuery({ title: 'Review PR' }, 'pr')).toBe(true);
    expect(matchesQuery({ title: 'review pr' }, 'PR')).toBe(true);
  });

  it('trims surrounding whitespace from the query', () => {
    expect(matchesQuery({ title: '写周报' }, '  周报  ')).toBe(true);
  });

  it('treats an empty or whitespace-only query as matching everything', () => {
    expect(matchesQuery({ title: '任意' }, '')).toBe(true);
    expect(matchesQuery({ title: '任意', notes: '备注' }, '   ')).toBe(true);
  });

  it('returns false when neither title nor notes contain the query', () => {
    expect(matchesQuery({ title: '写周报', notes: '周一提交' }, '旅行')).toBe(false);
  });

  it('matches CJK substrings without word boundaries', () => {
    expect(matchesQuery({ title: '撰写周报（Q4）' }, '周报')).toBe(true);
    expect(matchesQuery({ title: '整理音乐播放列表' }, '播列')).toBe(false);
    expect(matchesQuery({ title: '整理音乐播放列表' }, '播放列')).toBe(true);
  });

  it('matches across a stray internal space in a CJK query', () => {
    expect(matchesQuery({ title: '写周报' }, '写 周报')).toBe(true);
    expect(matchesQuery({ title: 'Review PR' }, 'review   pr')).toBe(true);
  });

  it('matches a task whose list name contains the query', () => {
    expect(matchesQuery({ title: '无关标题', notes: '' }, '工作', '工作')).toBe(true);
    expect(matchesQuery({ title: '无关标题', notes: '' }, '工作', '生活')).toBe(false);
    expect(matchesQuery({ title: '无关标题' }, '工作')).toBe(false);
  });
});

describe('highlightRanges', () => {
  it('finds a single occurrence with correct indices', () => {
    expect(highlightRanges('写周报', '周报')).toEqual([{ start: 1, end: 3 }]);
  });

  it('finds multiple non-overlapping occurrences', () => {
    expect(highlightRanges('abcabc', 'abc')).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 6 },
    ]);
  });

  it('is case-insensitive while preserving original indices', () => {
    expect(highlightRanges('Review and REVIEW', 'review')).toEqual([
      { start: 0, end: 6 },
      { start: 11, end: 17 },
    ]);
  });

  it('returns an empty array when there is no match', () => {
    expect(highlightRanges('写周报', '旅行')).toEqual([]);
  });

  it('returns an empty array for an empty query', () => {
    expect(highlightRanges('写周报', '  ')).toEqual([]);
  });
});

describe('applyFilters', () => {
  const tasks = [
    task({ title: '写周报', listId: LIST_A, status: 'open' }),
    task({ title: '写周报终稿', listId: LIST_B, status: 'done' }),
    task({ title: '订机票', listId: LIST_B, status: 'open' }),
    task({ title: '周报模板', listId: LIST_A, status: 'done' }),
  ];

  function titles(filter: Parameters<typeof applyFilters>[1]): string[] {
    return applyFilters(tasks, filter).map((t) => t.title);
  }

  it('filters by open status', () => {
    expect(titles({ query: '', status: 'open', listId: null })).toEqual(['写周报', '订机票']);
  });

  it('filters by done status', () => {
    expect(titles({ query: '', status: 'done', listId: null })).toEqual(['写周报终稿', '周报模板']);
  });

  it('filters by list id', () => {
    expect(titles({ query: '', status: 'all', listId: LIST_A })).toEqual(['写周报', '周报模板']);
  });

  it('combines status and list id', () => {
    expect(titles({ query: '', status: 'done', listId: LIST_B })).toEqual(['写周报终稿']);
  });

  it('combines the text query with status and list', () => {
    expect(titles({ query: '周报', status: 'open', listId: LIST_A })).toEqual(['写周报']);
  });

  it('returns everything for the unfiltered filter', () => {
    expect(titles({ query: '', status: 'all', listId: null })).toHaveLength(tasks.length);
  });
});

describe('sortByRelevance', () => {
  it('ranks a title match above a notes-only match', () => {
    const notesOnly = task({ title: '准备材料', notes: '整理周报数据' });
    const titleHit = task({ title: '写周报' });
    const out = sortByRelevance([notesOnly, titleHit], '周报');
    expect(out.map((t) => t.title)).toEqual(['写周报', '准备材料']);
  });

  it('ranks more title occurrences higher', () => {
    const once = task({ title: '周报' });
    const twice = task({ title: '周报与周报摘要' });
    const out = sortByRelevance([once, twice], '周报');
    expect(out[0]?.title).toBe('周报与周报摘要');
  });

  it('leaves the input order untouched for an empty query', () => {
    const first = task({ title: 'A' });
    const second = task({ title: 'B' });
    expect(sortByRelevance([first, second], '  ').map((t) => t.title)).toEqual(['A', 'B']);
  });

  it('does not mutate the input array', () => {
    const input = [task({ title: 'B' }), task({ title: 'A' })];
    const snapshot = [...input];
    sortByRelevance(input, 'a');
    expect(input).toEqual(snapshot);
  });
});

describe('due dates stay optional in fixtures', () => {
  it('keeps LocalDate typing honest', () => {
    const t = task({ title: 'x', dueDate: '2026-11-24' as LocalDate });
    expect(t.dueDate).toBe('2026-11-24');
  });
});
