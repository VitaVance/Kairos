import { useEffect, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { LocalDate, Task, TaskId } from '@todolist/core';
import { Checkbox, useTranslation } from '@todolist/ui';
import { formatDue } from './due-label';
import type { ClickNode } from './row-click';
import { shouldActivateRow } from './row-click';

export interface TaskListRowProps {
  task: Task;
  today: LocalDate;
  /** Row-body click and the chevron both open the detail panel. */
  onOpen: (id: TaskId) => void;
  /** Checkbox only — completing is the one destructive gesture on the row. */
  onToggle: (id: TaskId, source: 'checkbox' | 'row') => void;
  /** Confirmed delete — only called on the second click. */
  onDelete: (id: TaskId) => void;
  /** True while the completion animation for this row should play. */
  fresh?: boolean;
}

/**
 * One task row for flat lists. Presentational + local confirm state only:
 * the parent owns the mutations so every row shares one reload cycle.
 *
 * Interaction model (shared with `QuadrantRow`): the row body *opens* the
 * task; only the checkbox completes it. Completing is the one gesture here
 * that can create a second row (a recurring task spawns its next
 * occurrence) and it was previously reachable by any stray click on the
 * title — the row you meant to read became the row you finished. Opening is
 * reversible, so it gets the large target.
 */
export function TaskListRow({ task, today, onOpen, onToggle, onDelete, fresh = false }: TaskListRowProps) {
  const { t } = useTranslation('task');
  const { t: tCommon } = useTranslation('common');
  const [confirming, setConfirming] = useState(false);
  const done = task.status === 'done';
  const due = formatDue(task, today);

  // A row element can be reused for a different task (filter change, list
  // reorder). The armed state belongs to the task it was armed for, so drop it
  // rather than letting one click delete whatever now occupies this position.
  useEffect(() => {
    setConfirming(false);
  }, [task.id]);

  const handleRowClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // The checkbox, chevron and delete button (and any link inside the title)
    // own their clicks; the row only acts on the leftover body area.
    if (!shouldActivateRow(event.target as unknown as ClickNode, event.currentTarget as unknown as ClickNode)) {
      return;
    }
    onOpen(task.id);
  };

  return (
    <div
      className={`tk-row${done ? ' tk-row--done' : ''}${fresh ? ' tk-row--fresh' : ''}`}
      onClick={handleRowClick}
    >
      <Checkbox
        checked={done}
        onChange={() => onToggle(task.id, 'checkbox')}
        aria-label={
          done
            ? t('row.uncompleteAria', { title: task.title })
            : t('row.completeAria', { title: task.title })
        }
      />
      <span className="tk-row__title">{task.title}</span>

      {due.length > 0 ? <span className="tk-row__due">{due}</span> : null}

      <button
        type="button"
        className={`tk-row__delete${confirming ? ' tk-row__delete--confirm' : ''}`}
        aria-label={
          confirming
            ? t('row.confirmDeleteAria', { title: task.title })
            : t('row.deleteAria', { title: task.title })
        }
        onClick={() => {
          if (confirming) onDelete(task.id);
          else setConfirming(true);
        }}
        onBlur={() => setConfirming(false)}
        onKeyDown={(e) => {
          // Escape must get the row out of the armed state without deleting;
          // blur only fires when focus actually moves elsewhere.
          if (e.key === 'Escape' && confirming) {
            e.stopPropagation();
            setConfirming(false);
          }
        }}
      >
        {confirming ? t('row.confirm') : tCommon('buttons.delete')}
      </button>

      {/* The chevron stays as an explicit, labelled affordance even though the
          row body now opens the task too: the label is what a screen reader
          announces, and a visible affordance keeps "this opens" discoverable
          without hovering the whole row. */}
      <button
        type="button"
        className="tk-row__open"
        aria-label={t('row.openAria', { title: task.title })}
        title={t('row.openHint')}
        onClick={() => onOpen(task.id)}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
          <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
