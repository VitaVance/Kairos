import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LocalDate } from '@todolist/core';
import { addDays, instantAtLocal, todayLocal } from '@todolist/core';
import {
  Button,
  ChevronLeftIcon,
  ChevronRightIcon,
  isSubmitEnter,
  useTranslation,
} from '@todolist/ui';
import { useAppServices } from '../services';
import { buildMonthGrid } from './year-math';
import {
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
  onClose: () => void;
  /** Called after a successful write so the host can refetch. */
  onCreated?: () => void;
}

const DEFAULT_TIME = '09:00';
const DEFAULT_DURATION_MIN = 60;
/** Space kept between the panel and the click point / viewport edge. */
const PANEL_GAP = 8;
const VIEWPORT_EDGE = 8;

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
  onClose,
  onCreated,
}: QuickEventComposerProps) {
  const { t, i18n } = useTranslation('calendar');
  const { t: tPickers } = useTranslation('pickers');
  const lng = i18n.resolvedLanguage ?? i18n.language;
  const { events } = useAppServices();

  const panelRef = useRef<HTMLDivElement | null>(null);
  const fieldRef = useRef<HTMLInputElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  // Read the latest anchor through a ref so the focus-restore cleanup never
  // tears down on every parent re-render that hands in a fresh object.
  const anchorRef = useRef(anchor ?? null);
  anchorRef.current = anchor ?? null;
  const fieldId = useId();

  const today = todayProp ?? todayLocal();
  const time = timeProp ?? DEFAULT_TIME;

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
  const [listId, setListId] = useState<string | null>(lists[0]?.id ?? null);
  const [showList, setShowList] = useState(false);

  const weekdays = useMemo(() => weekdayShort(lng), [lng]);
  const weekdayLongNames = useMemo(() => weekdayLong(lng), [lng]);

  // Re-seed whenever the composer is pointed at a new slot (a second click on
  // the grid while it is already open).
  useEffect(() => {
    if (!open) return;
    setTitle('');
    setDate(dateProp);
    setShowDate(false);
    setViewMonth(monthKeyOf(dateProp));
    setBusy(false);
    setError(null);
    setDuration(DEFAULT_DURATION_MIN);
    setAllDay(false);
    setListId(lists[0]?.id ?? null);
    setShowList(false);
  }, [open, dateProp, timeProp, lists]);

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

  // Esc closes from anywhere in the panel (including the text field).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
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

  const titleEmpty = title.trim().length === 0;
  const tomorrow = addDays(today, 1);
  const monday = nextMonday(today);

  /** 自定: move focus into the visible month grid to pick a day directly. */
  function focusGrid() {
    const grid = panelRef.current?.querySelector<HTMLElement>('.cal-qec__cal-grid');
    const target =
      grid?.querySelector<HTMLButtonElement>('[aria-selected="true"]') ??
      grid?.querySelector<HTMLButtonElement>('.cal-qec__cal-day');
    target?.focus();
  }

  async function submit() {
    if (busy) return;
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setError(t('event.titleRequired'));
      fieldRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await events.create({
        title: trimmed,
        startAt: instantAtLocal(date, allDay ? '00:00' : time),
        endAt: instantAtLocal(slotEnd.date, allDay ? '00:00' : slotEnd.time),
        allDay,
        listId: (listId ?? null) as never,
      });
      // The host bumps the revision, so the grids refetch.
      onCreated?.();
      onClose();
    } catch (err: unknown) {
      // Every field survives a failed write — a rejected create must not cost
      // the user the sentence they just typed.
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  function pickDate(next: LocalDate) {
    setDate(next);
    setViewMonth(monthKeyOf(next));
  }

  function stepMonth(delta: number) {
    setViewMonth((prev) => shiftMonth(prev, delta));
  }

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className="cal-qec"
      role="dialog"
      aria-modal="false"
      aria-label={t('event.newTitle')}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <label className="tl-visually-hidden" htmlFor={fieldId}>
        {t('event.fields.title')}
      </label>
      <input
        ref={fieldRef}
        id={fieldId}
        className="cal-qec__title"
        value={title}
        placeholder={t('event.composerPlaceholder')}
        autoComplete="off"
        disabled={busy}
        onChange={(event) => {
          setTitle(event.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(event) => {
          // The IME's candidate-confirming Enter must not create the event.
          if (isSubmitEnter(event)) {
            event.preventDefault();
            void submit();
          }
        }}
      />

      <div className="cal-qec__chips">
        <button
          type="button"
          className="cal-qec__chip"
          aria-expanded={showDate}
          aria-label={t('event.quick.dateAria')}
          disabled={busy}
          onClick={() => {
            setShowList(false);
            setShowDate((value) => !value);
          }}
        >
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

        <Button
          variant="primary"
          size="sm"
          className="cal-qec__add"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void submit()}
          disabled={busy || titleEmpty}
        >
          {busy ? t('event.saving') : t('event.quick.add')}
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
            <button type="button" className="cal-qec__preset" onClick={focusGrid}>
              {t('event.quick.custom')}
            </button>
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

            <div className="cal-qec__cal-grid" role="grid" aria-label={formatMonthHeading(viewMonth, lng)}>
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
                        tabIndex={selected ? 0 : -1}
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
