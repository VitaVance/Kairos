import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import './data-transfer.css';
import type { DragEvent } from 'react';
import { useTranslation } from '@todolist/ui';
import type { AppServices } from '../services';
import { useAppServices, useLists, useRevision } from '../services';
import { useUndoOptional } from '../undo/UndoProvider';
import type { BackupData, BackupFile, MergeMode } from './export-import';
import {
  exportTasksToCsv,
  exportToJson,
  parseImport,
  planMerge,
  serializeBackup,
} from './export-import';

/**
 * Settings-style data transfer panel: export a backup, import one back.
 *
 * Presentation + orchestration only. It never touches storage: it reads the
 * current dataset and writes imports through the services context, which the
 * shell wires to concrete adapters. When `onApply` is absent the import can
 * still be previewed, but the apply buttons stay disabled and say why.
 *
 * The host-provided `onApply` receives the imported dataset and the chosen
 * mode. An implementation may ignore the second argument — a one-parameter
 * `(data) => Promise<void>` is assignable and means "merge by default".
 */
export interface DataTransferPanelProps {
  open: boolean;
  onClose: () => void;
  /**
   * Persists an imported dataset. Omitted/null means the write port is not
   * wired yet — the UI then refuses to apply rather than pretend.
   */
  onApply?: ((data: BackupData, mode: MergeMode) => Promise<void>) | null;
  /**
   * Deletes every task, list and event. Omitted/null means the write port is
   * not wired yet, and the destructive control is not offered at all: a button
   * that looks like it works is worse than no button.
   */
  onReset?: (() => Promise<void>) | null;
}

type ImportPhase =
  | { readonly kind: 'empty' }
  | { readonly kind: 'invalid'; readonly fileName: string; readonly errors: readonly string[] }
  | { readonly kind: 'valid'; readonly fileName: string; readonly file: BackupFile };

/** 12.3 KB / 1.4 MB — enough precision to judge a backup at a glance. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timestampSlug(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(
    date.getMinutes(),
  )}`;
}

/** Default JSON backup file name, exposed for hosts and tests. */
export function exportFileName(date: Date): string {
  return `todolist-backup-${timestampSlug(date)}.json`;
}

/** The `misc` translator, inferred from the hook so no i18next type import is needed. */
export type MiscT = ReturnType<typeof useTranslation<'misc'>>['t'];

/**
 * The reset copy, in one place.
 *
 * The button deletes *everything*, not just the seeded rows: after the user has
 * edited a seeded row there is no reliable way to tell it apart from their own
 * content. The wording therefore says "everything" and never "sample data" — a
 * destructive action must be described as what it does. The catalog text is
 * safety-critical; do not soften it while translating.
 */
export function resetCopy(t: MiscT) {
  return {
    heading: t('data.reset.heading'),
    hint: t('data.reset.hint'),
    trigger: t('data.reset.trigger'),
    confirm: t('data.reset.confirm'),
    confirmAction: t('data.reset.confirmAction'),
    busy: t('data.reset.busy'),
    alertLabel: t('data.reset.alertLabel'),
  };
}

/** "About to delete: 17 tasks · 4 lists · 12 events…" for the confirmation body. */
export function resetLossLine(
  t: MiscT,
  counts: { tasks: number; lists: number; events: number },
): string {
  return t('data.reset.loss', {
    tasks: t('data.count.tasks', { count: counts.tasks }),
    lists: t('data.count.lists', { count: counts.lists }),
    events: t('data.count.events', { count: counts.events }),
  });
}

// ---------------------------------------------------------------------------
// Live dataset
// ---------------------------------------------------------------------------

/** The three collections an export serializes. */
export type ExportSource = Pick<BackupData, 'tasks' | 'lists' | 'events'>;

/**
 * Reads the current dataset from the services context. Tasks and lists come
 * from their read services; events are fetched over the widest representable
 * range (all events, regardless of schedule). Re-runs when the revision bumps.
 */
