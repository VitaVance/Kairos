import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { Button, useTranslation } from '@todolist/ui';
import { evaluateUpdate } from '@todolist/features';
import type { UpdateChecker, UpdateFetchStatus, UpdateSource } from '@todolist/features';
import './update-panel.css';

/**
 * Check for updates.
 *
 * Two sources, both explicit:
 *   - online (default) — the release feed at the configured GitHub Releases
 *     endpoint. The updater plugin verifies the signature of the downloaded
 *     artifact, so a tampered installer is rejected before it runs.
 *   - offline          — a `latest.json` the user already has on disk, for
 *     air-gapped machines or testing without a published release.
 *
 * Nothing happens until the user clicks check: there is no timer and no
 * startup request. Your tasks, lists and events never leave the machine — the
 * only request this app ever makes is a GET for a static version manifest.
 *
 * A native `<dialog>` opened with `showModal()` owns focus trapping, Escape and
 * the top layer, so there is no hand-rolled key listener or focus hand-back.
 */

/** Why a check could not run or finish; rendered through the `update.*` keys. */
type FailureReason = 'unavailable' | Exclude<UpdateFetchStatus, 'manifest-read'>;

const STATUS_KEYS = {
  'not-configured': 'update.status.notConfigured',
  'invalid-source': 'update.status.invalidSource',
  unreachable: 'update.status.unreachable',
  'invalid-manifest': 'update.status.invalidManifest',
} as const;

const REASON_KEYS = {
  unavailable: 'update.reason.unavailable',
  'not-configured': 'update.reason.notConfigured',
  'path-required': 'update.reason.pathRequired',
} as const;

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
  | { kind: 'failed'; reason: FailureReason }
  | {
      kind: 'done';
      current: string;
      latest: string;
      availability: 'update-available' | 'up-to-date' | 'invalid-version';
      notes?: string;
      releaseUrl?: string;
    };

