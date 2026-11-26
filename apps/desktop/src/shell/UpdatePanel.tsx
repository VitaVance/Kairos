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
        <header className="up__head">
          <h2 className="up__title" id={titleId}>
            {t('update.title')}
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('update.close')}
          </Button>
        </header>

        <div className="up__body">
          {/* One source, no picker. The endpoint is whatever the build
              configured in tauri.conf.json; a user-facing "online / offline"
              toggle only existed to support air-gapped installs and leaked a
              developer concern into the product. */}
          <p className="up__intro">
            {t('update.online.intro')} <strong>{t('update.online.privacy')}</strong>
          </p>

          <div className="up__actions">
            <Button
              variant="primary"
              onClick={() => void check()}
              disabled={!canCheck}
              {...(blocked === null ? {} : { 'aria-describedby': reasonId })}
            >
              {phase.kind === 'checking' ? t('update.checking') : t('update.check')}
            </Button>
            {blocked === null ? null : (
              <span className="up__muted" id={reasonId}>
                {t(REASON_KEYS[blocked])}
              </span>
            )}
          </div>

          <div className="up__result" role="status" aria-live="polite">
            {phase.kind === 'idle' ? (
              <p className="up__muted">{t('update.result.idle')}</p>
            ) : phase.kind === 'checking' ? (
              <p className="up__muted">{t('update.result.reading')}</p>
            ) : phase.kind === 'failed' ? (
              <p className="up__error">
                {phase.reason === 'unavailable'
                  ? t('update.reason.unavailable')
                  : t(STATUS_KEYS[phase.reason])}
              </p>
            ) : (
              <>
                <dl className="up__versions">
                  <dt>{t('update.result.currentVersion')}</dt>
                  <dd>{phase.current}</dd>
                  <dt>{t('update.result.latestVersion')}</dt>
                  <dd>{phase.latest}</dd>
                </dl>

                {phase.availability === 'invalid-version' ? (
                  <p className="up__error">{t('update.result.invalidVersion')}</p>
                ) : phase.availability === 'update-available' ? (
                  <p className="up__found">{t('update.result.available')}</p>
                ) : (
                  <p className="up__ok">{t('update.result.upToDate')}</p>
                )}

                {phase.notes === undefined ? null : <p className="up__notes">{phase.notes}</p>}

                {phase.releaseUrl === undefined ? null : (
                  <label className="up__field">
                    <span className="up__label">{t('update.result.releaseUrlLabel')}</span>
                    <input className="up__url" value={phase.releaseUrl} readOnly onFocus={(e) => e.currentTarget.select()} />
                  </label>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}
