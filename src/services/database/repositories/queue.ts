import type { PlayContext, Track } from '@/types';
import { queueKey } from '@/utils/common';

import { runTransaction } from '../transaction';
import type { Database } from '../client';
import type { QueueRow } from '../rows';
import { getTrackRowIdByTrackId, getTracksByRowIds, parseTrackId } from './tracks';

/**
 * The persisted queue. Kept in SQLite (not a zustand-only blob) so it survives
 * process death and can be queried by track id â€” "add to queue" from a search
 * result is a single indexed insert.
 */

export type StoredQueueItem = {
  readonly key: string;
  readonly track: Track;
  readonly context: PlayContext;
  readonly addedAt: number;
};

export async function getQueue(db: Database): Promise<StoredQueueItem[]> {
  const rows = await db.getAllAsync<QueueRow>(
    `SELECT id, track_id, position, context, added_at
       FROM queue_items
      ORDER BY position ASC
      LIMIT 500`,
  );
  if (rows.length === 0) return [];

  const rowIds = rows.map((row) => row.track_id);
  // `queue_items.track_id` is UNIQUE, so the batched fetch preserves row order.
  const tracks = await getTracksByRowIds(db, rowIds, rowIds.length);

  const items: StoredQueueItem[] = [];
  rows.forEach((row, index) => {
    const track = tracks[index];
    if (!track) return;
    items.push({
      key: queueKey(track.id, index),
      track,
      context: row.context as PlayContext,
      addedAt: row.added_at,
    });
  });
  return items;
}

/** Replaces the whole queue in one transaction. */
export async function replaceQueue(
  db: Database,
  items: readonly { trackId: string; context: PlayContext }[],
): Promise<void> {
  await runTransaction(db, async (txn) => {
    await txn.runAsync('DELETE FROM queue_items');

    let position = 0;
    for (const item of items) {
      const parsed = parseTrackId(item.trackId);
      if (!parsed) continue;
      const row = await txn.getFirstAsync<{ id: number }>(
        'SELECT id FROM tracks WHERE provider = ? AND external_id = ?',
        parsed.provider,
        parsed.externalId,
      );
      if (!row) continue;
      await txn.runAsync(
        `INSERT OR IGNORE INTO queue_items (track_id, position, context, added_at)
         VALUES (?, ?, ?, ?)`,
        row.id,
        position,
        item.context,
        Date.now(),
      );
      position += 1;
    }
  });
}

/** Appends a track to the end of the queue. */
export async function enqueueTrack(
  db: Database,
  trackId: string,
  context: PlayContext = 'queue',
): Promise<boolean> {
  const rowId = await getTrackRowIdByTrackId(db, trackId);
  if (!rowId) return false;

  let enqueued = false;
  await runTransaction(db, async (txn) => {
    const row = await txn.getFirstAsync<{ next: number | null }>(
      'SELECT MAX(position) + 1 AS next FROM queue_items',
    );
    const result = await txn.runAsync(
      `INSERT OR IGNORE INTO queue_items (track_id, position, context, added_at)
       VALUES (?, ?, ?, ?)`,
      rowId,
      row?.next ?? 0,
      context,
      Date.now(),
    );
    enqueued = result.changes > 0;
  });
  return enqueued;
}

export async function removeFromQueue(db: Database, trackId: string): Promise<boolean> {
  const rowId = await getTrackRowIdByTrackId(db, trackId);
  if (!rowId) return false;

  let removed = false;
  await runTransaction(db, async (txn) => {
    const result = await txn.runAsync('DELETE FROM queue_items WHERE track_id = ?', rowId);
    // Compact positions so the next append stays contiguous.
    if (result.changes > 0) {
      await txn.runAsync(
        `UPDATE queue_items
            SET position = (SELECT COUNT(*) FROM queue_items q2 WHERE q2.id <= queue_items.id) - 1`,
      );
      removed = true;
    }
  });
  return removed;
}

export async function clearQueue(db: Database): Promise<void> {
  await db.runAsync('DELETE FROM queue_items');
}

export async function getQueueTrackIds(db: Database): Promise<string[]> {
  const rows = await db.getAllAsync<{ provider: string; external_id: string }>(
    `SELECT t.provider, t.external_id
       FROM queue_items q
       JOIN tracks t ON t.id = q.track_id
      ORDER BY q.position ASC`,
  );
  return rows.map((row) => `${row.provider}:${row.external_id}`);
}

export async function countQueueItems(db: Database): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM queue_items');
  return row?.count ?? 0;
}