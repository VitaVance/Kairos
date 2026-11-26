import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { LocalDate, Quadrant } from '@todolist/core';
import { addDays, instantAtLocal, startOfWeek, todayLocal } from '@todolist/core';
import {
  Button,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SegmentedControl,
  isSubmitEnter,
  useTranslation,
} from '@todolist/ui';
import type { QuadrantKey } from '@todolist/ui';
import { useAppServices } from '../services';
import { buildMonthGrid } from './year-math';
import {
  dayInMonth,
  dayOf,
  formatDayLabel,
  formatFriendlyDate,
  formatMonthHeading,
  monthKeyOf,
  nextMonday,
  shiftMonth,
  weekdayLong,
  weekdayShort,
} from '../pickers/picker-math';
import type { MonthKey } from '../pickers/picker-math';
import { formatMinuteRange, parseHourLabel } from './time-math';
import './calendar.css';

/**
 * Where a quick-create was triggered from. The point positions the panel under
 * the click; `returnFocusTo` is the element focus goes back to on close (the
 * grid column the user clicked).
 */
export interface SlotAnchor {
  readonly x: number;
  readonly y: number;
  readonly returnFocusTo?: HTMLElement | null;
}

/**
 * The prop every time-grid view accepts to route an empty-slot click to the
 * quick composer instead of the full editor: `(date, "HH:MM", anchor)`, with
 * the anchor carrying the click point and the element to return focus to.
 */
export type SlotCreateHandler = (date: LocalDate, time: string, anchor: SlotAnchor) => void;

/**
 * What the bar is about to create.
 *
 * One bar, two objects: the quadrant board is this app's default view and its
 * central concept, but Ctrl+N only ever produced a `CalendarEvent` — which the
 * board does not render, so the thing you just made vanished. The type toggle
 * makes the choice explicit instead of implicit-by-shortcut.
 */
export type CaptureMode = 'task' | 'event';

export interface QuickEventComposerProps {
  open: boolean;
  /** Day the slot click landed on. */
  date: LocalDate;
  /** Slot start "HH:MM"; the event defaults to one hour from here. */
  time?: string;
  /** Click position used to anchor the panel. Omitted for the Ctrl+N entry. */
  anchor?: SlotAnchor | null;
  /** Overridable for tests / deterministic renders. */
  today?: LocalDate;
  /** Lists offered in the footer chip. First one is the default. */
  lists?: readonly { id: string; name: string; color: string }[];
  /**
   * Which object the bar opens on. Calendar entries pass 'event'; the quadrant
   * board and the global shortcut pass 'task'. The toggle stays usable either
   * way — this only picks the starting side.
   */
  mode?: CaptureMode;
  /**
   * List to pre-select, from the active sidebar filter. Falls back to the first
   * list, which is the rule `QuadrantScreen` already uses (`listId ?? lists[0]`).
   */
  defaultListId?: string | null;
  onClose: () => void;
  /** Called after a successful write so the host can refetch. */
  onCreated?: () => void;
}

const DEFAULT_TIME = '09:00';
const DEFAULT_DURATION_MIN = 60;
/** Space kept between the panel and the click point / viewport edge. */
const PANEL_GAP = 8;
const VIEWPORT_EDGE = 8;

/** The four chips, in board order (Q1 top-left → Q4 bottom-right). */
const QUADRANT_OPTIONS = [
  { value: 'urgent-important' as QuadrantKey, labelKey: 'capture.q1', dot: 'var(--tl-quadrant-q1)' },
  { value: 'not-urgent-important' as QuadrantKey, labelKey: 'capture.q2', dot: 'var(--tl-quadrant-q2)' },
  { value: 'urgent-not-important' as QuadrantKey, labelKey: 'capture.q3', dot: 'var(--tl-quadrant-q3)' },
  { value: 'unimportant' as QuadrantKey, labelKey: 'capture.q4', dot: 'var(--tl-quadrant-q4)' },
] as const;

