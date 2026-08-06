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
  const title = String(stored.title || "").trim();
  const publishCopy = String(stored.publishCopy || "").trim();
  const tags = Array.isArray(stored.tags) ? stored.tags.map((tag: unknown) => String(tag || "").replace(/^#+/, "").trim()).filter(Boolean) : [];
  return title && publishCopy && pages.length
    ? { status: "READY", groupKey, title, publishCopy, tags, pages }
    : { status: "MISSING", groupKey, title, publishCopy, tags, pages };
}

export function batchImagePreviewPages(project: Record<string, any> | undefined, group: Record<string, unknown>) {
  return batchImageReviewGroup(project, group).pages;
}
