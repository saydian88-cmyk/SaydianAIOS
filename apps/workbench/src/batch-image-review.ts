export type BatchImageReviewGroup = {
  status: "READY" | "MISSING";
  groupKey: string;
  title: string;
  publishCopy: string;
  tags: string[];
  pages: Array<Record<string, unknown>>;
};

export function batchImageReviewGroup(project: Record<string, any> | undefined, group: Record<string, unknown>): BatchImageReviewGroup {
  const groupKey = String(group.groupKey || "");
  const variant = Array.isArray(project?.variants) ? project.variants[0] : undefined;
  const stored = Array.isArray(variant?.metadata?.groups)
    ? variant.metadata.groups.find((item: Record<string, unknown>) => String(item.groupKey || "") === groupKey)
    : undefined;
  if (!stored) return { status: "MISSING", groupKey, title: "", publishCopy: "", tags: [], pages: [] };
  const pages = Array.isArray(stored.pages) ? stored.pages : [];
  const otherGroups = Array.isArray(variant?.metadata?.groups)
    ? variant.metadata.groups.filter((item: Record<string, unknown>) => String(item.groupKey || "") !== groupKey)
    : [];
  const pageSources = new Set(pages.map((page: Record<string, unknown>) => String(page.imageAssetId || page.imageUrl || page.downloadUrl || "").trim()).filter(Boolean));
  const hasRealPages = pages.length > 0 && pageSources.size === pages.length;
  const reused = otherGroups.some((other: Record<string, unknown>) => Array.isArray(other.pages)
    && other.pages.some((page: Record<string, unknown>) => pageSources.has(String(page.imageAssetId || page.imageUrl || page.downloadUrl || "").trim())));
  const title = String(stored.title || "").trim();
  const publishCopy = String(stored.publishCopy || "").trim();
  const tags = Array.isArray(stored.tags) ? stored.tags.map((tag: unknown) => String(tag || "").replace(/^#+/, "").trim()).filter(Boolean) : [];
  return String(stored.status || "READY").toUpperCase() !== "FAILED" && title && publishCopy && hasRealPages && !reused
    ? { status: "READY", groupKey, title, publishCopy, tags, pages }
    : { status: "MISSING", groupKey, title, publishCopy, tags, pages };
}

export function batchImagePreviewPages(project: Record<string, any> | undefined, group: Record<string, unknown>) {
  return batchImageReviewGroup(project, group).pages;
}
