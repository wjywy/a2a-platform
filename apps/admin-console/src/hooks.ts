import { useCallback, useEffect, useRef, useState } from "react";

export type AsyncState<T> = { data?: T; loading: boolean; error?: string };
export function useAsync<T>(
  loader: () => Promise<T>,
  dependencies: unknown[],
  options: { immediate?: boolean } = {},
) {
  const [state, setState] = useState<AsyncState<T>>({
    loading: options.immediate !== false,
  });
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    setState((previous) => ({ ...previous, loading: true, error: undefined }));
    try {
      const data = await loader();
      if (current === sequence.current) setState({ data, loading: false });
      return data;
    } catch (error) {
      if (current === sequence.current)
        setState((previous) => ({
          ...previous,
          loading: false,
          error: error instanceof Error ? error.message : "请求失败",
        }));
      throw error;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
  useEffect(() => {
    if (options.immediate === false) return;
    void refresh().catch(() => undefined);
    return () => {
      sequence.current++;
    };
  }, [refresh, options.immediate]);
  return {
    ...state,
    refresh,
    setData: (data: T) => setState({ data, loading: false }),
  };
}

export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
export function useLocalStorage(key: string, initial: string) {
  const [value, setValue] = useState(
    () => localStorage.getItem(key) ?? initial,
  );
  const update = useCallback(
    (next: string) => {
      setValue(next);
      localStorage.setItem(key, next);
    },
    [key],
  );
  return [value, update] as const;
}
export function useDisclosure(initial = false) {
  const [open, setOpen] = useState(initial);
  return {
    open,
    show: () => setOpen(true),
    hide: () => setOpen(false),
    toggle: () => setOpen((value) => !value),
  };
}
export function useInterval(callback: () => void, delay: number | null) {
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  }, [callback]);
  useEffect(() => {
    if (delay === null) return;
    const id = setInterval(() => latest.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}
