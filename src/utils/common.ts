/**
 * Small, dependency-free helpers. Kept allocation-light: these run inside
 * ranking loops over hundreds of search results.
 */

/**
 * FNV-1a (32-bit). Not cryptographic — this only needs to be fast, stable and
 * well-distributed for dedupe keys and React list keys.
 */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // hash *= 16777619, expressed as shifts to stay in int32 range.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/** 8-char hex digest of `fnv1a`. */
export function shortHash(input: string): string {
  return fnv1a(input).toString(16).padStart(8, '0');
}

/** `${provider}:${externalId}` — the local uniqueness key for a track. */
export function dedupeKey(provider: string, externalId: string): string {
  return `${provider}:${externalId}`;
}

/**
 * Cross-provider fingerprint: normalized title + primary artist, bucketed by
 * duration. Two providers returning the same recording produce the same
 * signature even though their ids differ, which is what lets unified search
 * collapse them into one row with "Other Sources" alternates.
 */
export function trackSignature(
  normalizedTitle: string,
  normalizedArtist: string,
  durationMs?: number | null,
): string {
  const durationBucket =
    typeof durationMs === 'number' && durationMs > 0
      ? Math.round(durationMs / 1000 / 5) // 5-second buckets absorb encoder differences
      : 0;
  return shortHash(`${normalizedTitle}|${normalizedArtist}|${durationBucket}`);
}

/** Stable React key for a queue entry, disambiguating duplicate tracks. */
export function queueKey(trackId: string, index: number): string {
  return `${trackId}#${index}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Rounds to `digits` decimals without float drift artifacts. */
export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Fisher–Yates using Math.random; adequate for a UI shuffle order. */
export function shuffle<T>(items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/** Trailing-edge debounce. */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  wait: number,
): ((...args: Args) => void) & { cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: Args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  return wrapped;
}

/**
 * Runs `tasks` with a bounded concurrency window. Provider search must fan out
 * to several upstreams at once without opening a dozen sockets at t=0, and a
 * single hanging provider must not block the others.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  });

  await Promise.all(runners);
  return results;
}

export function uniqueBy<T, K>(items: readonly T[], key: (item: T) => K): T[] {
  const seen = new Set<K>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

export function uniq<T>(items: readonly T[]): T[] {
  return Array.from(new Set(items));
}

/**
 * Bounds a promise with a deadline. The underlying work is NOT cancelled (the
 * fetch API's signal plumbing would need to thread through every provider),
 * but downstream code moves on and the settled-result map records the failure
 * instead of letting one slow upstream hang the whole fan-out.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message = 'Timed out',
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (reason: unknown) => {
        clearTimeout(timer);
        reject(reason);
      },
    );
  });
}