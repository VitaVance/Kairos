export interface BadgeProps {
  label: string;
  color: string;
  /** 'dot' (default) for headers, 'solid' for count pills. */
  variant?: 'dot' | 'solid';
  count?: number;
}

export function Badge({ label, color, variant = 'dot', count }: BadgeProps) {
  const style = { '--badge-color': color };
  if (variant === 'solid') {
    return (
      <span className="tl-badge tl-badge--solid" style={style as never}>
        {label}
        {typeof count === 'number' ? <span className="tl-badge__count">{count}</span> : null}
      </span>
    );
  }
  return (
    <span className="tl-badge" style={style as never}>
      <span className="tl-badge__dot" aria-hidden="true" />
      <span className="tl-badge__label">{label}</span>
      {typeof count === 'number' ? <span className="tl-badge__count">{count}</span> : null}
    </span>
  );
}
