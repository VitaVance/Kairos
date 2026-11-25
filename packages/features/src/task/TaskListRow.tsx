import { useEffect, useState } from 'react';
import type { LocalDate, Task, TaskId } from '@todolist/core';
import { Checkbox } from '@todolist/ui';
import { formatDue } from './due-label';

export interface TaskListRowProps {
  task: Task;
  today: LocalDate;
  /** Title click — the parent opens the detail panel. */
  onOpen: (id: TaskId) => void;
  /** Checkbox toggle — the parent routes it through `useTasks().toggleDone`. */
  onToggle: (id: TaskId) => void;
  /** Confirmed delete — only called on the second click. */
  onDelete: (id: TaskId) => void;
  /** True while the completion animation for this row should play. */
  fresh?: boolean;
}

/**
 * One task row for flat lists. Presentational + local confirm state only:
 * the parent owns the mutations so every row shares one reload cycle.
 */
export function TaskListRow({ task, today, onOpen, onToggle, onDelete, fresh = false }: TaskListRowProps) {
  const [confirming, setConfirming] = useState(false);
  const done = task.status === 'done';
  const due = formatDue(task, today);

  // A row element can be reused for a different task (filter change, list
  // reorder). The armed state belongs to the task it was armed for, so drop it
  // rather than letting one click delete whatever now occupies this position.
  useEffect(() => {
    setConfirming(false);
  }, [task.id]);

  return (
    <div className={`tk-row${done ? ' tk-row--done' : ''}${fresh ? ' tk-row--fresh' : ''}`}>
      <Checkbox
        checked={done}
        onChange={() => onToggle(task.id)}
        aria-label={done ? `取消完成 ${task.title}` : `完成 ${task.title}`}
      />
      <button type="button" className="tk-row__title" onClick={() => onOpen(task.id)}>
        {task.title}
      </button>

      {due.length > 0 ? <span className="tk-row__due">{due}</span> : null}

      <button
        type="button"
        className={`tk-row__delete${confirming ? ' tk-row__delete--confirm' : ''}`}
        aria-label={confirming ? `确认删除 ${task.title}` : `删除 ${task.title}`}
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
        {confirming ? '确认' : '删除'}
      </button>
    </div>
  );
}
