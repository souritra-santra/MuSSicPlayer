/** Display formatting helpers. */

/** `215000` -> `3:35`, `3725000` -> `1:02:05`. Returns `--:--` when unknown. */
export function formatDuration(durationMs?: number | null): string {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) {
    return '--:--';
  }
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** `2` -> `2 min ago`, `3 days ago`, `just now`. */
export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const diff = Math.max(0, now - timestamp);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'} ago`;
  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? 'year' : 'years'} ago`;
}

/** `1234` -> `1.2K`, `1_500_000` -> `1.5M`. */
export function formatCount(count: number): string {
  if (!Number.isFinite(count)) return '0';
  const abs = Math.abs(count);
  if (abs < 1000) return String(count);
  if (abs < 1_000_000) {
    const value = count / 1000;
    return `${value < 10 ? value.toFixed(1).replace(/\.0$/, '') : Math.round(value)}K`;
  }
  const value = count / 1_000_000;
  return `${value < 10 ? value.toFixed(1).replace(/\.0$/, '') : Math.round(value)}M`;
}

/** `1` -> `1 song`, `3` -> `3 songs`. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** `10485760` -> `10.0 MB`. */
export function formatBytes(bytes?: number | null): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '--';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Joins artist names for display: `Artist`, `A & B`, `A, B & C`. */
export function formatArtistNames(names: readonly string[]): string {
  if (names.length === 0) return 'Unknown artist';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

/** Progress ratio in [0, 1] for a seek bar. */
export function progressRatio(positionMs: number, durationMs?: number): number {
  if (!durationMs || durationMs <= 0) return 0;
  return Math.min(1, Math.max(0, positionMs / durationMs));
}