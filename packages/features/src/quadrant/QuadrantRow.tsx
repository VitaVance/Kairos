import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Task, TaskList } from '@todolist/core';
import { quadrantOf } from '@todolist/core';
import { Checkbox } from '@todolist/ui';
import type { QuadrantKey } from '@todolist/ui';
import type { LocalDate, TaskId } from '@todolist/core';
import { formatDue } from '../task/due-label';

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
  onToggle: (id: TaskId) => void;
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
  /** Clicking the title opens the task detail panel. */
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
 */
function metaLabel(task: Task, listName: string | undefined, today: LocalDate): string {
  const due = formatDue(task, today);
  return due.length > 0 ? due : (listName ?? '收集箱');
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
  const list = lists.find((l) => l.id === task.listId);
  const meta = metaLabel(task, list?.name, today);
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

  return (
    <div
      className={`qz-row${done ? ' qz-row--done' : ''}${fresh ? ' qz-row--fresh' : ''}${leaving ? ' qz-row--leaving' : ''}${dragging ? ' qz-row--dragging' : ''}`}
      data-qz-task={task.id}
    >
      {/* Only the handle initiates a drag. The row is *not* draggable: it holds
          a checkbox and a title button, and a draggable ancestor would swallow
          their pointer gestures. */}
      <button
        type="button"
        className="qz-row__handle"
        draggable
        aria-label={`拖动「${task.title}」到其他象限`}
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
        title="拖动到其他象限，或聚焦后用方向键移动"
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
        onChange={() => onToggle(task.id)}
        aria-label={done ? `取消完成 ${task.title}` : `完成 ${task.title}`}
      />
      {onOpen ? (
        <button type="button" className="qz-row__title qz-row__title--btn" onClick={() => onOpen(task.id)}>
          {task.title}
        </button>
      ) : (
        <span className="qz-row__title">{task.title}</span>
      )}
      <span className="qz-row__meta">{meta}</span>
    </div>
  );
}

export function taskQuadrant(task: Task): QuadrantKey {
  return quadrantOf(task) as QuadrantKey;
}
