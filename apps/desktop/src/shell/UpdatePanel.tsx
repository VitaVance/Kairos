import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, TextField } from '@todolist/ui';
import { evaluateUpdate } from '@todolist/features';
import type { UpdateChecker, UpdateFetchStatus, UpdateSource } from '@todolist/features';
import './update-panel.css';

/**
 * Check for updates.
 *
 * Two sources, both explicit:
 *   - 在线（默认）— the release feed at the configured GitHub Releases endpoint.
 *     The updater plugin verifies the signature of the downloaded artifact, so a
 *     tampered installer is rejected before it runs.
 *   - 离线        — a `latest.json` the user already has on disk, for air-gapped
 *     machines or testing without a published release.
 *
 * Nothing happens until the user clicks 检查更新: there is no timer and no
 * startup request. Your tasks, lists and events never leave the machine — the
 * only request this app ever makes is a GET for a static version manifest.
 */

const STATUS_COPY: Record<UpdateFetchStatus, string> = {
  'manifest-read': '',
  'not-configured': '尚未配置更新源',
  'invalid-source': '更新源无效（在线地址必须是 https://，本地路径必须是绝对路径）',
  unreachable: '无法连接更新源（网络不可用，或文件不存在）',
  'invalid-manifest': '更新源返回的内容不是有效的更新清单',
};

export interface UpdatePanelProps {
  open: boolean;
  onClose: () => void;
  checker: UpdateChecker | null;
  /** Default online endpoint; empty means "not configured for this build". */
  endpoint?: string;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'failed'; message: string }
  | {
      kind: 'done';
      current: string;
      latest: string;
      availability: 'update-available' | 'up-to-date' | 'invalid-version';
      notes?: string;
      releaseUrl?: string;
    };

type Mode = 'online' | 'offline';