function useExportSource(): ExportSource | null {
  const services = useAppServices();
  const revision = useRevision();
  // Live lists, not the boot-time snapshot: a list created after launch must
  // appear in the backup or the restored file has tasks pointing at nothing.
  const liveLists = useLists();
  const [source, setSource] = useState<ExportSource | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [tasks, events] = await Promise.all([
        readTasks(services),
        readAllEvents(services),
      ]);
      if (!alive) return;
      setSource({ tasks, lists: liveLists, events });
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, revision, liveLists]);

  return source;
}

async function readTasks(services: AppServices): Promise<BackupData['tasks']> {
  return services.tasks.listAll();
}

/** Widest window we can ask for; `EventService.listBetween` is half-open. */
async function readAllEvents(services: AppServices): Promise<BackupData['events']> {
  const from = '0001-01-01T00:00:00.000Z' as BackupFile['exportedAt'];
  const to = '9999-12-31T23:59:59.999Z' as BackupFile['exportedAt'];
  return services.events.listBetween(from, to);
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function DataTransferPanel({ open, onClose, onApply, onReset }: DataTransferPanelProps) {
  const { t } = useTranslation('misc');
  const panelId = useId();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [phase, setPhase] = useState<ImportPhase>({ kind: 'empty' });
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmMode, setConfirmMode] = useState<MergeMode | null>(null);
  /** Two-step confirm for the destructive reset, like `TaskDetailPanel`. */
  const [confirmReset, setConfirmReset] = useState(false);

  const [exportPreview, setExportPreview] = useState<{
    readonly fileName: string;
    readonly bytes: number;
    readonly json: string;
    readonly csv: string;
    readonly counts: { tasks: number; lists: number; events: number };
  } | null>(null);

  const exportData = useExportSource();
  const writable = typeof onApply === 'function';
  // A `replace` import changes the identity of every stored row, so any undo
  // closure captured before it would now address rows that no longer exist
  // (or resurrect deleted ones). Drop the stack after a replace.
  const undoStack = useUndoOptional();

  // Escape closes; focus lands on the close button when opened.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const resetImport = useCallback(() => {
    setPhase({ kind: 'empty' });
    setConfirmMode(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const readFile = useCallback(async (file: File) => {
    setError(null);
    setConfirmMode(null);
    setStatus(t('data.status.parsing', { file: file.name }));

    let text: string;
    try {
      text = await file.text();
    } catch {
      setPhase({ kind: 'invalid', fileName: file.name, errors: [t('data.errors.cannotRead')] });
      setStatus(t('data.status.readFailed', { file: file.name }));
      return;
    }

    const result = parseImport(text);
    if (!result.ok) {
      setPhase({ kind: 'invalid', fileName: file.name, errors: result.errors });
      setStatus(t('data.status.invalid', { file: file.name, count: result.errors.length }));
      return;
    }

    // Rebuild a canonical envelope so the preview and the eventual apply share
    // one validated shape.
    const rebuilt = exportToJson(result.data, { exportedAt: new Date().toISOString() as BackupFile['exportedAt'] });
    setPhase({ kind: 'valid', fileName: file.name, file: rebuilt });
    setStatus(
      t('data.status.valid', {
        file: file.name,
        tasks: t('data.count.tasks', { count: result.data.tasks.length }),
        lists: t('data.count.lists', { count: result.data.lists.length }),
        events: t('data.count.events', { count: result.data.events.length }),
      }),
    );
  }, [t]);

  const onFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) void readFile(file);
    },
    [readFile],
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragActive(false);
      onFiles(e.dataTransfer.files);
    },
    [onFiles],
  );

  // Build the export preview whenever the panel opens with data available.
  useEffect(() => {
    if (!open || !exportData) {
      if (!open) setExportPreview(null);
      return;
    }
    const exportedAt = new Date().toISOString() as BackupFile['exportedAt'];
    const file = exportToJson(exportData, { exportedAt });
    const json = serializeBackup(file);
    setExportPreview({
      fileName: exportFileName(new Date()),
      bytes: new TextEncoder().encode(json).length,
      json,
      csv: exportTasksToCsv(exportData.tasks, exportData.lists),
      counts: {
        tasks: exportData.tasks.length,
        lists: exportData.lists.length,
        events: exportData.events.length,
      },
    });
  }, [open, exportData]);

  const download = useCallback((content: string, fileName: string, mime: string) => {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setStatus(t('data.status.exported', { file: fileName, size: formatBytes(blob.size) }));
    } finally {
      // Revoking synchronously can race the click in some engines; defer one loop.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }, [t]);

  const downloadJson = useCallback(() => {
    if (exportPreview) download(exportPreview.json, exportPreview.fileName, 'application/json');
  }, [download, exportPreview]);

  const downloadCsv = useCallback(() => {
    if (!exportPreview) return;
    download(exportPreview.csv, exportPreview.fileName.replace(/\.json$/, '.csv'), 'text/csv');
  }, [download, exportPreview]);

  const plan = useMemo(() => {
    if (phase.kind !== 'valid' || !exportData) return null;
    return {
      replace: planMerge(exportData, phase.file.data, 'replace'),
      merge: planMerge(exportData, phase.file.data, 'merge'),
    };
  }, [phase, exportData]);

  /**
   * The imported list ids are about to be written while the current dataset is
   * being dropped in `replace` mode. The applier validates the payload against
   * itself, not against what is already stored, so a completed task that
   * vanished in the backup would be REMOVED by `replace`. Warn before that
   * becomes a surprise rather than after.
   */
  const discardWarning = useMemo(() => {
    if (phase.kind !== 'valid' || !exportData) return null;
    const imported = new Set(phase.file.data.tasks.map((t) => t.id));
    const lost = exportData.tasks.filter((t) => !imported.has(t.id));
    if (lost.length === 0) return null;
    const done = lost.filter((t) => t.status === 'done').length;
    return { lost: lost.length, done };
  }, [phase, exportData]);

  const apply = useCallback(
    async (mode: MergeMode) => {
      if (!writable || !onApply || phase.kind !== 'valid') return;
      setBusy(true);
      setError(null);
      try {
        await onApply(phase.file.data, mode);
        if (mode === 'replace') undoStack?.clear();
        setStatus(mode === 'replace' ? t('data.status.replaceDone') : t('data.status.mergeDone'));
        resetImport();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [writable, onApply, phase, onClose, resetImport, undoStack, t],
  );

  const resetAll = useCallback(async () => {
    if (!onReset) return;
    setBusy(true);
    setError(null);
    try {
      await onReset();
      // Every row the stack pointed at is gone; replaying a closure would
      // resurrect content the user just asked to delete.
      undoStack?.clear();
      setStatus(t('data.status.resetDone'));
      resetImport();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConfirmReset(false);
    } finally {
      setBusy(false);
    }
  }, [onReset, onClose, resetImport, undoStack, t]);

  if (!open) return null;

  const copy = resetCopy(t);
  const importCounts =
    phase.kind === 'valid'
      ? {
          tasks: phase.file.data.tasks.length,
          lists: phase.file.data.lists.length,
          events: phase.file.data.events.length,
        }
      : null;

  return (
    <div
      className="dt-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section id={panelId} className="dt-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="dt-panel__head">
          <h2 id={titleId} className="dt-panel__title">
            {t('data.title')}
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="dt-close"
            aria-label={t('buttons.close', { ns: 'common' })}
            onClick={onClose}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </header>

        {/* ------------------------------- Export ------------------------ */}
        <section className="dt-section" aria-labelledby={`${panelId}-export-label`}>
          <h3 id={`${panelId}-export-label`} className="dt-section__title">
            {t('data.export.heading')}
          </h3>
          <p className="dt-section__hint">{t('data.export.hint')}</p>

          {exportPreview ? (
            <div className="dt-export">
              <dl className="dt-export__meta">
                <div className="dt-export__row">
                  <dt>{t('data.export.fileName')}</dt>
                  <dd className="dt-mono">{exportPreview.fileName}</dd>
                </div>
                <div className="dt-export__row">
                  <dt>{t('data.export.size')}</dt>
                  <dd>{formatBytes(exportPreview.bytes)}</dd>
                </div>
                <div className="dt-export__row">
                  <dt>{t('data.export.content')}</dt>
                  <dd>
                    {t('data.count.tasks', { count: exportPreview.counts.tasks })} ·{' '}
                    {t('data.count.lists', { count: exportPreview.counts.lists })} ·{' '}
                    {t('data.count.events', { count: exportPreview.counts.events })}
                  </dd>
                </div>
              </dl>
              <div className="dt-actions">
                <button type="button" className="dt-btn dt-btn--primary" onClick={downloadJson}>
                  {t('data.export.json')}
                </button>
                <button type="button" className="dt-btn" onClick={downloadCsv}>
                  {t('data.export.csv')}
                </button>
              </div>
            </div>
          ) : (
            <p className="dt-empty">{t('data.export.empty')}</p>
          )}
        </section>

        {/* ------------------------------- Import ------------------------ */}
        <section className="dt-section" aria-labelledby={`${panelId}-import-label`}>
          <h3 id={`${panelId}-import-label`} className="dt-section__title">
            {t('data.import.heading')}
          </h3>

          <div
            className={`dt-drop${dragActive ? ' dt-drop--active' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
          >
            <span className="dt-drop__icon" aria-hidden="true">
              ⤓
            </span>
            <span className="dt-drop__title">{t('data.import.dropTitle')}</span>
            <span id={`${panelId}-drop-hint`} className="dt-drop__hint">
              {t('data.import.dropHint')}
            </span>
            {/*
              A real file input, kept visible and styled through
              `::file-selector-button` rather than hidden behind a fake
              button: the native control keeps OS-level keyboard, IME and
              assistive-tech behaviour for free.
            */}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="dt-file"
              aria-describedby={`${panelId}-drop-hint`}
              onChange={(e) => onFiles(e.target.files)}
            />
          </div>

          {phase.kind === 'invalid' ? (
            <div className="dt-errors" role="alert">
              <p className="dt-errors__title">
                {t('data.import.invalidTitle', { file: phase.fileName, count: phase.errors.length })}
              </p>
              <ul className="dt-errors__list">
                {phase.errors.map((message, index) => (
                  <li key={`${index}-${message}`}>{message}</li>
                ))}
              </ul>
              <button type="button" className="dt-btn dt-btn--ghost dt-btn--sm" onClick={resetImport}>
                {t('data.import.clear')}
              </button>
            </div>
          ) : null}

          {phase.kind === 'valid' && importCounts ? (
            <div className="dt-preview">
              <p className="dt-preview__file dt-mono">{phase.fileName}</p>
              <table className="dt-table">
                <caption className="dt-visually-hidden">{t('data.import.previewCaption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('data.import.columnType')}</th>
                    <th scope="col">{t('data.import.columnCount')}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">{t('data.labels.tasks')}</th>
                    <td>{importCounts.tasks}</td>
                  </tr>
                  <tr>
                    <th scope="row">{t('data.labels.lists')}</th>
                    <td>{importCounts.lists}</td>
                  </tr>
                  <tr>
                    <th scope="row">{t('data.labels.events')}</th>
                    <td>{importCounts.events}</td>
                  </tr>
                </tbody>
              </table>

              {plan ? (
                <p className="dt-preview__plan">
                  {t('data.import.plan', {
                    added: plan.merge.counts.added,
                    updated: plan.merge.counts.updated,
                    skipped: plan.merge.counts.skipped,
                    removed: plan.replace.counts.removed,
                  })}
                </p>
              ) : null}

              {!writable ? (
                <p className="dt-note" role="note">
                  {t('data.import.notWritable')}
                </p>
              ) : confirmMode !== null ? (
                <div
                  className="dt-confirm"
                  role="alertdialog"
                  aria-label={t('data.import.confirmLabel')}
                >
                  <p className="dt-confirm__text">
                    {confirmMode === 'replace'
                      ? t('data.import.confirmReplace')
                      : t('data.import.confirmMerge')}
                  </p>
                  {confirmMode === 'replace' && discardWarning ? (
                    <p className="dt-confirm__text dt-confirm__loss">
                      {t(discardWarning.done > 0 ? 'data.import.discardWithDone' : 'data.import.discard', {
                        tasks: t('data.prose.tasks', { count: discardWarning.lost }),
                        done: t('data.prose.done', { count: discardWarning.done }),
                      })}
                    </p>
                  ) : null}
                  <div className="dt-actions">
                    <button
                      type="button"
                      className={`dt-btn dt-btn--sm ${confirmMode === 'replace' ? 'dt-btn--danger' : 'dt-btn--primary'}`}
                      disabled={busy}
                      onClick={() => void apply(confirmMode)}
                    >
                      {busy
                        ? t('data.import.busy')
                        : confirmMode === 'replace'
                          ? t('data.import.confirmReplaceAction')
                          : t('data.import.confirmMergeAction')}
                    </button>
                    <button
                      type="button"
                      className="dt-btn dt-btn--ghost dt-btn--sm"
                      disabled={busy}
                      onClick={() => setConfirmMode(null)}
                    >
                      {t('buttons.cancel', { ns: 'common' })}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="dt-actions">
                  <button
                    type="button"
                    className="dt-btn dt-btn--danger dt-btn--sm"
                    disabled={!writable || busy}
                    title={writable ? undefined : t('data.import.notWritableTitle')}
                    onClick={() => setConfirmMode('replace')}
                  >
                    {t('data.import.replace')}
                  </button>
                  <button
                    type="button"
                    className="dt-btn dt-btn--primary dt-btn--sm"
                    disabled={!writable || busy}
                    title={writable ? undefined : t('data.import.notWritableTitle')}
                    onClick={() => setConfirmMode('merge')}
                  >
                    {t('data.import.merge')}
                  </button>
                  <button
                    type="button"
                    className="dt-btn dt-btn--ghost dt-btn--sm"
                    disabled={busy}
                    onClick={resetImport}
                  >
                    {t('buttons.cancel', { ns: 'common' })}
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </section>

        {/* ------------------------------- Reset ------------------------- */}
        {onReset ? (
          <section className="dt-section dt-section--danger" aria-labelledby={`${panelId}-reset-label`}>
            <h3 id={`${panelId}-reset-label`} className="dt-section__title">
              {copy.heading}
            </h3>
            <p className="dt-section__hint">{copy.hint}</p>

            {confirmReset ? (
              <div className="dt-confirm" role="alertdialog" aria-label={copy.alertLabel}>
                <p className="dt-confirm__text">{copy.confirm}</p>
                {exportPreview && exportPreview.counts.tasks + exportPreview.counts.lists + exportPreview.counts.events > 0 ? (
                  <p className="dt-confirm__text dt-confirm__loss">
                    {resetLossLine(t, exportPreview.counts)}
                  </p>
                ) : null}
                <div className="dt-actions">
                  <button
                    type="button"
                    className="dt-btn dt-btn--danger dt-btn--sm"
                    disabled={busy}
                    onClick={() => void resetAll()}
                  >
                    {busy ? copy.busy : copy.confirmAction}
                  </button>
                  <button
                    type="button"
                    className="dt-btn dt-btn--ghost dt-btn--sm"
                    disabled={busy}
                    onClick={() => setConfirmReset(false)}
                  >
                    {t('buttons.cancel', { ns: 'common' })}
                  </button>
                </div>
              </div>
            ) : (
              <div className="dt-actions">
                <button
                  type="button"
                  className="dt-btn dt-btn--danger dt-btn--sm"
                  disabled={busy}
                  onClick={() => setConfirmReset(true)}
                >
                  {copy.trigger}
                </button>
              </div>
            )}
          </section>
        ) : null}

        {error ? (
          <p className="dt-note dt-note--error" role="alert">
            {error}
          </p>
        ) : null}

        {/* Polite live region: file names, validation summaries, apply results. */}
        <p className="dt-status" role="status" aria-live="polite">
          {status}
        </p>
      </section>
    </div>
  );
}
