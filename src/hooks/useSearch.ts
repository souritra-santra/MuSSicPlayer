import { useEffect, useMemo, useState } from 'react';

import { correctSpelling } from '@/utils/normalize';

/**
 * Search input helpers.
 *
 * Provider search costs a full network fan-out per query, so the raw input is
 * debounced before it reaches the query layer. 280 ms is below the ~400 ms
 * where typing feels laggy but keeps a fast typist from firing five searches.
 */

export function useDebouncedValue<T>(value: T, delayMs = 280): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (value === debounced) return;
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs, debounced]);

  return debounced;
}

/**
 * Search box state: raw input, the debounced value that drives live results,
 * and the "committed" value the user explicitly submitted.
 */
export function useSearchQueryState(initial = '') {
  const [input, setInput] = useState(initial);
  const [submitted, setSubmitted] = useState(initial);
  const debounced = useDebouncedValue(input);

  // Search what the user *meant*: "daft punk remixes" -> "daft punk remix",
  // and drop platform noise like "yt" / "spotify" that no catalogue title
  // contains. Applied to the query only, never to the visible input, so the
  // correction is invisible and reversible.
  const query = useMemo(() => correctSpelling(debounced.trim()), [debounced]);

  return useMemo(
    () => ({
      input,
      setInput,
      /** The debounced, spell-corrected value — drives live results. */
      query,
      /** Immediately commits the current input (search keypress). */
      submit: () => setSubmitted(query),
      submitted,
      clear: () => {
        setInput('');
        setSubmitted('');
      },
      isTyping: input.trim().length > 0,
      /**
       * True while the user has typed but the debounce has not caught up, so
       * the screen can keep the previous results visible instead of flashing
       * an empty state between keystrokes.
       */
      isSettling: input !== debounced,
    }),
    [input, query, debounced, submitted],
  );
}