/**
 * Non-modal quick composer for a calendar slot click.
 *
 * A single capture field plus the slot's pre-filled date/time chips and an
 * 添加 action — the lightweight counterpart to the full EventEditor dialog,
 * which stays reachable from the top bar. Clicking the date chip reveals an
 * inline date row (今天 / 明天 / 下周一 / 自定 and a month grid) built from the
 * same pure helpers the DatePicker uses, so no month maths is duplicated.
 *
 * Keyboard: Enter submits, Esc closes and returns focus to the opener, and the
 * collapsed tab order is field → date chip → 添加.
 */
export function QuickEventComposer({
  open,
  date: dateProp,
  time: timeProp,
  anchor,
  today: todayProp,
  lists = [],
  mode: modeProp = 'event',
  defaultListId = null,
  onClose,
  onCreated,
}: QuickEventComposerProps) {
  const { t, i18n } = useTranslation('calendar');
  const { t: tPickers } = useTranslation('pickers');
  const lng = i18n.resolvedLanguage ?? i18n.language;
  const { events, tasks } = useAppServices();

  const panelRef = useRef<HTMLDivElement | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  // Read the latest anchor through a ref so the focus-restore cleanup never
  // tears down on every parent re-render that hands in a fresh object.
  const anchorRef = useRef(anchor ?? null);
  anchorRef.current = anchor ?? null;
  const fieldId = useId();
  const titleLabelId = useId();

  const today = todayProp ?? todayLocal();
  const time = timeProp ?? DEFAULT_TIME;

  const [mode, setMode] = useState<CaptureMode>(modeProp);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState<LocalDate>(dateProp);
  const [showDate, setShowDate] = useState(false);
  const [viewMonth, setViewMonth] = useState<MonthKey>(() => monthKeyOf(dateProp));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Duration in minutes; the end is always derived from start + this, so the
     two can never disagree the way two independent clocks do. */
  const [duration, setDuration] = useState(DEFAULT_DURATION_MIN);
  const [allDay, setAllDay] = useState(false);
  /* Kept across a mode flip: the G doc's rule is "carry over, do not convert".
     Turning 15:00–16:00 into a due date is a lossy guess, and a user who
     flipped by accident must not find their value silently rewritten. */
  const [quadrant, setQuadrant] = useState<QuadrantKey>('unimportant');
  const [listId, setListId] = useState<string | null>(defaultListId ?? lists[0]?.id ?? null);
  const [showList, setShowList] = useState(false);

  const weekdays = useMemo(() => weekdayShort(lng), [lng]);
  const weekdayLongNames = useMemo(() => weekdayLong(lng), [lng]);

  // Re-seed whenever the composer is pointed at a new slot (a second click on
  // the grid while it is already open).
  useEffect(() => {
    if (!open) return;
    setMode(modeProp);
    setTitle('');
    setDate(dateProp);
    setShowDate(false);
    setViewMonth(monthKeyOf(dateProp));
    setBusy(false);
    setError(null);
    setDuration(DEFAULT_DURATION_MIN);
    setAllDay(false);
    // Mirror `createInbox`'s defaults (important:false, urgent:false), so the
    // pre-selected chip is the quadrant the task genuinely lands in.
    setQuadrant('unimportant');
    setListId(defaultListId ?? lists[0]?.id ?? null);
    setShowList(false);
  }, [open, dateProp, timeProp, lists, modeProp, defaultListId]);

  const restoreFocus = useCallback(() => {
    const target = anchorRef.current?.returnFocusTo ?? restoreRef.current;
    if (!target || !target.isConnected) return;
    // Calendar columns are plain divs; -1 makes them programmatically
    // focusable without adding them to the tab order.
    if (target.tabIndex < 0) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }, []);

  // Capture the opener when the panel opens and give the text field focus. The
  // cleanup hands focus back to the opener (Esc, outside click, save). Keyed on
  // `open` only: `restoreFocus` is stable and reads the anchor through a ref,
  // so a parent handing in a fresh click point never re-captures mid-session.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    fieldRef.current?.focus();
    return () => restoreFocus();
  }, [open, restoreFocus]);

  // Dismiss on an outside pointerdown. The listener is attached only while the
  // panel is open, so the click that opened it cannot immediately close it.
  // `onClose` is read through a ref so a fresh inline arrow from the parent
  // does not re-subscribe (and so the closure always sees the latest handler).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  /** Read by the document-level Enter handler; submit is declared below it. */
  const submitRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const panel = panelRef.current;
      if (panel?.contains(event.target as Node)) return;
      onCloseRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  // Esc closes one layer at a time: the date row first, then the list popover,
  // then the panel. Closing the whole bar while a popover was open lost both
  // the popover state and any typed title in one keystroke.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (showDate) {
        setShowDate(false);
        return;
      }
      if (showList) {
        setShowList(false);
        return;
      }
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, showDate, showList]);

  // Enter submits from anywhere in the panel, not only from the title field.
  // "Click a duration chip, then hit Enter" is the common path; it did nothing
  // because the handler was bound to the input alone.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.shiftKey) return;
      // The title's own handler already submitted and called preventDefault;
      // without this check the document listener would submit a second time.
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      // A textarea owns Enter (the title is one), and a time input lets the UA
      // step its value. Buttons are deliberately NOT exempt: "click a duration
      // chip, then press Enter" is the flow this handler exists for.
      if (target) {
        if (target.tagName === 'TEXTAREA') return;
        if (target.tagName === 'INPUT' && target.getAttribute('type') === 'time') return;
      }
      if (!isSubmitEnter(event)) return;
      event.preventDefault();
      void submitRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // Clamp the fixed panel inside the viewport, below the click when there is
  // room and above it otherwise.
  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const place = () => {
      const rect = panel.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      const anchorX = anchor?.x ?? window.innerWidth / 2;
      const anchorY = anchor?.y ?? window.innerHeight / 3;
      const maxLeft = window.innerWidth - width - VIEWPORT_EDGE;
      const left = Math.max(VIEWPORT_EDGE, Math.min(anchorX - width / 2, maxLeft));
      const below = anchorY + PANEL_GAP;
      const top =
        below + height > window.innerHeight - VIEWPORT_EDGE && anchorY - PANEL_GAP - height > VIEWPORT_EDGE
          ? anchorY - PANEL_GAP - height
          : Math.min(below, Math.max(VIEWPORT_EDGE, window.innerHeight - height - VIEWPORT_EDGE));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, anchor, showDate]);

  const grid = useMemo(() => buildMonthGrid(viewMonth.year, viewMonth.month), [viewMonth]);

  /* End is derived, never stored: start + duration, rolling into the next day
     when the sum passes midnight. Two independent clocks could disagree (the
     bug that let all-day toggling produce a 25-hour event). */
  const slotEnd = useMemo(() => {
    const startMin = parseHourLabel(time) ?? 9 * 60;
    const total = startMin + duration;
    return {
      date: total >= 24 * 60 ? addDays(date, 1) : date,
      time: `${String(Math.floor((total % 1440) / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`,
    };
  }, [date, time, duration]);
  const crossesDay = slotEnd.date !== date;
  const rangeLabel = allDay
    ? t('event.allDay')
    : formatMinuteRange(parseHourLabel(time) ?? 9 * 60, parseHourLabel(slotEnd.time) ?? 10 * 60);

  const tomorrow = addDays(today, 1);
  const monday = nextMonday(today);

  /**
   * Roving focus for the month grid.
   *
   * The grid carried `role="grid"` with no key handling, which is worse than no
   * role at all: it promises arrow navigation that does not exist, and after
   * paging to another month every cell had `tabIndex={-1}`, so the grid was
   * unreachable by keyboard entirely. This mirrors the model in
   * `DatePicker.tsx` (the app already has one correct implementation) rather
   * than inventing a second.
   */
  const [focusDate, setFocusDate] = useState<LocalDate>(dateProp);

  useEffect(() => {
    if (!open) return;
    setFocusDate(dateProp);
  }, [open, dateProp]);

  useEffect(() => {
    if (!open || !showDate) return;
    const grid = panelRef.current?.querySelector<HTMLElement>('.cal-qec__cal-grid');
    grid?.querySelector<HTMLButtonElement>(`[data-date="${focusDate}"]`)?.focus();
  }, [open, showDate, focusDate, viewMonth]);

  const moveGridFocus = (next: LocalDate) => {
    setFocusDate(next);
    const key = monthKeyOf(next);
    setViewMonth((prev) => (prev.year === key.year && prev.month === key.month ? prev : key));
  };

  const onGridKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowLeft':
        moveGridFocus(addDays(focusDate, -1));
        break;
      case 'ArrowRight':
        moveGridFocus(addDays(focusDate, 1));
        break;
      case 'ArrowUp':
        moveGridFocus(addDays(focusDate, -7));
        break;
      case 'ArrowDown':
        moveGridFocus(addDays(focusDate, 7));
        break;
      case 'PageUp': {
        event.preventDefault();
        const next = shiftMonth(monthKeyOf(focusDate), -1);
        moveGridFocus(dayInMonth(next, dayOf(focusDate)));
        return;
      }
      case 'PageDown': {
        event.preventDefault();
        const next = shiftMonth(monthKeyOf(focusDate), 1);
        moveGridFocus(dayInMonth(next, dayOf(focusDate)));
        return;
      }
      case 'Home':
        moveGridFocus(startOfWeek(focusDate));
        break;
      case 'End':
        moveGridFocus(addDays(startOfWeek(focusDate), 6));
        break;
      // Enter / Space fall through to the focused day's native click.
      default:
        return;
    }
    event.preventDefault();
  };

  async function submit() {
    if (busy) return;
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setError(t('event.titleRequired'));
      fieldRef.current?.focus();
      return;
    }
    const targetList = listId ?? lists[0]?.id ?? null;
    if (targetList === null) {
      // Without a list there is nowhere to put the object; say so instead of
      // swallowing the submit (a no-op here reads as a broken button).
      setError(t('event.capture.noListTask'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === 'task') {
        // Two writes, in this order, because `createInbox` is the only task
        // constructor and it always starts unclassified. A failure on the
        // second write would leave an open task in the default quadrant, so
        // the title is kept and the error surfaces rather than silently
        // "succeeding" into the wrong card.
        const created = await tasks.createInbox(trimmed, targetList as never);
        if (quadrant !== 'unimportant') {
          await tasks.moveToQuadrant(created.id, quadrant as Quadrant);
        }
      } else {
        await events.create({
          title: trimmed,
          startAt: instantAtLocal(date, allDay ? '00:00' : time),
          endAt: instantAtLocal(slotEnd.date, allDay ? '00:00' : slotEnd.time),
          allDay,
          listId: targetList as never,
        });
      }
      // The host bumps the revision, so the grids and the board refetch.
      onCreated?.();
      onClose();
    } catch (err: unknown) {
      // Every field survives a failed write — a rejected create must not cost
      // the user the sentence they just typed.
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }
  submitRef.current = submit;

  function pickDate(next: LocalDate) {
    setDate(next);
    setViewMonth(monthKeyOf(next));
  }

  function stepMonth(delta: number) {
    setViewMonth((prev) => shiftMonth(prev, delta));
  }

  if (!open) return null;

  const isTask = mode === 'task';
  const canSubmit = !busy && title.trim().length > 0;

  return (
    <div
      ref={panelRef}
      className="cal-qec"
      role="dialog"
      aria-modal="false"
      /* No aria-label here: the dialog takes its name from the title field's
         label via aria-labelledby. Reusing the placeholder made the bar and the
         field announce the same sentence twice, which is the duplication the
         accessibility guide calls out for state/label overlap. */
      aria-labelledby={titleLabelId}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {/*
        Type toggle, first in the bar. Radio-group semantics with roving
        tabindex — the same contract `SegmentedControl` implements for the
        detail panel's quadrant picker, so the app has one keyboard story for
        "pick one of N", not two.
      */}
      <div className="cal-qec__type">
        <SegmentedControl
          size="sm"
          ariaLabel={t('event.capture.type')}
          value={mode}
          onChange={(next) => setMode(next)}
          options={[
            { value: 'task' as CaptureMode, label: t('event.capture.typeTask') },
            { value: 'event' as CaptureMode, label: t('event.capture.typeEvent') },
          ]}
        />
      </div>

      <label className="tl-visually-hidden" id={titleLabelId} htmlFor={fieldId}>
        {isTask ? t('event.capture.titleTask') : t('event.capture.titleEvent')}
      </label>
      <textarea
        ref={fieldRef}
        id={fieldId}
        className="cal-qec__title"
        rows={2}
        value={title}
        placeholder={isTask ? t('event.capture.placeholderTask') : t('event.capture.placeholderEvent')}
        autoComplete="off"
        aria-labelledby={titleLabelId}
        disabled={busy}
        onChange={(event) => {
          setTitle(event.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(event) => {
          // The IME's candidate-confirming Enter must not create the object,
          // and a textarea's Enter must insert a newline rather than submit.
          if (isSubmitEnter(event)) {
            event.preventDefault();
            void submit();
          }
        }}
      />

      {/* Task mode: the product's central axis, right under the title. */}
      {isTask ? (
        <div className="cal-qec__quad">
          <SegmentedControl
            size="sm"
            className="cal-qec__quad-seg"
            ariaLabel={t('event.capture.quadrant')}
            value={quadrant}
            onChange={setQuadrant}
            options={QUADRANT_OPTIONS.map((o) => ({
              value: o.value,
              label: t(`event.${o.labelKey}`),
              /* The dot carries the same four hues the board's card heads use,
                 so "which card will this land in" is answerable at a glance
                 without reading four long Chinese labels. aria-hidden: the
                 label is the name, the dot is decoration. */
              leading: (
                <span
                  className="cal-qec__quad-dot"
                  style={{ background: o.dot }}
                  aria-hidden="true"
                />
              ),
            }))}
          />
        </div>
      ) : null}

      {/* Event mode: date + duration. Task mode has no time field — a task's
          due date is edited in the detail panel, not at capture time. */}
      {isTask ? null : (
      <div className="cal-qec__chips">
        <button
          type="button"
          className="cal-qec__chip"
          aria-expanded={showDate}
          aria-haspopup="dialog"
          /* No aria-label: it replaced the visible text entirely, so a screen
             reader heard 「选择日期」 and never the date itself (2.5.3 Label in
             Name). The visible text is the name; the icon is decorative. */
          disabled={busy}
          onClick={() => {
            setShowList(false);
            setShowDate((value) => !value);
          }}
        >
          <CalendarIcon size={14} />
          {formatFriendlyDate(date, today, null, lng)}
          <span className="cal-qec__chip-sep" aria-hidden="true">·</span>
          {rangeLabel}
          {crossesDay && !allDay ? (
            <span className="cal-qec__plusday" aria-hidden="true">+1</span>
          ) : null}
        </button>

        <span className="cal-qec__durations">
          {[30, 60, 120].map((m) => (
            <button
              key={m}
              type="button"
              className={`cal-qec__dur${duration === m && !allDay ? ' is-active' : ''}`}
              aria-pressed={duration === m && !allDay}
              disabled={busy}
              onClick={() => {
                setDuration(m);
                setAllDay(false);
              }}
            >
              {m >= 60 ? `${m / 60}h` : `${m}m`}
            </button>
          ))}
          <button
            type="button"
            className={`cal-qec__dur${allDay ? ' is-active' : ''}`}
            aria-pressed={allDay}
            disabled={busy}
            onClick={() => setAllDay((v) => !v)}
          >
            {t('event.allDay')}
          </button>
        </span>
      </div>
      )}

      <div className="cal-qec__foot">
        <button
          type="button"
          className="cal-qec__list"
          aria-expanded={showList}
          aria-haspopup="listbox"
          disabled={busy || lists.length === 0}
          onClick={() => {
            setShowDate(false);
            setShowList((v) => !v);
          }}
        >
          <span
            className="cal-qec__list-dot"
            style={{ background: lists.find((l) => l.id === listId)?.color ?? 'var(--tl-accent)' }}
            aria-hidden="true"
          />
          {lists.find((l) => l.id === listId)?.name ?? t('event.noList')}
        </button>

        <span className="cal-qec__spacer" />

        {/*
          The label follows the mode (添加 / 新建) and flips to 重试 after a
          failed write. `disabled` rather than `aria-disabled` because this is a
          plain submit button, not a toolbar control: it leaves the tab order
          while there is nothing to submit, which is what a user expects.
        */}
        <Button
          variant="primary"
          size="sm"
          className="cal-qec__add"
          data-capture-cta={mode}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void submit()}
          disabled={!canSubmit}
        >
          {busy
            ? t('event.saving')
            : error
              ? t('event.capture.retry')
              : isTask
                ? t('event.capture.addTask')
                : t('event.capture.createEvent')}
        </Button>
      </div>

      {showList ? (
        <div className="cal-qec__list-pop" role="listbox" aria-label={t('event.fields.list')}>
          {lists.map((l) => (
            <button
              key={l.id}
              type="button"
              role="option"
              aria-selected={l.id === listId}
              className={`cal-qec__list-item${l.id === listId ? ' is-active' : ''}`}
              onClick={() => {
                setListId(l.id);
                setShowList(false);
              }}
            >
              <span className="cal-qec__list-dot" style={{ background: l.color }} aria-hidden="true" />
              {l.name}
            </button>
          ))}
        </div>
      ) : null}

      {showDate ? (
        <div className="cal-qec__date">
          <div className="cal-qec__quick">
            <button
              type="button"
              className="cal-qec__preset"
              aria-pressed={date === today}
              onClick={() => pickDate(today)}
            >
              {tPickers('date.today')}
            </button>
            <button
              type="button"
              className="cal-qec__preset"
              aria-pressed={date === tomorrow}
              onClick={() => pickDate(tomorrow)}
            >
              {tPickers('date.tomorrow')}
            </button>
            <button
              type="button"
              className="cal-qec__preset"
              aria-pressed={date === monday}
              onClick={() => pickDate(monday)}
            >
              {tPickers('date.nextMonday')}
            </button>
            {/* No 「自定」 button. The month grid is already visible directly
                below this row, so a button that only moved focus into it did
                nothing a user could see — the review measured "no visual change
                after clicking". Removing it also removes the only control in
                this panel whose label did not match its behaviour. */}
          </div>

          <div className="cal-qec__cal">
            <div className="cal-qec__cal-head">
              <button
                type="button"
                className="cal-qec__cal-nav"
                aria-label={tPickers('date.prevMonth')}
                onClick={() => stepMonth(-1)}
              >
                <ChevronLeftIcon size={16} />
              </button>
              <span className="cal-qec__cal-label" aria-live="polite">
                {formatMonthHeading(viewMonth, lng)}
              </span>
              <button
                type="button"
                className="cal-qec__cal-nav"
                aria-label={tPickers('date.nextMonth')}
                onClick={() => stepMonth(1)}
              >
                <ChevronRightIcon size={16} />
              </button>
            </div>

            <div
              className="cal-qec__cal-grid"
              role="grid"
              aria-label={formatMonthHeading(viewMonth, lng)}
              onKeyDown={onGridKeyDown}
            >
              <div className="cal-qec__cal-week" role="row">
                {weekdays.map((name, index) => (
                  <span
                    key={index}
                    className="cal-qec__cal-weekday"
                    role="columnheader"
                    aria-label={weekdayLongNames[index] ?? name}
                  >
                    {name}
                  </span>
                ))}
              </div>
              {grid.weeks.map((week) => (
                <div className="cal-qec__cal-week" role="row" key={week[0]?.date}>
                  {week.map((cell) => {
                    const selected = cell.date === date;
                    const isToday = cell.date === today;
                    const classes = [
                      'cal-qec__cal-day',
                      cell.inMonth ? '' : 'cal-qec__cal-day--outside',
                      isToday ? 'cal-qec__cal-day--today' : '',
                      selected ? 'cal-qec__cal-day--selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <button
                        key={cell.date}
                        type="button"
                        role="gridcell"
                        data-date={cell.date}
                        tabIndex={cell.date === focusDate ? 0 : -1}
                        className={classes}
                        aria-selected={selected}
                        aria-current={isToday ? 'date' : undefined}
                        aria-label={formatDayLabel(cell.date, lng)}
                        disabled={busy}
                        onClick={() => pickDate(cell.date)}
                      >
                        {dayOf(cell.date)}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="cal-qec__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
