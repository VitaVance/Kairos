import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { Task, TaskList } from '@todolist/core';
import { quadrantOf } from '@todolist/core';
import { Checkbox, useTranslation } from '@todolist/ui';
import type { QuadrantKey } from '@todolist/ui';
import type { LocalDate, TaskId } from '@todolist/core';
import { listDisplayName } from '@todolist/core';
import { formatDue } from '../task/due-label';
import { shouldActivateRow } from '../task/row-click';
import type { ClickNode } from '../task/row-click';

/**
 * Custom MIME so a quadrant drag can be told apart from a file drag or a drag
 * started in a different surface. `types` is readable during `dragover`, when
 * `getData` is blocked, so this is what the drop targets key their highlight
 * off. `text/plain` is still set for the actual id.
 */
export const QUADRANT_DRAG_MIME = 'application/x-todolist-task';

/**
 * Arrow keys mirror the visual 2×2 layout (Q1 Q2 / Q3 Q4). Edges simply have
 * no neighbour, so a key press at an edge is a no-op rather than wrapping to
 * an unrelated quadrant.
 */
const KEY_TARGETS: Record<QuadrantKey, Partial<Record<string, QuadrantKey>>> = {
  'urgent-important': { ArrowRight: 'not-urgent-important', ArrowDown: 'urgent-not-important' },
  'not-urgent-important': { ArrowLeft: 'urgent-important', ArrowDown: 'unimportant' },
  'urgent-not-important': { ArrowUp: 'urgent-important', ArrowRight: 'unimportant' },
  unimportant: { ArrowUp: 'not-urgent-important', ArrowLeft: 'urgent-not-important' },
};

export interface QuadrantRowProps {
  task: Task;
  lists: readonly TaskList[];
  today: LocalDate;
  onToggle: (id: TaskId, source: 'checkbox' | 'row') => void;
  /**
   * Keyboard path to another quadrant (arrow keys on the focused handle).
   * Required for accessibility: quadrant assignment changes the task's
   * important/urgent flags, so it is user-controlled data, not decoration.
   */
  onMove?: (id: TaskId, quadrant: QuadrantKey) => void;
  /** Pointer drag lifecycle, owned by the screen (highlight + grabbing cursor). */
  onDragStart?: (id: TaskId) => void;
  onDragEnd?: () => void;
  /** This row is the one being dragged right now. */
  dragging?: boolean;
  /** Chevron click opens the task detail panel. */
  onOpen?: (id: TaskId) => void;
  /** True while the completion animation for this row should play. */
  fresh?: boolean;
  /**
   * This row is exiting the open list after being completed. It stays mounted
   * for one animation beat so the user sees the tick land, then fades out
   * instead of vanishing on the same frame.
   */
  leaving?: boolean;
}

/**
 * Row meta: the due date when there is one, otherwise the task's list. The due
 * wording comes from `formatDue` — the same helper the flat rows use — so the
 * two surfaces can never drift (this file used to keep its own copy).
 *
 * The list label is resolved through `listDisplayName`, so a system inbox shows
 * the catalog's word for it (and follows a language switch), while a user list
 * keeps its stored name. `inboxLabel` is the already-translated fallback used
 * when the task's list is missing from the snapshot.
 */
function metaLabel(
  task: Task,
  list: TaskList | undefined,
  today: LocalDate,
  inboxLabel: string,
): string {
  const due = formatDue(task, today);
  if (due.length > 0) return due;
  return list === undefined ? inboxLabel : listDisplayName(list, inboxLabel);
}

export function QuadrantRow({
  task,
  lists,
  today,
  onToggle,
  onMove,
  onDragStart,
  onDragEnd,
  dragging = false,
  onOpen,
  fresh = false,
  leaving = false,
}: QuadrantRowProps) {
  const { t } = useTranslation('lists');
  const list = lists.find((l) => l.id === task.listId);
  const meta = metaLabel(task, list, today, t('quadrant.inbox'));
  const done = task.status === 'done';
  const quadrant = taskQuadrant(task);

  const moveByArrow = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const target = KEY_TARGETS[quadrant][event.key];
    if (!target || !onMove) return;
    // Arrow keys on a focused control normally scroll or move the caret;
    // claiming them here is the whole point of the keyboard path.
    event.preventDefault();
    onMove(task.id, target);
  };

  const handleRowClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // Same rule as the flat row: the handle, checkbox and chevron own their
    // own clicks. The body opens the task; only the checkbox completes it.
    if (!shouldActivateRow(event.target as unknown as ClickNode, event.currentTarget as unknown as ClickNode)) {
      return;
    }
    // With no detail panel mounted (`onOpen` absent, e.g. a bare screen in a
    // test or a story), the body click falls back to completing — otherwise
    // the row would have no action at all.
    if (onOpen) onOpen(task.id);
    else onToggle(task.id, 'row');
  };

  return (
    <div
      className={`qz-row${done ? ' qz-row--done' : ''}${fresh ? ' qz-row--fresh' : ''}${leaving ? ' qz-row--leaving' : ''}${dragging ? ' qz-row--dragging' : ''}`}
      data-qz-task={task.id}
      onClick={handleRowClick}
    >
      {/* Only the handle initiates a drag. The row is *not* draggable: it holds
          a checkbox, a chevron and a handle, and a draggable ancestor would
          swallow their pointer gestures. The row *click* is fine because it
          runs only when the chain below it is free of controls. */}
      <button
        type="button"
        className="qz-row__handle"
        draggable
        aria-label={t('row.dragAria', { title: task.title })}
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
        title={t('row.dragHint')}
        onDragStart={(e) => {
          e.dataTransfer.setData(QUADRANT_DRAG_MIME, task.id);
          e.dataTransfer.setData('text/plain', task.id);
          e.dataTransfer.effectAllowed = 'move';
          // Default drag image would be the 16px glyph; the whole row reads
          // better as the thing being carried.
          const row = e.currentTarget.closest('.qz-row');
          if (row instanceof HTMLElement) e.dataTransfer.setDragImage(row, 12, 16);
          onDragStart?.(task.id);
        }}
        onDragEnd={() => onDragEnd?.()}
        onKeyDown={moveByArrow}
      >
        <svg viewBox="0 0 10 16" width="8" height="13" fill="currentColor" aria-hidden="true">
          <circle cx="3" cy="3" r="1.1" />
          <circle cx="7" cy="3" r="1.1" />
          <circle cx="3" cy="8" r="1.1" />
          <circle cx="7" cy="8" r="1.1" />
          <circle cx="3" cy="13" r="1.1" />
          <circle cx="7" cy="13" r="1.1" />
        </svg>
      </button>
      <Checkbox
        checked={done}
        onChange={() => onToggle(task.id, 'checkbox')}
        aria-label={done ? t('row.markOpen', { title: task.title }) : t('row.markDone', { title: task.title })}
      />
      <span className="qz-row__title">{task.title}</span>
      <span className="qz-row__meta">{meta}</span>
      {onOpen ? (
        // Labelled, not a mystery glyph — and it stays even though the row
        // body now opens the task too, because a visible affordance is what
        // makes "this row opens" discoverable without hovering.
        <button
          type="button"
          className="qz-row__open"
          aria-label={t('row.openAria', { title: task.title })}
          title={t('row.openHint')}
          onClick={() => onOpen(task.id)}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
            <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

export function taskQuadrant(task: Task): QuadrantKey {
  return quadrantOf(task) as QuadrantKey;
}
