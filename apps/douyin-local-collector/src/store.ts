import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CollectorBatch, CollectedVideo } from "./types";

type QueueRow = { id: string; payload: string; attempts: number };
type TrackRow = { videoId: string; sourceUrl: string; publishedAt: string; nextStage: number; nextDueAt: string };

export class CollectorStore {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS queue (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        nextAttemptAt TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS keyword_runs (
        keywordId TEXT PRIMARY KEY,
        lastRunAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tracked_videos (
        videoId TEXT PRIMARY KEY,
        sourceUrl TEXT NOT NULL,
        publishedAt TEXT NOT NULL,
        nextStage INTEGER NOT NULL,
        nextDueAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS daily_search_usage (
        day TEXT PRIMARY KEY,
        searchCount INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  enqueue(batch: CollectorBatch) {
    this.database.prepare(`
      INSERT OR IGNORE INTO queue (id, payload, nextAttemptAt, createdAt)
      VALUES (?, ?, ?, ?)
    `).run(batch.batchId, JSON.stringify(batch), new Date().toISOString(), new Date().toISOString());
  }

  dueQueue(limit = 10): Array<{ batch: CollectorBatch; attempts: number }> {
    return (this.database.prepare(`
      SELECT id, payload, attempts FROM queue
      WHERE nextAttemptAt <= ?
      ORDER BY createdAt ASC LIMIT ?
    `).all(new Date().toISOString(), limit) as QueueRow[])
      .map((row) => ({ batch: JSON.parse(row.payload) as CollectorBatch, attempts: row.attempts }));
  }

  markSynced(id: string) {
    this.database.prepare("DELETE FROM queue WHERE id = ?").run(id);
  }

  markFailed(id: string, attempts: number) {
    const retryMinutes = [1, 5, 30, 60][Math.min(attempts, 3)];
    const nextAttemptAt = new Date(Date.now() + retryMinutes * 60_000).toISOString();
    this.database.prepare(`
      UPDATE queue SET attempts = ?, nextAttemptAt = ? WHERE id = ?
    `).run(attempts + 1, nextAttemptAt, id);
  }

  keywordDue(keywordId: string, intervalMinutes: number) {
    const row = this.database.prepare("SELECT lastRunAt FROM keyword_runs WHERE keywordId = ?")
      .get(keywordId) as { lastRunAt?: string } | undefined;
    if (!row?.lastRunAt) return true;
    return Date.now() - new Date(row.lastRunAt).getTime() >= intervalMinutes * 60_000;
  }

  markKeywordRun(keywordId: string) {
    this.database.prepare(`
      INSERT INTO keyword_runs (keywordId, lastRunAt) VALUES (?, ?)
      ON CONFLICT(keywordId) DO UPDATE SET lastRunAt = excluded.lastRunAt
    `).run(keywordId, new Date().toISOString());
  }

  remainingDailySearches(limit: number, now = new Date()) {
    const day = now.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
    const row = this.database.prepare("SELECT searchCount FROM daily_search_usage WHERE day = ?")
      .get(day) as { searchCount?: number } | undefined;
    return Math.max(0, limit - (row?.searchCount || 0));
  }

  recordSearch(now = new Date()) {
    const day = now.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
    this.database.prepare(`
      INSERT INTO daily_search_usage (day, searchCount) VALUES (?, 1)
      ON CONFLICT(day) DO UPDATE SET searchCount = searchCount + 1
    `).run(day);
    this.database.prepare("DELETE FROM daily_search_usage WHERE day < ?").run(
      new Date(now.getTime() - 7 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }),
    );
  }

  trackVideos(videos: CollectedVideo[]) {
    const statement = this.database.prepare(`
      INSERT OR IGNORE INTO tracked_videos (videoId, sourceUrl, publishedAt, nextStage, nextDueAt)
      VALUES (?, ?, ?, 2, ?)
    `);
    for (const video of videos) {
      if (!video.publishedAt) continue;
      statement.run(
        video.videoId,
        video.sourceUrl,
        video.publishedAt,
        new Date(new Date(video.publishedAt).getTime() + 2 * 3_600_000).toISOString(),
      );
    }
  }

  dueTracked(limit = 5): TrackRow[] {
    return this.database.prepare(`
      SELECT videoId, sourceUrl, publishedAt, nextStage, nextDueAt
      FROM tracked_videos WHERE nextDueAt <= ? ORDER BY nextDueAt ASC LIMIT ?
    `).all(new Date().toISOString(), limit) as TrackRow[];
  }

  advanceTracked(videoId: string, currentStage: number, publishedAt: string) {
    const nextStage = currentStage === 2 ? 6 : currentStage === 6 ? 12 : 0;
    if (!nextStage) {
      this.database.prepare("DELETE FROM tracked_videos WHERE videoId = ?").run(videoId);
      return;
    }
    this.database.prepare(`
      UPDATE tracked_videos SET nextStage = ?, nextDueAt = ? WHERE videoId = ?
    `).run(
      nextStage,
      new Date(new Date(publishedAt).getTime() + nextStage * 3_600_000).toISOString(),
      videoId,
    );
  }

  close() {
    this.database.close();
  }
}
