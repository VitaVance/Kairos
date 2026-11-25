import type { ChipProps } from './components/Chip';

export * from './components/Button';
export * from './components/IconButton';
export * from './components/Checkbox';
export * from './components/Chip';
export * from './components/Badge';
export * from './components/Card';
export * from './components/SegmentedControl';
export * from './components/ViewSwitcherPill';
export * from './components/EmptyState';
export * from './components/TextField';
export * from './components/Popover';
export * from './components/CollapsibleSection';
export * from './components/ScrollArea';
export * from './icons';
export * from './themes/index';

export type ChipModel = ChipProps;

/**
 * Listenfarben helper: 8 curated hues, assigned by list order so colors stay
 * stable as lists are added. Lives here (presentation concern) not in core.
 */
export const LIST_HUES = [
  'var(--tl-hue-1-base)',
  'var(--tl-hue-2-base)',
  'var(--tl-hue-3-base)',
  'var(--tl-hue-4-base)',
  'var(--tl-hue-5-base)',
  'var(--tl-hue-6-base)',
  'var(--tl-hue-7-base)',
  'var(--tl-hue-8-base)',
] as const;

export const LIST_TINTS = [
  'var(--tl-hue-1-tint)',
  'var(--tl-hue-2-tint)',
  'var(--tl-hue-3-tint)',
  'var(--tl-hue-4-tint)',
  'var(--tl-hue-5-tint)',
  'var(--tl-hue-6-tint)',
  'var(--tl-hue-7-tint)',
  'var(--tl-hue-8-tint)',
] as const;

export function hueForIndex(index: number): { color: string; tint: string } {
  const i = ((index % 8) + 8) % 8;
  return { color: LIST_HUES[i]!, tint: LIST_TINTS[i]! };
}

/** Quadrant keys — mirrored from core as a plain union to keep ui dependency-free. */
export type QuadrantKey =
  | 'urgent-important'
  | 'not-urgent-important'
  | 'urgent-not-important'
  | 'unimportant';

/** Quadrant → CSS variable pair, single source for matrix colors. */
export const QUADRANT_COLOR: Record<QuadrantKey, { color: string; tint: string }> = {
  'urgent-important': { color: 'var(--tl-quadrant-q1)', tint: 'var(--tl-quadrant-q1-tint)' },
  'not-urgent-important': { color: 'var(--tl-quadrant-q2)', tint: 'var(--tl-quadrant-q2-tint)' },
  'urgent-not-important': { color: 'var(--tl-quadrant-q3)', tint: 'var(--tl-quadrant-q3-tint)' },
  unimportant: { color: 'var(--tl-quadrant-q4)', tint: 'var(--tl-quadrant-q4-tint)' },
};

/** Minimal shape needed to color a task by its list — avoids importing core. */
export interface TaskColorSource {
  listId: string;
}

export interface ListColorSource {
  id: string;
}

/** Resolve the display color for a task's list, falling back to neutral. */
export function colorForTask(task: TaskColorSource, lists: readonly ListColorSource[]): string {
  const idx = lists.findIndex((l) => l.id === task.listId);
  return idx >= 0 ? (LIST_HUES[idx % 8] as string) : 'var(--tl-text-tertiary)';
}
