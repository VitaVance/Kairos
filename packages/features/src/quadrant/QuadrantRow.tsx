import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { Task, TaskList } from '@todolist/core';
import { daysFromToday, quadrantOf, todayLocal, urgencyOf } from '@todolist/core';
import { urgencyBadge } from './urgency-badge';
import type { UrgencyBadge } from './urgency-badge';
import { Checkbox, useTranslation } from '@todolist/ui';
import type { QuadrantKey } from '@todolist/ui';
import type { Instant, LocalDate, TaskId } from '@todolist/core';
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
  /**
   * The clock. ADR 0007: urgency is derived, so the row has to be told what
   * time it is — and it must be the same reading the board grouped by, or a
   * row could sit in Q1 while its own badge says “not urgent”.
   */
  now: Instant;
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
  now,
  fresh = false,
  leaving = false,
}: QuadrantRowProps) {
  const { t } = useTranslation('lists');
  const list = lists.find((l) => l.id === task.listId);
  const meta = metaLabel(task, list, today, t('quadrant.inbox'));
  const done = task.status === 'done';
  const quadrant = taskQuadrant(task);
  /*
   * ADR 0007 决策 5：行上要说清「为什么在 Q1」。
   *
   * 「用户标的」和「时间推的」在数据上都读作紧急，但一件是他昨天决定的事，
   * 另一件他根本没做决定、是日期到了。都画成同一个红点，等于让系统替他说话。
   *
   * daysUntilDue 只在 near 档用得到（「今天到期」/「明天到期」），
   * 而 near 不进 Q1 —— 那条信号只能放在行上。
   */
  const urgency = urgencyOf(task, now);
  const badge = urgencyBadge(task, urgency, daysUntilDue(task));

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
      {badge.kind === 'none' ? null : (
        <span
          className={'qz-row__why qz-row__why--' + badge.kind}
          /*
           * 「时间推的」和「我标的」必须看起来不一样。这不是装饰：
           * 前者拖不走（ADR 0007 决策 3），后者拖得走。用户在执行拖动之前，
           * 就该从这一枚标记上看出区别。
           *
           * 文案直接映射而不是拼 key：i18n 的类型检查要求字面量键，
           * 而拼出来的键恰恰会让漏翻的文案静默变成 key 本身。
           */
          title={badgeText(badge, t)}
        >
          {badgeText(badge, t)}
        </span>
      )}
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

/**
 * 距离截止还有几天（负数表示已过期）。只按本地日期算，不按小时 ——
 * 「今天到期」和「明天到期」是日历上的说法，不是剩余小时数的说法。
 *
 * 没有日期时返回 null：无从谈起。
 */
/**
 * 把 badge 的枚举翻成文案。用穷举而不是拼 `'quadrant.' + label`：
 * i18n 的类型检查要求字面量键，而拼出来的键在漏翻时会静默显示 key 本身 ——
 * 用户看到的是一串英文标识符，不是「已过期」。
 */
function badgeText(
  badge: UrgencyBadge,
  t: (key: 'quadrant.overdue' | 'quadrant.whyUser' | 'quadrant.dueSoon' | 'quadrant.dueTomorrow') => string,
): string {
  if (badge.kind === 'clock') return t('quadrant.overdue');
  if (badge.kind === 'user') return t('quadrant.whyUser');
  if (badge.kind === 'due') return t(badge.label === 'dueSoon' ? 'quadrant.dueSoon' : 'quadrant.dueTomorrow');
  return '';
}

function daysUntilDue(task: Task): number | null {
  if (task.dueDate === null) return null;
  const today = todayLocal();
  return daysFromToday(task.dueDate, today);
}

export function taskQuadrant(task: Task): QuadrantKey {
  return quadrantOf(task) as QuadrantKey;
}
