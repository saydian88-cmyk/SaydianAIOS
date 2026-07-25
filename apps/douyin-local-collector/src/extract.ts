import type { CollectedVideo } from "./types";

type JsonRecord = Record<string, unknown>;

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function count(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value);
  const normalized = text(value).replace(/,/gu, "");
  const match = normalized.match(/^([\d.]+)\s*([万亿wWkK]?)$/u);
  if (!match) return undefined;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return undefined;
  const multiplier = match[2] === "万" || /w/iu.test(match[2])
    ? 10_000
    : match[2] === "亿"
      ? 100_000_000
      : /k/iu.test(match[2])
        ? 1_000
        : 1;
  return Math.round(number * multiplier);
}

function url(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.map(url).find(Boolean);
  const result = text(value);
  return /^https?:\/\//iu.test(result) ? result : undefined;
}

function published(value: unknown): string | undefined {
  const number = Number(value);
  if (Number.isFinite(number) && number > 1_000_000_000) {
    return new Date(number > 10_000_000_000 ? number : number * 1000).toISOString();
  }
  const parsed = new Date(text(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function parseDouyinPayload(
  payload: unknown,
  keyword: string,
  capturedAt = new Date(),
): CollectedVideo[] {
  const found = new Map<string, CollectedVideo>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 9 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, depth + 1));
      return;
    }
    if (typeof value !== "object") return;
    const row = value as JsonRecord;
    const video = object(row.aweme_info || row.awemeInfo || row.video_info || row.videoInfo || row);
    const videoId = text(
      video.aweme_id || video.awemeId || video.item_id || video.itemId || video.video_id || video.videoId,
    );
    if (videoId && /^\d{8,}$/u.test(videoId)) {
      const statistics = object(video.statistics || video.stats || row.statistics || row.stats);
      const author = object(video.author || row.author);
      const sourceUrl = text(video.share_url || video.shareUrl || row.link)
        || `https://www.douyin.com/video/${videoId}`;
      const previous = found.get(videoId);
      found.set(videoId, {
        videoId,
        sourceUrl,
        title: text(video.desc || video.title || row.title) || previous?.title,
        description: text(video.desc || row.description) || previous?.description,
        publishedAt: published(video.create_time || video.createTime || row.create_time || row.createTime)
          || previous?.publishedAt,
        capturedAt: capturedAt.toISOString(),
        author: text(author.nickname || author.name || row.nickname) || previous?.author,
        authorId: text(author.sec_uid || author.secUid || author.uid || author.user_id || author.userId)
          || previous?.authorId,
        authorUrl: text(author.sec_uid || author.secUid)
          ? `https://www.douyin.com/user/${text(author.sec_uid || author.secUid)}`
          : previous?.authorUrl,
        avatarUrl: url(object(author.avatar_thumb || author.avatarThumb).url_list || author.avatar_url || author.avatarUrl)
          || previous?.avatarUrl,
        followers: count(author.follower_count || author.followerCount || row.follower_count) ?? previous?.followers,
        views: count(statistics.play_count || statistics.playCount) ?? previous?.views,
        likes: count(statistics.digg_count || statistics.diggCount || statistics.like_count) ?? previous?.likes,
        comments: count(statistics.comment_count || statistics.commentCount) ?? previous?.comments,
        saves: count(statistics.collect_count || statistics.collectCount) ?? previous?.saves,
        shares: count(statistics.share_count || statistics.shareCount) ?? previous?.shares,
        matchedKeywords: [...new Set([...(previous?.matchedKeywords || []), keyword].filter(Boolean))],
        raw: { discovery: "NETWORK_RESPONSE" },
      });
    }
    Object.values(row).forEach((entry) => visit(entry, depth + 1));
  };
  visit(payload, 0);
  return [...found.values()];
}

export function parseRelativePublishedAt(value: string, now = new Date()): string | undefined {
  const textValue = value.trim();
  const minutes = textValue.match(/(\d+)\s*分钟前/u);
  if (minutes) return new Date(now.getTime() - Number(minutes[1]) * 60_000).toISOString();
  const hours = textValue.match(/(\d+)\s*小时前/u);
  if (hours) return new Date(now.getTime() - Number(hours[1]) * 3_600_000).toISOString();
  if (/刚刚/u.test(textValue)) return now.toISOString();
  return undefined;
}

export function withinTwelveHours(item: CollectedVideo, now = new Date()) {
  if (!item.publishedAt) return false;
  const age = (now.getTime() - new Date(item.publishedAt).getTime()) / 3_600_000;
  return age >= -0.25 && age <= 12;
}
