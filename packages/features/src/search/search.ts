import type { ListId, Task } from '@todolist/core';

/**
 * Pure search helpers. Everything here is synchronous and side-effect free so
 * it can be reasoned about (and tested) without React or storage.
 */

/** Minimal shape search needs — keeps the helpers usable beyond `Task`. */
export interface SearchableTask {
  readonly title: string;
  readonly notes?: string;
}

export interface SearchFilter {
  readonly query: string;
  readonly status: 'all' | 'open' | 'done';
  readonly listId: ListId | null;
  /**
   * Optional `listId → name` lookup. When provided, a query that matches a
   * list's name also matches the tasks in that list (the palette shows list
   * names as group headers, so typing one should find its contents).
   */
  readonly listNames?: ReadonlyMap<string, string> | null;
}

export interface HighlightRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Normalise a raw query: trim surrounding whitespace, collapse internal runs
 * of whitespace to one space, and lowercase. An empty / whitespace-only query
 * means "no query" (matches everything).
 */
function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Lowercase with every whitespace run removed. CJK text has no word
 * boundaries and users frequently type or paste a stray space into Chinese
 * queries ("写 周报"), so matching also tries the space-free form. This is a
 * fallback only: exact needle matches always rank first.
 */
function compactText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

/**
 * How strongly `text` matches the normalised `needle`: number of direct
 * occurrences, `1` for a whitespace-insensitive fallback hit, or `0`.
 */
function matchStrength(text: string, needle: string): number {
  if (needle.length === 0) return 0;
  const direct = occurrenceCount(text, needle);
  if (direct > 0) return direct;
  const compactNeedle = compactText(needle);
  if (compactNeedle.length === 0) return 0;
  return compactText(text).includes(compactNeedle) ? 1 : 0;
}

/** Case/whitespace-insensitive substring test. An empty query matches all. */
function matchesText(text: string, query: string): boolean {
  const needle = normalizeQuery(query);
  if (needle.length === 0) return true;
  return matchStrength(text, needle) > 0;
}

/**
 * Case-insensitive title/notes match. When `listName` is supplied, the list's
 * name is a third searchable field. An empty query matches every task.
 */
export function matchesQuery(
  task: SearchableTask,
  query: string,
  listName?: string | null,
): boolean {
  const needle = normalizeQuery(query);
  if (needle.length === 0) return true;
  if (matchesText(task.title, needle)) return true;
  if (matchesText(task.notes ?? '', needle)) return true;
  return listName !== undefined && listName !== null && matchesText(listName, needle);
}

/**
 * All non-overlapping, case-insensitive occurrences of `query` in `text`,
 * ascending. Empty queries and misses yield `[]`. The returned indices are
 * into the original `text`, suitable for `<mark>` slicing.
 *
 * Only literal occurrences are highlighted: a whitespace-insensitive fallback
 * match has no contiguous span to mark. CJK substrings are matched/returned
 * like any other characters (no word-boundary assumptions).
 */
export function highlightRanges(text: string, query: string): readonly HighlightRange[] {
  const needle = normalizeQuery(query);
  if (needle.length === 0 || text.length === 0) return [];

  const haystack = text.toLowerCase();
  const ranges: HighlightRange[] = [];
  let from = 0;
  for (;;) {
    const start = haystack.indexOf(needle, from);
    if (start === -1) break;
    ranges.push({ start, end: start + needle.length });
    from = start + needle.length;
  }
  return ranges;
}

function occurrenceCount(text: string, needle: string): number {
  if (needle.length === 0) return 0;
  const haystack = text.toLowerCase();
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    count += 1;
    from = at + needle.length;
  }
  return count;
}

/**
 * Relevance ranking: a title hit always outranks a notes-only hit, which in
 * turn outranks a list-name-only hit; within the same tier, more occurrences
 * rank higher. Stable for equal scores, and an empty query leaves the input
 * order untouched.
 */
export function sortByRelevance(
  tasks: readonly Task[],
  query: string,
  listNames?: ReadonlyMap<string, string> | null,
): readonly Task[] {
  const needle = normalizeQuery(query);
  if (needle.length === 0) return [...tasks];

  return [...tasks]
    .map((task, index) => {
      const titleHits = matchStrength(task.title, needle);
      const noteHits = matchStrength(task.notes, needle);
      const listHits = listNames ? matchStrength(listNames.get(task.listId) ?? '', needle) : 0;
      const score =
        titleHits > 0
          ? 3_000_000 + titleHits * 100 + noteHits
          : noteHits > 0
            ? 2_000_000 + noteHits
            : listHits > 0
              ? 1_000_000
              : 0;
      return { task, index, score };
    })
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return a.index - b.index;
    })
    .map((entry) => entry.task);
}

/**
 * Apply the full search filter: text query (title/notes/list name), completion
 * status, and list membership. An empty query keeps all tasks that pass the
 * other predicates.
 */
export function applyFilters(tasks: readonly Task[], filter: SearchFilter): readonly Task[] {
  const names = filter.listNames ?? null;
  return tasks.filter((task) => {
    if (filter.status !== 'all' && task.status !== filter.status) return false;
    if (filter.listId !== null && task.listId !== filter.listId) return false;
    return matchesQuery(task, filter.query, names ? (names.get(task.listId) ?? null) : null);
  });
}
