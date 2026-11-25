import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import './data-transfer.css';
import type { DragEvent } from 'react';
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

export function DataTransferPanel({ open, onClose, onApply }: DataTransferPanelProps) {
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
    setStatus(`正在解析 ${file.name}…`);

    let text: string;
    try {
      text = await file.text();
    } catch {
      setPhase({ kind: 'invalid', fileName: file.name, errors: ['无法读取该文件'] });
      setStatus(`「${file.name}」读取失败`);
      return;
    }

    const result = parseImport(text);
    if (!result.ok) {
      setPhase({ kind: 'invalid', fileName: file.name, errors: result.errors });
      setStatus(`「${file.name}」校验失败，共 ${result.errors.length} 个问题`);
      return;
    }

    // Rebuild a canonical envelope so the preview and the eventual apply share
    // one validated shape.
    const rebuilt = exportToJson(result.data, { exportedAt: new Date().toISOString() as BackupFile['exportedAt'] });
    setPhase({ kind: 'valid', fileName: file.name, file: rebuilt });
    setStatus(
      `「${file.name}」校验通过：任务 ${result.data.tasks.length} · 清单 ${result.data.lists.length} · 日程 ${result.data.events.length}`,
    );
  }, []);

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
      setStatus(`已导出 ${fileName}（${formatBytes(blob.size)}）`);
    } finally {
      // Revoking synchronously can race the click in some engines; defer one loop.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }, []);

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
        setStatus(mode === 'replace' ? '已替换导入完成' : '已合并导入完成');
        resetImport();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [writable, onApply, phase, onClose, resetImport, undoStack],
  );

  if (!open) return null;

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
            数据导入导出
          </h2>
          <button ref={closeRef} type="button" className="dt-close" aria-label="关闭" onClick={onClose}>
            <span aria-hidden="true">✕</span>
          </button>
        </header>

        {/* ------------------------------- Export ------------------------ */}
        <section className="dt-section" aria-labelledby={`${panelId}-export-label`}>
          <h3 id={`${panelId}-export-label`} className="dt-section__title">
            导出
          </h3>
          <p className="dt-section__hint">
            完整备份包含任务、清单与日程，可原样导入恢复；CSV 适合在表格软件中查看，但不含 id。
          </p>

          {exportPreview ? (
            <div className="dt-export">
              <dl className="dt-export__meta">
                <div className="dt-export__row">
                  <dt>文件名</dt>
                  <dd className="dt-mono">{exportPreview.fileName}</dd>
                </div>
                <div className="dt-export__row">
                  <dt>大小</dt>
                  <dd>{formatBytes(exportPreview.bytes)}</dd>
                </div>
                <div className="dt-export__row">
                  <dt>内容</dt>
                  <dd>
                    任务 {exportPreview.counts.tasks} · 清单 {exportPreview.counts.lists} · 日程{' '}
                    {exportPreview.counts.events}
                  </dd>
                </div>
              </dl>
              <div className="dt-actions">
                <button type="button" className="dt-btn dt-btn--primary" onClick={downloadJson}>
                  导出 JSON
                </button>
                <button type="button" className="dt-btn" onClick={downloadCsv}>
                  导出 CSV
                </button>
              </div>
            </div>
          ) : (
            <p className="dt-empty">当前没有可导出的数据。</p>
          )}
        </section>

        {/* ------------------------------- Import ------------------------ */}
        <section className="dt-section" aria-labelledby={`${panelId}-import-label`}>
          <h3 id={`${panelId}-import-label`} className="dt-section__title">
            导入
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
            <span className="dt-drop__title">拖放 JSON 备份到此处</span>
            <span id={`${panelId}-drop-hint`} className="dt-drop__hint">
              或选择文件（.json）
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
                「{phase.fileName}」无法导入，共 {phase.errors.length} 个问题：
              </p>
              <ul className="dt-errors__list">
                {phase.errors.map((message, index) => (
                  <li key={`${index}-${message}`}>{message}</li>
                ))}
              </ul>
              <button type="button" className="dt-btn dt-btn--ghost dt-btn--sm" onClick={resetImport}>
                清除
              </button>
            </div>
          ) : null}

          {phase.kind === 'valid' && importCounts ? (
            <div className="dt-preview">
              <p className="dt-preview__file dt-mono">{phase.fileName}</p>
              <table className="dt-table">
                <caption className="dt-visually-hidden">导入内容预览</caption>
                <thead>
                  <tr>
                    <th scope="col">类型</th>
                    <th scope="col">数量</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">任务</th>
                    <td>{importCounts.tasks}</td>
                  </tr>
                  <tr>
                    <th scope="row">清单</th>
                    <td>{importCounts.lists}</td>
                  </tr>
                  <tr>
                    <th scope="row">日程</th>
                    <td>{importCounts.events}</td>
                  </tr>
                </tbody>
              </table>

              {plan ? (
                <p className="dt-preview__plan">
                  合并预览：新增 {plan.merge.counts.added} · 更新 {plan.merge.counts.updated} · 跳过{' '}
                  {plan.merge.counts.skipped}；替换预览：新增 {plan.replace.counts.added} · 移除{' '}
                  {plan.replace.counts.removed}
                </p>
              ) : null}

              {!writable ? (
                <p className="dt-note" role="note">
                  写入端口尚未接入，导入功能暂不可用（可预览校验结果）。
                </p>
              ) : confirmMode !== null ? (
                <div className="dt-confirm" role="alertdialog" aria-label="确认导入">
                  <p className="dt-confirm__text">
                    {confirmMode === 'replace'
                      ? '替换导入会删除当前全部任务、清单与日程，仅保留备份中的内容。此操作无法撤销。'
                      : '合并导入会新增缺失记录，并用较新的数据覆盖同 id 的现有记录。'}
                  </p>
                  {confirmMode === 'replace' && discardWarning ? (
                    <p className="dt-confirm__text dt-confirm__loss">
                      当前有 {discardWarning.lost} 条任务不在该备份中
                      {discardWarning.done > 0 ? `（其中 ${discardWarning.done} 条已完成）` : ''}
                      ，替换后会永久丢失。建议先「导出 JSON」留一份备份。
                    </p>
                  ) : null}
                  <div className="dt-actions">
                    <button
                      type="button"
                      className={`dt-btn dt-btn--sm ${confirmMode === 'replace' ? 'dt-btn--danger' : 'dt-btn--primary'}`}
                      disabled={busy}
                      onClick={() => void apply(confirmMode)}
                    >
                      {busy ? '处理中…' : `确认${confirmMode === 'replace' ? '替换' : '合并'}`}
                    </button>
                    <button
                      type="button"
                      className="dt-btn dt-btn--ghost dt-btn--sm"
                      disabled={busy}
                      onClick={() => setConfirmMode(null)}
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div className="dt-actions">
                  <button
                    type="button"
                    className="dt-btn dt-btn--danger dt-btn--sm"
                    disabled={!writable || busy}
                    title={writable ? undefined : '写入端口尚未接入'}
                    onClick={() => setConfirmMode('replace')}
                  >
                    替换导入
                  </button>
                  <button
                    type="button"
                    className="dt-btn dt-btn--primary dt-btn--sm"
                    disabled={!writable || busy}
                    title={writable ? undefined : '写入端口尚未接入'}
                    onClick={() => setConfirmMode('merge')}
                  >
                    合并导入
                  </button>
                  <button
                    type="button"
                    className="dt-btn dt-btn--ghost dt-btn--sm"
                    disabled={busy}
                    onClick={resetImport}
                  >
                    取消
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </section>

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