export function UpdatePanel({ open, onClose, checker, endpoint = '' }: UpdatePanelProps) {
  const { t } = useTranslation('shell');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  /**
   * The installed version, read once so the idle state can show what is running
   * before anything is checked. The design puts it in the first screen; leaving
   * it blank until a check completes meant the first thing a user saw was an
   * empty panel with one button.
   */
  const [currentLabel, setCurrentLabel] = useState('—');
  useEffect(() => {
    if (!open || checker === null) return;
    let cancelled = false;
    void checker
      .currentVersion()
      .then((v) => {
        if (!cancelled) setCurrentLabel(v);
      })
      .catch(() => {
        /* A host that cannot report its own version keeps the dash. */
      });
    return () => {
      cancelled = true;
    };
  }, [open, checker]);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const reasonId = useId();

  // Drive the native dialog imperatively — never render the `open` attribute.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  // A check left mid-flight when the panel was closed resolves within the
  // host's 15 s timeout; reopening then shows its real outcome rather than a
  // stale "checking" that never ends.

  const check = useCallback(async () => {
    if (checker === null) {
      setPhase({ kind: 'failed', reason: 'unavailable' });
      return;
    }
    setPhase({ kind: 'checking' });

    const source: UpdateSource = { kind: 'endpoint', url: endpoint };

    try {
      const currentVersion = await checker.currentVersion();
      const outcome = await checker.fetchManifest(source);

      if (outcome.status !== 'manifest-read') {
        setPhase({ kind: 'failed', reason: outcome.status });
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
      // panel spinning on 「checking」 forever.
      console.warn('[update] 检查更新失败', error);
      setPhase({ kind: 'failed', reason: 'unreachable' });
    }
  }, [checker, endpoint]);

  const onlineConfigured = endpoint.length > 0;
  const canCheck = checker !== null && phase.kind !== 'checking' && onlineConfigured;

  // Why the check button is unavailable. `title` is neither keyboard-reachable
  // nor reliably announced, and a `disabled` button cannot be focused to
  // surface it, so the reason renders as visible text beside the button and is
  // wired to it with `aria-describedby`.
  const blocked: 'unavailable' | 'not-configured' | null =
    phase.kind === 'checking'
      ? null
      : checker === null
        ? 'unavailable'
        : !onlineConfigured
          ? 'not-configured'
          : null;

  // A click on the dialog element itself (not a descendant) is the backdrop.
  const onClick = (event: ReactMouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="up-dialog"
      aria-labelledby={titleId}
      onClick={onClick}
      // `cancel` fires on Escape; close through the parent so `open` stays the
      // single source of truth, and let the native close follow.
      onCancel={onClose}
      onClose={onClose}
    >
      <div className="up__shell">
        {/* No visible title. The rail button that opens this already says
            「检查更新」; repeating it as a 17px heading made the same sentence
            appear twice in one card. The accessible name lives in a visually
            hidden h2 instead. */}
        <h2 className="up__sr-title" id={titleId}>
          {t('update.title')}
        </h2>

        <div className="up__head">
          <button
            type="button"
            className="up__close"
            aria-label={t('update.close')}
            title={t('update.close')}
            onClick={onClose}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="up__body" role="status" aria-live="polite">
          {phase.kind === 'idle' ? (
            <>
              <p className="up__meta">
                <span className="up__meta-k">{t('update.result.currentVersion')}</span>
                <span className="up__meta-v">{checker === null ? '—' : currentLabel}</span>
              </p>
              <p className="up__intro">{t('update.online.intro')}</p>
            </>
          ) : phase.kind === 'checking' ? (
            <>
              <p className="up__intro">{t('update.result.reading')}</p>
              {/* Indeterminate, 32px. No percentage: an HTTP request has no
                  measurable progress and a fake 60% is a lie. `aria-busy` sits
                  here, never on the live region — it would defer the very
                  announcement 「正在检查…」 exists to make. */}
              <span className="up__progress" aria-hidden="true" />
            </>
          ) : phase.kind === 'failed' ? (
            <div className="up__status">
              <svg className="up__status-icon up__status-icon--danger" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                <circle cx="8" cy="8" r="6" />
                <path d="M8 5v3.5M8 11h.01" />
              </svg>
              <div className="up__status-text">
                <p className="up__status-title up__status-title--danger">
                  {phase.reason === 'unavailable'
                    ? t('update.reason.unavailable')
                    : t(STATUS_KEYS[phase.reason])}
                </p>
              </div>
            </div>
          ) : phase.availability === 'update-available' ? (
            <>
              <div className="up__versions">
                <span className="up__versions-from">{phase.current}</span>
                <span className="up__versions-arrow" aria-hidden="true">
                  →
                </span>
                <span className="up__versions-to">{phase.latest}</span>
              </div>
              <p className="up__status-title">{t('update.result.available')}</p>
              {phase.notes === undefined ? null : <p className="up__notes">{phase.notes}</p>}
            </>
          ) : phase.availability === 'invalid-version' ? (
            <div className="up__status">
              <svg className="up__status-icon up__status-icon--danger" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                <circle cx="8" cy="8" r="6" />
                <path d="M8 5v3.5M8 11h.01" />
              </svg>
              <div className="up__status-text">
                <p className="up__status-title up__status-title--danger">
                  {t('update.result.invalidVersion')}
                </p>
              </div>
            </div>
          ) : (
            <div className="up__status">
              <svg className="up__status-icon up__status-icon--ok" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                <circle cx="8" cy="8" r="6" />
                <path d="M5.5 8.2l1.8 1.8 3.4-3.6" />
              </svg>
              <div className="up__status-text">
                <p className="up__status-title up__status-title--ok">{t('update.result.upToDate')}</p>
                <p className="up__status-detail">
                  {t('update.result.currentVersion')} {phase.current}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* One action, always in the same place. During a check the bar is
            removed entirely rather than showing a disabled button — a control
            that can't be pressed only raises "is it stuck?". */}
        <div className="up__foot" hidden={phase.kind === 'checking'}>
          <span className="up__spacer" />
          {phase.kind === 'done' && phase.availability === 'update-available' && phase.releaseUrl ? (
            <Button
              variant="primary"
              onClick={() => {
                if (phase.releaseUrl) window.open(phase.releaseUrl, '_blank', 'noopener,noreferrer');
              }}
            >
              {t('update.result.goToDownload')}
            </Button>
          ) : phase.kind === 'idle' || phase.kind === 'checking' ? (
            <Button variant="primary" onClick={() => void check()} disabled={!canCheck} {...(blocked === null ? {} : { 'aria-describedby': reasonId })}>
              {t('update.check')}
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => void check()} disabled={!canCheck}>
              {t('update.checkAgain')}
            </Button>
          )}
          {blocked === null ? null : (
            <span className="up__blocked" id={reasonId}>
              {t(REASON_KEYS[blocked])}
            </span>
          )}
        </div>
      </div>
    </dialog>
  );
}
