import { useState } from 'react';
import { Button, TextField, useTranslation } from '@todolist/ui';

/**
 * The 8 curated list hues, mirrored from `--tl-hue-1-base … --tl-hue-8-base`
 * in @todolist/ui tokens. Stored as plain hex so the domain's `TaskList.color`
 * remains a portable value (the palette renders the same outside CSS vars).
 */
export const LIST_HUE_HEX = [
  '#5b8def',
  '#3aa88b',
  '#d99a3d',
  '#dd7366',
  '#8b79c9',
  '#c56d92',
  '#88a35c',
  '#4a9cc0',
] as const;

export const DEFAULT_LIST_COLOR: string = LIST_HUE_HEX[0];

export interface ListEditorValue {
  name: string;
  color: string;
}

export interface ListEditorProps {
  mode: 'create' | 'rename';
  initialName?: string;
  initialColor?: string;
  /** Mutating UI is disabled when the write port is unavailable. */
  disabled?: boolean;
  onSubmit: (value: ListEditorValue) => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Small inline form used for both "new list" and "rename". The color picker is
 * a radio group so the selection is keyboard-navigable and announced.
 */
export function ListEditor({
  mode,
  initialName = '',
  initialColor = DEFAULT_LIST_COLOR,
  disabled = false,
  onSubmit,
  onCancel,
}: ListEditorProps) {
  const { t } = useTranslation('lists');
  const { t: tCommon } = useTranslation('common');
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const saveDisabled = disabled || busy || trimmed.length === 0;

  async function submit() {
    if (saveDisabled) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ name: trimmed, color });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="list-editor"
      role="group"
      aria-label={mode === 'create' ? t('editor.groupCreate') : t('editor.groupRename')}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <TextField
        value={name}
        onChange={setName}
        onSubmit={() => void submit()}
        placeholder={mode === 'create' ? t('editor.placeholderCreate') : t('editor.placeholderRename')}
        label={mode === 'create' ? t('editor.labelCreate') : t('editor.labelRename')}
        disabled={disabled || busy}
        autoFocus
      />

      <div className="list-editor__swatches" role="radiogroup" aria-label={t('editor.colorGroup')}>
        {LIST_HUE_HEX.map((hue, i) => (
          <button
            key={hue}
            type="button"
            role="radio"
            aria-checked={color === hue}
            aria-label={t('sidebar.colorSwatch', { index: i + 1 })}
            title={t('sidebar.colorSwatch', { index: i + 1 })}
            className={`list-editor__swatch${color === hue ? ' list-editor__swatch--selected' : ''}`}
            style={{ background: hue }}
            disabled={disabled || busy}
            onClick={() => setColor(hue)}
          />
        ))}
      </div>

      {error ? (
        <p className="list-editor__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="list-editor__actions">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          {tCommon('buttons.cancel')}
        </Button>
        <Button variant="primary" size="sm" onClick={() => void submit()} disabled={saveDisabled}>
          {mode === 'create' ? t('editor.create') : tCommon('buttons.save')}
        </Button>
      </div>
    </div>
  );
}