export function UpdatePanel({ open, onClose, checker, endpoint = '' }: UpdatePanelProps) {
  const [mode, setMode] = useState<Mode>(endpoint.length > 0 ? 'online' : 'offline');
  const [path, setPath] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const closeRef = useRef<HTMLButtonElement | null>(null);
  // The host passes an inline `onClose`, whose identity changes on every parent
  // render (tasks/revision). Reading it through a ref keeps the effect keyed on
  // `open` alone, so a background re-render cannot re-run focus and yank the
  // caret out of the path field mid-typing.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const check = useCallback(async () => {
    if (checker === null) {
      setPhase({ kind: 'failed', message: '更新检查仅在桌面应用中可用' });
      return;
    }
    setPhase({ kind: 'checking' });

    const source: UpdateSource =
      mode === 'online' ? { kind: 'endpoint', url: endpoint } : { kind: 'file', path };

    try {
      const currentVersion = await checker.currentVersion();
      const outcome = await checker.fetchManifest(source);

      if (outcome.status !== 'manifest-read') {
        setPhase({ kind: 'failed', message: STATUS_COPY[outcome.status] });
        return;
      }

      const evaluation = evaluateUpdate(currentVersion, outcome.manifest);
      setPhase({
        kind: 'done',
        current: evaluation.currentVersion,
        latest: evaluation.latestVersion,
        availability: evaluation.status,
        ...(outcome.manifest.notes === undefined ? {} : { notes: outcome.manifest.notes }),
        ...(outcome.manifest.releaseUrl === undefined
          ? {}
          : { releaseUrl: outcome.manifest.releaseUrl }),
      });
    } catch (error: unknown) {
      // A host that throws (rather than returning a status) must not leave the
      // panel spinning on 「正在检查…」 forever.
      console.warn('[update] 检查更新失败', error);
      setPhase({ kind: 'failed', message: STATUS_COPY.unreachable });
    }
  }, [checker, path, mode, endpoint]);

  // Escape closes and focus returns to whatever opened the panel, matching the
  // Popover/dialog behaviour every other overlay in the shell uses.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // An inner popover/menu owns Escape while open.
      if (document.querySelector('.tl-popover')) return;
      e.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const onlineConfigured = endpoint.length > 0;
  const canCheck =
    checker !== null &&
    phase.kind !== 'checking' &&
    (mode === 'offline' || onlineConfigured) &&
    (mode === 'online' || path.trim().length > 0);

  return (
    <div
      className="up"
      role="dialog"
      aria-modal="true"
      aria-label="检查更新"
      // Native dialogs close on a backdrop click; this hand-rolled overlay must
      // do the same. The event target is the backdrop only when the press
      // started there (`e.target === e.currentTarget`), not on the card.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="up__card">
        <header className="up__head">
          <h2 className="up__title">检查更新</h2>
          <Button ref={closeRef} variant="ghost" size="sm" onClick={onClose}>
            关闭
          </Button>
        </header>

        <div className="up__body">
          <div className="up__modes" role="group" aria-label="更新源">
            <button
              type="button"
              className={`up__mode${mode === 'online' ? ' is-active' : ''}`}
              aria-pressed={mode === 'online'}
              onClick={() => setMode('online')}
            >
              在线（GitHub Releases）
            </button>
            <button
              type="button"
              className={`up__mode${mode === 'offline' ? ' is-active' : ''}`}
              aria-pressed={mode === 'offline'}
              onClick={() => setMode('offline')}
            >
              离线（本地文件）
            </button>
          </div>

          {mode === 'online' ? (
            endpoint.length > 0 ? (
              <p className="up__intro">
                将从项目的发布页读取版本信息。只有版本清单会被下载，
                <strong>你的任务数据不会离开这台电脑</strong>。
              </p>
            ) : (
              <p className="up__error">
                此构建尚未配置更新源。请在 tauri.conf.json 的 plugins.updater.endpoints
                填入你的 GitHub Releases 地址。
              </p>
            )
          ) : (
            <>
              <p className="up__intro">
                如果你在离线环境，请先手动下载发布页提供的
                <code> latest.json </code>，把它的完整路径填在下面。
              </p>
              <label className="up__field">
                <span className="up__label">清单文件路径</span>
                <TextField
                  value={path}
                  onChange={setPath}
                  placeholder="D:\下载\latest.json"
                  label="清单文件路径"
                />
              </label>
            </>
          )}

          <div className="up__actions">
            <Button
              variant="primary"
              onClick={() => void check()}
              disabled={!canCheck}
              title={
                mode === 'online' && !onlineConfigured
                  ? '此构建未配置更新源'
                  : mode === 'offline' && path.trim().length === 0
                    ? '请填写清单文件路径'
                    : undefined
              }
            >
              {phase.kind === 'checking' ? '正在检查…' : '检查更新'}
            </Button>
            {mode === 'offline' && path.trim().length === 0 ? (
              <span className="up__muted">填写路径后即可检查</span>
            ) : null}
          </div>

          <div className="up__result" role="status" aria-live="polite">
            {phase.kind === 'idle' ? (
              <p className="up__muted">尚未检查</p>
            ) : phase.kind === 'checking' ? (
              <p className="up__muted">正在读取清单…</p>
            ) : phase.kind === 'failed' ? (
              <p className="up__error">{phase.message}</p>
            ) : (
              <>
                <dl className="up__versions">
                  <dt>当前版本</dt>
                  <dd>{phase.current}</dd>
                  <dt>清单版本</dt>
                  <dd>{phase.latest}</dd>
                </dl>

                {phase.availability === 'invalid-version' ? (
                  <p className="up__error">无法比较版本：清单里的版本号格式不正确。</p>
                ) : phase.availability === 'update-available' ? (
                  <p className="up__found">有新版本可用。请从发布页下载并覆盖安装。</p>
                ) : (
                  <p className="up__ok">当前已是最新版本。</p>
                )}

                {phase.notes === undefined ? null : <p className="up__notes">{phase.notes}</p>}

                {phase.releaseUrl === undefined ? null : (
                  <label className="up__field">
                    <span className="up__label">发布页（可复制到浏览器打开）</span>
                    <input className="up__url" value={phase.releaseUrl} readOnly onFocus={(e) => e.currentTarget.select()} />
                  </label>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
