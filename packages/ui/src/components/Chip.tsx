export interface ChipProps {
  title: string;
  /** Preformatted time label, e.g. "8:00 - 9:00". */
  time?: string;
  /** Hue base color, e.g. "#5b8def". Used for the left rule. */
  color: string;
  /** Tint background; when omitted a translucent version of `color` is used. */
  tint?: string;
  done?: boolean;
  allDay?: boolean;
  onClick?: () => void;
}

/**
 * Calendar event chip. A container query hides the time label when the chip
 * gets too narrow, instead of letting the title collapse to one character.
 */
export function Chip({ title, time, color, tint, done = false, allDay = false, onClick }: ChipProps) {
  const style: Record<string, string> = { '--chip-color': color };
  if (tint) style['--chip-tint'] = tint;
  const interactive = typeof onClick === 'function';

  const content = (
    <>
      {allDay ? <span className="tl-chip__dot" aria-hidden="true" /> : null}
      <span className="tl-chip__title">{title}</span>
      {time ? <span className="tl-chip__time">{time}</span> : null}
    </>
  );

  const cls = `tl-chip${done ? ' tl-chip--done' : ''}${allDay ? ' tl-chip--allday' : ''}`;

  if (!interactive) {
    return (
      <span className={cls} style={style as never}>
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={cls}
      style={style as never}
      onClick={(event) => {
        // Chips usually sit inside a clickable container (a month cell that
        // opens the day). Opening the entry must not also trigger the parent.
        event.stopPropagation();
        onClick?.();
      }}
    >
      {content}
    </button>
  );
}
