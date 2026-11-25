import { Component, useEffect, useRef } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

/**
 * Error handling for the desktop shell.
 *
 * React error boundaries only catch errors thrown during *render*. Async
 * failures (rejected promises, setTimeout callbacks, event handlers) slip
 * through, so `useGlobalErrorHandler()` covers those.
 */

const LOG_PREFIX = '[todolist] ErrorBoundary';

export type GlobalErrorSource = 'error' | 'unhandledrejection';

export interface GlobalErrorEvent {
  source: GlobalErrorSource;
  /** Whatever was thrown/rejected — not guaranteed to be an Error. */
  error: unknown;
}

export interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: unknown;
}

/** Turn anything thrown into a printable string without ever throwing. */
function describeError(error: unknown): string {
  if (error == null) return '未知错误';
  if (error instanceof Error) {
    // Prefer a non-empty stack, then message, then name.
    return error.stack || error.message || error.name || '未知错误';
  }
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

function ErrorGlyph() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3.5 22 20H2L12 3.5Z" />
      <path d="M12 9.5v4.5" />
      <circle cx="12" cy="17" r=".8" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Catches render errors in its subtree and shows a calm recovery card.
 * Must be a class: error boundaries are not expressible as hooks.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    // Guard against null/undefined throws; never let the boundary itself fail.
    return { hasError: true, error: error ?? new Error('未知错误') };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(`${LOG_PREFIX} caught a render error`, error, errorInfo.componentStack);
  }

  private readonly handleRetry = (): void => {
    // Clearing the error unmounts the fallback and remounts children fresh.
    this.setState({ hasError: false, error: null });
  };

  private readonly handleReload = (): void => {
    try {
      if (typeof window !== 'undefined' && typeof window.location?.reload === 'function') {
        window.location.reload();
      }
    } catch {
      /* reload unavailable — nothing else we can do */
    }
  };

  override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    // Defensive: describeError tolerates null/non-Error values.
    const detail = describeError(this.state.error);

    return (
      <div className="sh-error" role="alert">
        <div className="sh-error__card">
          <div className="sh-error__icon" aria-hidden="true">
            <ErrorGlyph />
          </div>
          <h2 className="sh-error__title">出了点问题</h2>
          <p className="sh-error__hint">这个操作没能完成。可以重试一次，或重新加载页面。</p>

          <details className="sh-error__details">
            <summary>错误详情</summary>
            <pre className="sh-error__pre">{detail}</pre>
          </details>

          <div className="sh-error__actions">
            <button type="button" className="sh-error__btn sh-error__btn--primary" onClick={this.handleRetry}>
              重试
            </button>
            <button type="button" className="sh-error__btn sh-error__btn--secondary" onClick={this.handleReload}>
              重新加载
            </button>
          </div>
        </div>
      </div>
    );
  }
}

/**
 * Routes window-level `error` and `unhandledrejection` events to a callback so
 * async failures (rejected promises, timer/event-handler throws) are visible
 * instead of silent. The listeners are registered once; the latest callback is
 * used without re-subscribing.
 */
export function useGlobalErrorHandler(onError: (event: GlobalErrorEvent) => void): void {
  const handlerRef = useRef(onError);

  useEffect(() => {
    handlerRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleError = (event: ErrorEvent): void => {
      handlerRef.current({ source: 'error', error: event.error ?? event.message });
    };

    const handleRejection = (event: PromiseRejectionEvent): void => {
      handlerRef.current({ source: 'unhandledrejection', error: event.reason });
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);
}
