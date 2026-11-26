import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  CalendarEntry,
  EventId,
  EventService,
  Instant,
  ListId,
  LocalDate,
  NewEvent,
} from '@todolist/core';
import { addDays, todayLocal } from '@todolist/core';
import { Button, Checkbox, IconButton, useTranslation } from '@todolist/ui';
import { useAppServices, useLists } from '../services';
import { DatePicker } from '../pickers/DatePicker';
import { TimePicker } from '../pickers/TimePicker';
import { formatMinutes, minutesOfDay } from './time-math';
import './calendar.css';
// The shared destructive-confirmation surface lives beside its styles; import
// it here so the confirmation renders correctly even if the data panel was
// never mounted.
import '../data/data-transfer.css';
import { DestructiveConfirm } from '../data/DestructiveConfirm';

export interface EventEditorProps {
  open: boolean;
  /** Day the dialog opens on when creating. Falls back to today. */
  defaultDate?: LocalDate;
  /** Initial start time "HH:MM" when creating from a time-grid click. */
  defaultStart?: string;
  /**
   * Initial end time "HH:MM" when creating from a drag selection. When omitted
   * the end defaults to one hour after `defaultStart`.
   */
  defaultEnd?: string;
  /** When provided, the dialog edits this entry instead of creating a new one. */
  entry?: CalendarEntry | null;
  onClose: () => void;
}

const DEFAULT_START = '09:00';
const DEFAULT_DURATION_MIN = 60;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

/**
 * Local wall-clock → UTC instant. `new Date(y, m, d, h, min)` interprets the
 * components in the machine zone (the same zone `APP_TIME_ZONE` resolves to and
 * `localDateOf` reads back) and resolves DST for local wall clock, so no
 * hand-built ISO string is required here.
 */
function toInstant(date: LocalDate, time: string): Instant | null {
  const dm = DATE_RE.exec(date);
  const tm = TIME_RE.exec(time);
  if (!dm || !tm) return null;
  const year = Number(dm[1]);
  const month = Number(dm[2]);
  const day = Number(dm[3]);
  const hour = Number(tm[1]);
  const minute = Number(tm[2]);
  if (hour > 23 || minute > 59) return null;
  const at = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(at.getTime())) return null;
  return at.toISOString() as Instant;
}

/** Split an instant into the local date + "HH:MM" the form edits. */
function splitInstant(instant: Instant): { date: LocalDate; time: string } {
  return { date: localDateOfInstant(instant), time: formatMinutes(minutesOfDay(instant)) };
}

/** Local date of an instant, without importing Temporal helpers into a memo. */
function localDateOfInstant(instant: Instant): LocalDate {
  const pad = (n: number) => String(n).padStart(2, '0');
  const d = new Date(instant);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` as LocalDate;
}

/** Add minutes to a local date+time, letting the Date constructor roll days. */
function addMinutes(
  date: LocalDate,
  time: string,
  minutes: number,
): { date: LocalDate; time: string } | null {
  const dm = DATE_RE.exec(date);
  const tm = TIME_RE.exec(time);
  if (!dm || !tm) return null;
  const at = new Date(
    Number(dm[1]),
    Number(dm[2]) - 1,
    Number(dm[3]),
    Number(tm[1]),
    Number(tm[2]) + minutes,
    0,
    0,
  );
  if (Number.isNaN(at.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` as LocalDate,
    time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
  };
}

interface Draft {
  title: string;
  startDate: LocalDate;
  startTime: string;
  endDate: LocalDate;
  endTime: string;
  allDay: boolean;
  listId: string;
  notes: string;
}

/**
 * Create/edit dialog for a calendar event.
 *
 * Writes go through `AppServices.events` (EventService) — CalendarService is
 * deliberately read-only. When the events service is absent the form renders
 * disabled with an explanatory note instead of inventing a write path.
 *
 * Keyboard: the native `<dialog>` gives Esc-to-close and focus trapping.
 * Drag-to-reschedule (WeekView) has no arrow-key equivalent yet — nudging a
 * focused block with the keyboard is a deliberate follow-up, out of scope here.
 */
