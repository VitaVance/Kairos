import type { KeyboardEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, ClockIcon, Popover, useTranslation } from '@todolist/ui';
import { trapTabKey } from './picker-nav';
import { formatClock, parseTimeInput, splitClock } from './picker-math';
import './pickers.css';

export interface TimePickerProps {
  /** Canonical `HH:MM` or null when unset. */
  value: string | null;
  onChange: (time: string) => void;
  disabled?: boolean;
  /** Accessible name of the trigger button. */
  label: string;
  /** Placeholder shown when `value` is null. */
  placeholder?: string;
  /** Extra class on the trigger button. */
  className?: string;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

/**
 * Compact 24-hour time field. The popover pairs a scrollable hour column with
 * a 5-minute step column; exact minutes can be typed into the field.
 *
 * Keyboard:
 *   ↑/↓ Home End   move focus within the focused column
 *   Enter          in the text field: parse + commit
 *   Escape         close (handled by Popover)
 *   Tab            trapped inside the popover
 */
export function TimePicker({
  value,
  onChange,
  disabled = false,
  label,
  placeholder,
  className = '',
}: TimePickerProps) {
  const { t } = useTranslation('pickers');
  const displayPlaceholder = placeholder ?? t('time.placeholder');
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const hourListRef = useRef<HTMLDivElement | null>(null);
  const minuteListRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => splitClock(value));
  const [text, setText] = useState(value ?? '');
  const [invalid, setInvalid] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    setDraft(splitClock(value));
    setText(value ?? '');
    setInvalid(false);
  }, [open, value]);

  // Bring the active hour/minute into view when the popover opens.
  useEffect(() => {
    if (!open) return;
    hourListRef.current
      ?.querySelector<HTMLElement>('[aria-pressed="true"]')
      ?.scrollIntoView({ block: 'center' });
    minuteListRef.current
      ?.querySelector<HTMLElement>('[aria-pressed="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, value, draft.hours, draft.minutes]);

  const commit = (time: string) => {
    setOpen(false);
    onChange(time);
  };

  const commitDraft = () => {
    // Empty text means "use the columns"; otherwise the typed value must parse.
    if (text.trim() === '') {
      commit(formatClock(draft.hours, draft.minutes));
      return;
    }
    const parsed = parseTimeInput(text);
    if (parsed === null) {
      setInvalid(true);
      return;
    }
    commit(parsed);
  };

  const onTextSubmit = () => {
    const parsed = parseTimeInput(text);
    if (parsed === null) {
      setInvalid(true);
      return;
    }
    commit(parsed);
  };

  const pickHour = (hour: number) => {
    setDraft((prev) => ({ ...prev, hours: hour }));
    setText(formatClock(hour, draft.minutes));
    setInvalid(false);
    // Let the user continue into minutes without a second click.
    minuteListRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  };

  const pickMinute = (minute: number) => {
    setDraft((prev) => ({ ...prev, minutes: minute }));
    setText(formatClock(draft.hours, minute));
    setInvalid(false);
  };

  const columnKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const { key } = event;
    if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Home' && key !== 'End') return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
    if (buttons.length === 0) return;
    const current = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
    let next = current;
    if (key === 'ArrowDown') next = Math.min(buttons.length - 1, current + 1);
    else if (key === 'ArrowUp') next = Math.max(0, current - 1);
    else if (key === 'Home') next = 0;
    else next = buttons.length - 1;
    event.preventDefault();
    buttons[next]?.focus();
  };

  const triggerText = value ?? displayPlaceholder;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`tk-picker-trigger${value === null ? ' tk-picker-trigger--empty' : ''} ${className}`.trim()}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <ClockIcon size={14} />
        <span className="tk-picker-trigger__text tk-picker-trigger__text--tabular">{triggerText}</span>
      </button>

      <Popover open={open} onClose={close} anchorRef={triggerRef} width={228}>
        <div className="tk-time" onKeyDown={trapTabKey}>
          <div className={`tk-time__input${invalid ? ' tk-time__input--invalid' : ''}`}>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              aria-label={t('time.inputAria')}
              aria-invalid={invalid}
              placeholder="HH:MM"
              className="tk-time__field"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setInvalid(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onTextSubmit();
                } else if (e.key === 'Escape') {
                  e.currentTarget.blur();
                }
              }}
            />
            <span className="tk-time__suffix">{t('time.hourFormat')}</span>
          </div>

          <div className="tk-time__cols">
            <div
              ref={hourListRef}
              className="tk-time__col tl-scroll tl-scroll--y"
              role="group"
              aria-label={t('time.hours')}
              onKeyDown={columnKeyDown}
            >
              {HOURS.map((hour) => (
                <button
                  key={hour}
                  type="button"
                  className={`tk-time__cell${draft.hours === hour ? ' tk-time__cell--active' : ''}`}
                  aria-pressed={draft.hours === hour}
                  onClick={() => pickHour(hour)}
                >
                  {String(hour).padStart(2, '0')}
                </button>
              ))}
            </div>
            <div
              ref={minuteListRef}
              className="tk-time__col tl-scroll tl-scroll--y"
              role="group"
              aria-label={t('time.minutes')}
              onKeyDown={columnKeyDown}
            >
              {MINUTES.map((minute) => (
                <button
                  key={minute}
                  type="button"
                  className={`tk-time__cell${draft.minutes === minute ? ' tk-time__cell--active' : ''}`}
                  aria-pressed={draft.minutes === minute}
                  onClick={() => pickMinute(minute)}
                >
                  {String(minute).padStart(2, '0')}
                </button>
              ))}
            </div>
          </div>

          <div className="tk-time__foot">
            <Button variant="ghost" size="sm" onClick={() => commit('09:00')}>
              {t('time.reset')}
            </Button>
            <Button variant="primary" size="sm" onClick={commitDraft}>
              {t('time.confirm')}
            </Button>
          </div>
        </div>
      </Popover>
    </>
  );
}
