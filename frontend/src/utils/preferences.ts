import { useCallback, useState } from 'react';

/** A user preference remembered in localStorage (falls back to `initial` when storage is
 * unavailable, e.g. in private mode, or holds a value outside `allowed`). */
export function useStoredValue<T extends string>(key: string, initial: T, allowed: readonly T[]): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored !== null && (allowed as readonly string[]).includes(stored) ? (stored as T) : initial;
    } catch {
      return initial;
    }
  });
  const update = useCallback(
    (next: T) => {
      try {
        localStorage.setItem(key, next);
      } catch {
        // Not remembered, but still applied for this session.
      }
      setValue(next);
    },
    [key],
  );
  return [value, update];
}

const BOOLEANS = ['true', 'false'] as const;

/** A boolean user preference remembered in localStorage. */
export function useStoredBoolean(key: string, initial: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useStoredValue(key, initial ? 'true' : 'false', BOOLEANS);
  const update = useCallback((next: boolean) => setValue(next ? 'true' : 'false'), [setValue]);
  return [value === 'true', update];
}
