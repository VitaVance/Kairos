import { useEffect, useId, useRef, useState } from 'react';
import type { DuePeriod, LocalDate, Quadrant, Recurrence, Task, TaskList, TaskSchedule, Weekday } from '@todolist/core';
import { QUADRANT_LABEL, duePrecisionOf, quadrantOf, todayLocal } from '@todolist/core';
import { Button, Checkbox, SegmentedControl, TextField } from '@todolist/ui';
import type { QuadrantKey } from '@todolist/ui';
import { useTasks } from '../data/useTasks';
import { useAppServices } from '../services';
import { DatePicker } from '../pickers/DatePicker';
import { TimePicker } from '../pickers/TimePicker';
import { formatFriendlyDate, PERIOD_LABEL } from '../pickers/picker-math';
import { formatDue } from './due-label';
import { WEEKDAY_LABELS, defaultRecurrence, describeRecurrence, intervalUnit } from './recurrence-label';
import type { RecurrenceFrequencyChoice } from './recurrence-label';

export interface TaskDetailPanelProps {
  task: Task;
  lists: readonly TaskList[];
  onClose: () => void;
}

const QUADRANTS: readonly QuadrantKey[] = [
  'urgent-important',
  'not-urgent-important',
  'urgent-not-important',
  'unimportant',
];

const QUADRANT_OPTIONS = QUADRANTS.map((q) => ({ value: q, label: QUADRANT_LABEL[q] }));

