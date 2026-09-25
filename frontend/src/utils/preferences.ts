import { useCallback, useState } from 'react';

/** A boolean user preference remembered in localStorage (falls back to `initial` when
 * storage is unavailable, e.g. in private mode). */
export function useStoredBoolean(key: string, initial: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? initial : stored === 'true';
    } catch {
      return initial;
    }
  });
  const update = useCallback(
    (next: boolean) => {
      try {
        localStorage.setItem(key, String(next));
      } catch {
        // Not remembered, but still applied for this session.
      }
      setValue(next);
    },
    [key],
  );
  return [value, update];
}
