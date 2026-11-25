import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
}

/**
 * Runs an async loader and tracks it. The reload token is used for manual
 * refreshes after mutations; the unmounted guard prevents setState on a dead
 * component (React 19 StrictMode double-invokes effects).
 */
export function useAsync<T>(loader: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: true });
  const [token, setToken] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    loader().then(
      (data) => {
        if (cancelled || !alive.current) return;
        setState({ data, error: null, loading: false });
      },
      (err: unknown) => {
        if (cancelled || !alive.current) return;
        setState({ data: null, error: err instanceof Error ? err : new Error(String(err)), loading: false });
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, token]);

  const reload = useCallback(() => setToken((t) => t + 1), []);
  return { ...state, reload };
}