const FREQUENCY_OPTIONS: readonly { value: RecurrenceFrequencyChoice; label: string }[] = [
  { value: 'none', label: '不重复' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
];

/** Local wall-clock `HH:MM` of an instant, or `''` when absent. */
function localTimeOf(instant: string | null): string {
  if (instant === null) return '';
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * The segmented control's five choices: the whole-day pole, the three
 * half-day buckets, then the exact-time pole. `duePrecisionOf` collapses
 * `day`/`period`/`time`; expanding a `period` back into its bucket is the
 * only extra step, and `'none'` displays as `全天` (see `applyPrecision`).
 */
export type PrecisionChoice = 'day' | DuePeriod | 'time';

const PRECISION_OPTIONS: readonly { value: PrecisionChoice; label: string }[] = [
  { value: 'day', label: '全天' },
  { value: 'morning', label: PERIOD_LABEL.morning },
  { value: 'afternoon', label: PERIOD_LABEL.afternoon },
  { value: 'evening', label: PERIOD_LABEL.evening },
  { value: 'time', label: '具体时间' },
];

type ScheduleFields = Pick<Task, 'dueDate' | 'dueAt' | 'allDay' | 'duePeriod'>;

export function precisionChoiceOf(task: ScheduleFields): PrecisionChoice {
  const precision = duePrecisionOf(task);
  if (precision === 'period') return task.duePeriod ?? 'day';
  return precision === 'time' ? 'time' : 'day';
}

/**
 * One precision + one date always maps to exactly one `TaskSchedule`. The
 * clock is only read for `'time'`, so callers may pass any `HH:MM` default;
 * `schedule()` is what turns the union into the stored fields.
 */
export function scheduleForPrecision(
  choice: PrecisionChoice,
  date: LocalDate,
  time: string,
): TaskSchedule {
  if (choice === 'day') return { kind: 'day', date };
  if (choice === 'time') return { kind: 'time', date, time };
  return { kind: 'period', date, period: choice };
}

/**
 * The schedule a precision click produces for `task`. Split out from the
 * component so the two rules §4.3 depends on are testable without a DOM:
 * a dateless task adopts `today`, and 具体时间 seeds 09:00 when the task has
 * no clock time yet (it is never written as "time precision, empty clock").
 */
export function scheduleForChoice(
  task: ScheduleFields,
  choice: PrecisionChoice,
  today: LocalDate,
): TaskSchedule {
  // A day/period task stores local midnight in `dueAt`, so reading the clock
  // unconditionally would seed 00:00. Only a task that already *is* an exact
  // time has a clock worth reusing; everything else seeds 09:00.
  const clock = duePrecisionOf(task) === 'time' ? localTimeOf(task.dueAt) : '';
  return scheduleForPrecision(choice, task.dueDate ?? today, clock || '09:00');
}

/**
 * The grey confirmation line under the controls. Reads precision through
 * `duePrecisionOf` so 全天 / 上午 and exact time are never confused, and says
 * 「无固定时间」 for a half-day: the user has to be able to tell that the
 * bucket is not a clock time.
 */
export function scheduleHint(task: ScheduleFields, today: LocalDate): string {
  const precision = duePrecisionOf(task);
  if (precision === 'none' || task.dueDate === null) return '无日期';
  const date = formatFriendlyDate(task.dueDate, today);
  if (precision === 'day') return `${date} · 全天`;
  if (precision === 'period') return `${formatDue(task, today)} · 无固定时间`;
  const clock = localTimeOf(task.dueAt);
  return clock.length > 0 ? `${date} ${clock}` : date;
}

/**
 * Right-side detail panel for a single task.
 *
 * The task object is supplied by the parent from `useTasks().data`, so every
 * successful mutation (routed through `mutate`) re-renders this panel with
 * the freshly reloaded task. Local state is limited to transient edit UI.
 */
export function TaskDetailPanel({ task, lists, onClose }: TaskDetailPanelProps) {
  const { tasks: taskService } = useAppServices();
  const { mutate, toggleDone } = useTasks();

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelTitleRef = useRef(false);
  /** One write at a time: without this, two fast edits can land out of order. */
  const inFlight = useRef(false);
  const notesRef = useRef<HTMLTextAreaElement | null>(null);
  const errorId = useId();
  /**
   * Free-text drafts for the two numeric recurrence fields. They commit on
   * blur, not per keystroke: a controlled number input bound straight to the
   * stored value could not be cleared while editing, and writing on every
   * keystroke queued writes faster than they settled.
   */
  const [intervalDraft, setIntervalDraft] = useState(() => String(task.recurrence?.interval ?? 1));
  const [monthDayDraft, setMonthDayDraft] = useState(() =>
    task.recurrence?.frequency === 'monthly' ? String(task.recurrence.monthDay) : '1',
  );

  const done = task.status === 'done';
  const quadrant = quadrantOf(task) as QuadrantKey;
  const timeValue = localTimeOf(task.dueAt);

  /**
   * Runs one panel write. Every control on this panel is an immediate-commit
   * editor, so a rejected write (list deleted, task removed elsewhere) must be
   * visible: the error is announced and the busy flag disables the controls
   * until the write settles.
   */
  const run = (fn: () => Promise<unknown>, message: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        await mutate(fn);
      } catch (err) {
        console.error(message, err);
        setError(err instanceof Error && err.message.length > 0 ? err.message : message);
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    })();
  };

  const commitTitle = () => {
    if (!editingTitle) return;
    if (cancelTitleRef.current) {
      cancelTitleRef.current = false;
      setEditingTitle(false);
      return;
    }
    const next = titleDraft.trim();
    setEditingTitle(false);
    if (next.length === 0 || next === task.title) return;
    run(() => taskService.rename(task.id, next), '重命名失败，请重试');
  };

  const moveToQuadrant = (next: QuadrantKey) => {
    run(() => taskService.moveToQuadrant(task.id, next as Quadrant), '移动象限失败，请重试');
  };

  /**
   * Re-schedules the task through the `TaskSchedule` union so the service —
   * not this panel — decides what a day / half-day / clock time stores.
   * A cleared date goes through `unschedule` instead (see `onClearDate`).
   */
  const reschedule = (schedule: TaskSchedule) => {
    run(() => taskService.schedule(task.id, schedule), '保存时间失败，请重试');
  };

  const currentDate = (): LocalDate => task.dueDate ?? todayLocal();
  const precision = precisionChoiceOf(task);

  /**
   * Applies a precision choice. Picking a precision for a task that has none
   * adopts today (mirroring the old 全天 checkbox): there is no date to edit
   * yet, and writing nothing would silently roll the control back.
   *
   * Switching to 具体时间 seeds 09:00 when the task had no clock time, so the
   * panel can never be in a "具体时间 selected but empty" state; switching
   * away writes one `period`/`day` schedule, never "clear the time, then set
   * the bucket" as two steps.
   */
  const onPrecisionChange = (choice: PrecisionChoice) => {
    reschedule(scheduleForChoice(task, choice, todayLocal()));
  };

  const onDateChange = (date: LocalDate) => {
    reschedule(scheduleForPrecision(precision, date, timeValue || '09:00'));
  };

  const onTimeChange = (time: string) => {
    reschedule(scheduleForPrecision('time', currentDate(), time));
  };

  /** 清除: core exposes an explicit unschedule use case, so drop the date/time. */
  const onClearDate = () => {
    run(() => taskService.unschedule(task.id), '清除日期失败，请重试');
  };

  // --- repeat -------------------------------------------------------------
  const recurrence = task.recurrence;
  const frequency: RecurrenceFrequencyChoice = recurrence?.frequency ?? 'none';

  const saveRecurrence = (next: Recurrence | null) => {
    run(() => taskService.setRecurrence(task.id, next), '保存重复规则失败，请重试');
  };

  // Keep the drafts in step with the stored rule (switching frequency, or a
  // roll-forward, replaces the rule object). An untouched draft is left alone
  // so typing in another field never rewrites what the user is editing.
  useEffect(() => {
    setIntervalDraft(String(recurrence?.interval ?? 1));
    setMonthDayDraft(recurrence?.frequency === 'monthly' ? String(recurrence.monthDay) : '1');
  }, [recurrence]);

  const commitInterval = () => {
    const value = Number(intervalDraft);
    if (intervalDraft !== '' && Number.isInteger(value) && value >= 1 && value <= 999) {
      if (recurrence === null || value === recurrence.interval) return;
      patchRecurrence({ interval: value });
      return;
    }
    setIntervalDraft(String(recurrence?.interval ?? 1));
  };

  const commitMonthDay = () => {
    const value = Number(monthDayDraft);
    if (monthDayDraft !== '' && Number.isInteger(value) && value >= 1 && value <= 31) {
      if (recurrence === null || recurrence.frequency !== 'monthly' || value === recurrence.monthDay) return;
      saveRecurrence({ ...recurrence, monthDay: value });
      return;
    }
    setMonthDayDraft(recurrence?.frequency === 'monthly' ? String(recurrence.monthDay) : '1');
  };

  const onFrequencyChange = (next: RecurrenceFrequencyChoice) => {
    if (next === 'none') {
      if (recurrence !== null) saveRecurrence(null);
      return;
    }
    if (recurrence !== null && recurrence.frequency === next) return;
    saveRecurrence(defaultRecurrence(next, currentDate()));
  };

  /** Replace one property of the existing rule, keeping the rest. */
  const patchRecurrence = (changes: Partial<Pick<Recurrence, 'interval' | 'until'>>) => {
    if (recurrence === null) return;
    const until = 'until' in changes ? (changes.until ?? null) : (recurrence.until ?? null);
    saveRecurrence({ ...recurrence, ...changes, until });
  };

  const toggleWeekday = (weekday: Weekday) => {
    if (recurrence === null || recurrence.frequency !== 'weekly') return;
    const chosen = new Set(recurrence.weekdays);
    if (chosen.has(weekday)) {
      // Never allow an empty set: the last remaining day stays selected.
      if (chosen.size === 1) return;
      chosen.delete(weekday);
    } else {
      chosen.add(weekday);
    }
    saveRecurrence({ ...recurrence, weekdays: [...chosen].sort((a, b) => a - b) });
  };

  const onDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        await mutate(() => taskService.remove(task.id));
        onClose();
      } catch (err) {
        console.error('删除任务失败', err);
        setError(err instanceof Error && err.message.length > 0 ? err.message : '删除失败，请重试');
        setConfirmDelete(false);
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    })();
  };

  // The panel is keyed by task id, but a parent can reuse it: when the notes
  // field is uncontrolled, a different task must not inherit the old draft.
  useEffect(() => {
    if (notesRef.current) notesRef.current.value = task.notes;
  }, [task.id, task.notes]);

  // The panel behaves like a non-modal side sheet: Escape closes it, focus
  // moves into it when it opens, and it returns focus to whatever opened it
  // (the row's title button) when it goes away.
  const panelRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      previous?.focus?.();
    };
  }, [task.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // A popover (date/time picker) inside the panel owns Escape while open.
      if (document.querySelector('.tl-popover')) return;
      if (editingTitle) return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editingTitle, onClose]);

  return (
    <aside
      ref={panelRef}
      className="tk-panel"
      aria-label="任务详情"
      role="dialog"
      aria-modal="false"
      tabIndex={-1}
      aria-describedby={error ? errorId : undefined}
    >
      <header className="tk-panel__head">
        <Checkbox
          checked={done}
          onChange={() => toggleDone(task.id, task.title)}
          aria-label={done ? `取消完成 ${task.title}` : `完成 ${task.title}`}
        />

        <div
          className="tk-panel__title-wrap"
          onBlur={(e) => {
            // Committing on any blur inside the wrap would fire when focus moves
            // from the title input to an adjacent panel control; only a blur that
            // leaves the wrap (or Enter/Escape, which blur deliberately) commits.
            const next = e.relatedTarget;
            if (next instanceof Node && e.currentTarget.contains(next)) return;
            commitTitle();
          }}
        >
          {editingTitle ? (
            <TextField
              value={titleDraft}
              onChange={setTitleDraft}
              autoFocus
              label="编辑任务标题"
              className="tk-panel__title-field"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelTitleRef.current = true;
                  e.currentTarget.blur();
                }
              }}
            />
          ) : (
            <button
              type="button"
              className={`tk-panel__title${done ? ' tk-panel__title--done' : ''}`}
              onClick={() => {
                setTitleDraft(task.title);
                cancelTitleRef.current = false;
                setEditingTitle(true);
              }}
            >
              {task.title}
            </button>
          )}
        </div>

        <Button variant="ghost" size="sm" onClick={onClose} aria-label="关闭任务详情">
          关闭
        </Button>
      </header>

      <div className="tk-panel__body">
        <section className="tk-section">
          <h2 className="tk-section__title">日期</h2>
          <div className="tk-schedule">
            <DatePicker
              value={task.dueDate}
              onChange={onDateChange}
              onClear={task.dueDate === null ? undefined : onClearDate}
              disabled={busy}
              label="截止日期"
              className="tk-schedule__date"
            />
            {/*
             * Five precisions in one control, no mode switch. Picking a
             * precision on a dateless task adopts today (`onPrecisionChange`),
             * which is why the non-全天 options stay reachable here: a
             * greyed-out SegmentedControl has no per-option disabled state,
             * and auto-adopting today is the specified fallback.
             */}
            <div className="tk-schedule__period">
              <span className="tk-schedule__label">时间精度</span>
              <SegmentedControl
                options={PRECISION_OPTIONS}
                value={precision}
                onChange={onPrecisionChange}
                size="sm"
                ariaLabel="时间精度"
              />
            </div>
            {/* A period implies allDay, so the clock field is gone, not greyed:
                a greyed field would suggest a time can still be entered. */}
            {precision === 'time' ? (
              <TimePicker
                value={timeValue || null}
                onChange={onTimeChange}
                disabled={busy}
                label="具体时间"
                className="tk-schedule__time"
              />
            ) : null}
            <p className="tk-section__hint tk-schedule__hint">{scheduleHint(task, todayLocal())}</p>
          </div>
        </section>

        <section className="tk-section">
          <h2 className="tk-section__title">重复</h2>
          <SegmentedControl
            options={FREQUENCY_OPTIONS}
            value={frequency}
            onChange={onFrequencyChange}
            size="sm"
            ariaLabel="重复频率"
          />
          {recurrence !== null ? (
            <div className="tk-repeat">
              <label className="tk-repeat__interval">
                <span className="tk-repeat__label">间隔</span>
                <input
                  type="number"
                  className="tk-input tk-repeat__number"
                  min={1}
                  max={999}
                  step={1}
                  aria-label="重复间隔"
                  disabled={busy}
                  value={intervalDraft}
                  onChange={(e) => setIntervalDraft(e.target.value)}
                  onBlur={commitInterval}
                />
                <span className="tk-repeat__unit">{intervalUnit(recurrence.frequency)}</span>
              </label>

              {recurrence.frequency === 'weekly' ? (
                <div className="tk-repeat__weekdays" role="group" aria-label="重复的星期">
                  {WEEKDAY_LABELS.map((label, index) => {
                    const weekday = index as Weekday;
                    const active = recurrence.weekdays.includes(weekday);
                    return (
                      <button
                        key={label}
                        type="button"
                        className={`tk-repeat__day${active ? ' tk-repeat__day--active' : ''}`}
                        aria-pressed={active}
                        disabled={busy}
                        onClick={() => toggleWeekday(weekday)}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {recurrence.frequency === 'monthly' ? (
                <label className="tk-repeat__interval">
                  <span className="tk-repeat__label">每月</span>
                  <input
                    type="number"
                    className="tk-input tk-repeat__number"
                    min={1}
                    max={31}
                    step={1}
                    aria-label="每月的哪一天"
                    disabled={busy}
                    value={monthDayDraft}
                    onChange={(e) => setMonthDayDraft(e.target.value)}
                    onBlur={commitMonthDay}
                  />
                  <span className="tk-repeat__unit">日</span>
                </label>
              ) : null}

              <label className="tk-repeat__until">
                <span className="tk-repeat__label">直到</span>
                <DatePicker
                  value={recurrence.until ?? null}
                  onChange={(date) => patchRecurrence({ until: date })}
                  onClear={() => patchRecurrence({ until: null })}
                  label="重复结束日期"
                  placeholder="不结束"
                  className="tk-repeat__date"
                />
              </label>

              <p className="tk-section__hint">{describeRecurrence(recurrence)}</p>
              <p className="tk-section__hint">勾选完成时会自动推进到下一次。</p>
            </div>
          ) : null}
        </section>

        <section className="tk-section">
          <h2 className="tk-section__title">象限</h2>
          <SegmentedControl
            options={QUADRANT_OPTIONS}
            value={quadrant}
            onChange={moveToQuadrant}
            size="sm"
            ariaLabel="移动到象限"
          />
        </section>

        <section className="tk-section">
          <h2 className="tk-section__title">清单</h2>
          <label className="tk-select">
            <span className="tl-visually-hidden">任务所属清单</span>
            <select
              className="tk-input tl-select"
              aria-label="任务所属清单"
              value={task.listId}
              disabled={busy}
              onChange={(e) => {
                const next = lists.find((l) => l.id === e.target.value);
                if (next) run(() => taskService.moveToList(task.id, next.id), '移动到清单失败，请重试');
              }}
            >
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="tk-section">
          <h2 className="tk-section__title">备注</h2>
          <textarea
            ref={notesRef}
            className="tk-input tk-notes"
            rows={4}
            aria-label="备注"
            defaultValue={task.notes}
            placeholder="添加备注…"
            disabled={busy}
            onBlur={(e) => {
              const next = e.target.value;
              if (next !== task.notes) run(() => taskService.updateNotes(task.id, next), '保存备注失败，请重试');
            }}
          />
        </section>

        {error ? (
          <p className="tk-section__hint tk-panel__error" role="alert" id={errorId}>
            {error}
          </p>
        ) : null}
      </div>

      <footer className="tk-panel__foot">
        {confirmDelete ? (
          <div className="tk-confirm">
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={busy}>
              取消
            </Button>
            <Button variant="danger" size="sm" onClick={onDelete} disabled={busy}>
              {busy ? '删除中…' : '确认删除'}
            </Button>
          </div>
        ) : (
          <Button variant="danger" size="sm" onClick={onDelete} disabled={busy}>
            删除
          </Button>
        )}
      </footer>
    </aside>
  );
}