export function EventEditor({
  open,
  defaultDate,
  defaultStart,
  defaultEnd,
  entry,
  onClose,
}: EventEditorProps) {
  const { events: eventsService } = useAppServices();
  const { t } = useTranslation('calendar');
  // Shared buttons live in `common`; a namespace-scoped `t` cannot reach them
  // through a `common:` prefix (that form is untyped), so bind it separately.
  const { t: tCommon } = useTranslation('common');
  // Live lists: a list created after launch must be selectable here.
  const lists = useLists();
  const events: EventService | null = (eventsService as EventService | null | undefined) ?? null;

  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const headingId = useId();
  const titleId = useId();

  const isEditing = entry !== null && entry !== undefined;
  const canEditEntry = !isEditing || entry?.source === 'event';
  const firstListId = lists[0]?.id ?? '';

  // Seed keyed only on stable primitives so a parent re-render cannot reset an
  // in-progress form. The open effect below applies it.
  const seed = useMemo<Draft>(() => {
    if (entry) {
      const start = splitInstant(entry.startAt);
      const end = splitInstant(entry.endAt);
      return {
        title: entry.title,
        startDate: start.date,
        startTime: entry.allDay ? DEFAULT_START : start.time,
        endDate: end.date,
        endTime: entry.allDay ? DEFAULT_START : end.time,
        allDay: entry.allDay,
        // CalendarEntry carries no listId/notes; editing shows the neutral value
        // and leaves the stored fields untouched (see the update patch below).
        listId: '',
        notes: '',
      };
    }
    const date = defaultDate ?? todayLocal();
    const start = defaultStart ?? DEFAULT_START;
    // A drag selection supplies both ends; otherwise default to one hour. If the
    // given end is empty, malformed, or not after the start, fall back so the
    // form never opens on an invalid range.
    const explicitEnd = defaultEnd ? addMinutes(date, defaultEnd, 0) : null;
    const startAt = toInstant(date, start);
    const explicitEndAt = explicitEnd ? toInstant(explicitEnd.date, explicitEnd.time) : null;
    const validExplicitEnd =
      explicitEnd !== null &&
      explicitEndAt !== null &&
      startAt !== null &&
      Date.parse(explicitEndAt) > Date.parse(startAt);
    const end = validExplicitEnd
      ? explicitEnd
      : (addMinutes(date, start, DEFAULT_DURATION_MIN) ?? { date, time: start });
    return {
      title: '',
      startDate: date,
      startTime: start,
      endDate: end.date,
      endTime: end.time,
      allDay: false,
      listId: firstListId,
      notes: '',
    };
  }, [entry, defaultDate, defaultStart, defaultEnd, firstListId]);

  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState<LocalDate>(defaultDate ?? todayLocal());
  const [startTime, setStartTime] = useState(DEFAULT_START);
  const [endDate, setEndDate] = useState<LocalDate>(defaultDate ?? todayLocal());
  const [endTime, setEndTime] = useState(DEFAULT_START);
  const [allDay, setAllDay] = useState(false);
  const [listId, setListId] = useState(firstListId);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touchedSubmit, setTouchedSubmit] = useState(false);
  /** A destructive action that needs one confirmation step. */
  const [confirm, setConfirm] = useState<'discard' | 'delete' | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(seed.title);
    setStartDate(seed.startDate);
    setStartTime(seed.startTime);
    setEndDate(seed.endDate);
    setEndTime(seed.endTime);
    setAllDay(seed.allDay);
    setListId(seed.listId);
    setNotes(seed.notes);
    setError(null);
    setBusy(false);
    setTouchedSubmit(false);
    setConfirm(null);
  }, [open, seed]);

  // Unsaved edits are detected against the same seed the form was populated
  // from, so the close guard never fires on an untouched form.
  const dirty =
    title !== seed.title ||
    startDate !== seed.startDate ||
    startTime !== seed.startTime ||
    endDate !== seed.endDate ||
    endTime !== seed.endTime ||
    allDay !== seed.allDay ||
    listId !== seed.listId ||
    notes !== seed.notes;

  /** Close, but ask first when there is unsaved work. */
  function requestClose() {
    if (busy) return;
    if (dirty) setConfirm('discard');
    else onClose();
  }

  // Drive the native dialog imperatively — never render the `open` attribute.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
      // The title is the composer's hero, so it is the element that takes
      // focus (and seeds typing) the moment the dialog appears.
      dialog.querySelector<HTMLInputElement>('.cal-composer__title')?.focus();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  const effectiveStart = allDay ? '00:00' : startTime;
  const effectiveEnd = allDay ? '00:00' : endTime;
  const startInstant = toInstant(startDate, effectiveStart);
  const endInstant = toInstant(endDate, effectiveEnd);
  const incomplete = startInstant === null || endInstant === null;
  const rangeInvalid =
    startInstant !== null && endInstant !== null && Date.parse(endInstant) <= Date.parse(startInstant);
  const rangeError = rangeInvalid ? t('event.rangeError') : null;
  const saveDisabled = events === null || busy || !canEditEntry || incomplete || rangeInvalid;

  function toggleAllDay(next: boolean) {
    setAllDay(next);
    if (next && endDate <= startDate) {
      // All-day ranges are exclusive on the end boundary; same-day would be a
      // zero-length span, so push the end to the next day.
      setEndDate(addDays(startDate, 1));
    }
  }

  async function save() {
    setTouchedSubmit(true);
    if (events === null) return;
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setError(t('event.titleRequired'));
      return;
    }
    if (startInstant === null || endInstant === null) {
      setError(t('event.incomplete'));
      return;
    }
    if (Date.parse(endInstant) <= Date.parse(startInstant)) {
      setError(t('event.rangeError'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (isEditing && entry && entry.source === 'event') {
        // Only patch what the entry exposes: listId/notes are not on
        // CalendarEntry, so sending them would clobber stored values.
        await events.update(entry.id as EventId, {
          title: trimmed,
          startAt: startInstant,
          endAt: endInstant,
          allDay,
        });
      } else {
        const input: NewEvent = {
          title: trimmed,
          startAt: startInstant,
          endAt: endInstant,
          allDay,
          listId: listId === '' ? null : (listId as ListId),
          notes,
        };
        await events.create(input);
      }
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (events === null || !entry || entry.source !== 'event') return;
    setBusy(true);
    setError(null);
    try {
      await events.remove(entry.id as EventId);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="cal-dialog"
      aria-labelledby={headingId}
      onCancel={(e) => {
        // Esc: close through the parent so `open` stays the single source of truth.
        // Mid-confirmation, Esc backs out one level instead of discarding everything.
        e.preventDefault();
        if (confirm) {
          setConfirm(null);
          return;
        }
        requestClose();
      }}
      onClick={(e) => {
        // Native dialogs do not close on backdrop click; a click whose target is
        // the dialog element itself (not a descendant) means the backdrop was hit.
        if (e.target === e.currentTarget && !confirm) requestClose();
      }}
    >
      <div className="cal-form">
        <header className="cal-form__head">
          <h2 className="cal-form__title" id={headingId}>
            {isEditing ? t('event.editTitle') : t('event.newTitle')}
          </h2>
          <IconButton
            variant="quiet"
            label={tCommon('buttons.close')}
            className="cal-form__close"
            onClick={requestClose}
            disabled={busy}
          >
            <span aria-hidden="true">✕</span>
          </IconButton>
        </header>

        {events === null ? (
          <p className="cal-note" role="status">
            {t('event.noWriteService')}
          </p>
        ) : null}

        {!canEditEntry ? (
          <p className="cal-note" role="status">
            {t('event.taskEntryReadonly')}
          </p>
        ) : null}

        <div className="cal-composer">
          <label className="tl-visually-hidden" htmlFor={titleId}>
            {t('event.fields.title')}
          </label>
          <input
            id={titleId}
            className="cal-composer__title"
            value={title}
            placeholder={t('event.composerPlaceholder')}
            autoComplete="off"
            disabled={events === null || !canEditEntry || busy}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="cal-when">
          <div className="cal-when__fields">
            <DatePicker
              value={startDate}
              onChange={setStartDate}
              disabled={events === null || !canEditEntry || busy}
              label={t('event.fields.startDate')}
            />
            <TimePicker
              value={startTime}
              onChange={setStartTime}
              disabled={events === null || !canEditEntry || allDay || busy}
              label={t('event.fields.startTime')}
            />
            <span className="cal-when__dash" aria-hidden="true">
              –
            </span>
            <DatePicker
              value={endDate}
              onChange={setEndDate}
              disabled={events === null || !canEditEntry || busy}
              label={allDay ? t('event.fields.endDateExclusive') : t('event.fields.endDate')}
            />
            <TimePicker
              value={endTime}
              onChange={setEndTime}
              disabled={events === null || !canEditEntry || allDay || busy}
              label={t('event.fields.endTime')}
            />
          </div>
          <label className="cal-switch">
            <Checkbox
              checked={allDay}
              disabled={events === null || !canEditEntry || busy}
              onChange={toggleAllDay}
              aria-label={t('event.allDay')}
            />
            <span className="cal-switch__label">{t('event.allDay')}</span>
          </label>
        </div>

        <div className="cal-meta">
          <label className="cal-field">
            <span className="cal-field__label">{t('event.fields.list')}</span>
            {/*
              Native <select> kept for semantics and keyboard support; a branded
              surface is layered on with `appearance: base-select` + `::picker(select)`
              in calendar.css (`.cal-select`). Browsers without base-select fall
              back to their own dropdown — no JS listbox to maintain.
            */}
            <select
              className="cal-input cal-select tl-select"
              value={listId}
              disabled={events === null || !canEditEntry || isEditing || busy}
              onChange={(e) => setListId(e.target.value)}
            >
              <option value="">{t('event.noList')}</option>
              {lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
          </label>

          <label className="cal-field">
            <span className="cal-field__label">{t('event.fields.notes')}</span>
            <textarea
              className="cal-input cal-input--area"
              aria-label={t('event.fields.notes')}
              rows={2}
              value={notes}
              placeholder={t('event.notesPlaceholder')}
              disabled={events === null || !canEditEntry || isEditing || busy}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </div>

        {rangeError ? (
          <p className="cal-error" role="alert">
            {rangeError}
          </p>
        ) : null}

        {touchedSubmit && incomplete ? (
          <p className="cal-error" role="alert">
            {t('event.incomplete')}
          </p>
        ) : null}

        {error ? (
          <p className="cal-error" role="alert">
            {error}
          </p>
        ) : null}

        {/* Destructive confirmations use the shared shape (DESIGN-LANGUAGE
            §5.4): a modal `<dialog>`, focus on the safe action, and a 600ms arm
            delay. This used to be an inline `role="alertdialog"` stacked inside
            this already-open dialog: focus never moved into it and a held
            Enter could delete in one gesture. As a nested native modal it is
            inert to the editor behind it; Esc closes it, which mirrors `null`
            back into `confirm` (the `close` path in DestructiveConfirm). */}
        <DestructiveConfirm
          open={confirm !== null}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            // Clear the confirmation *before* the action closes the editor.
            // `remove()`/`onClose()` close the parent dialog; if `confirm` were
            // still set, this nested modal would stay `showModal()` over a
            // closed editor — the app inert behind an invisible dialog, the
            // same shape as UI-AUDIT P0-4.
            setConfirm(null);
            if (confirm === 'delete') void remove();
            else if (confirm === 'discard') onClose();
          }}
          title={
            confirm === 'delete' ? t('event.confirmDeleteLabel') : t('event.confirmDiscardLabel')
          }
          body={
            confirm === 'delete' ? t('event.confirmDeleteMessage') : t('event.confirmDiscardMessage')
          }
          confirmLabel={confirm === 'delete' ? tCommon('buttons.delete') : t('event.discard')}
          cancelLabel={t('event.back')}
          busy={busy}
        />

        {confirm ? null : (
          <div className="cal-actions">
            {isEditing && entry?.source === 'event' ? (
              <Button
                variant="ghost"
                className="cal-actions__delete"
                onClick={() => setConfirm('delete')}
                disabled={busy}
              >
                {tCommon('buttons.delete')}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={requestClose} disabled={busy}>
              {tCommon('buttons.cancel')}
            </Button>
            <Button variant="primary" onClick={() => void save()} disabled={saveDisabled}>
              {busy ? t('event.saving') : tCommon('buttons.save')}
            </Button>
          </div>
        )}
      </div>
    </dialog>
  );
}
