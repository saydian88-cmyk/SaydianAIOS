export type BatchResultStatus = "READY" | "FAILED";

export type BatchResult = {
  key: string;
  status: BatchResultStatus;
  assets: string[];
  failureReason: string;
};

export function normalizeBatchResult(expectedKeys: string[], rawItems: Array<Record<string, unknown>>): BatchResult[] {
  return expectedKeys.map((key) => {
    const item = rawItems.find((candidate) => String(candidate.key || candidate.videoKey || candidate.groupKey || "") === key);
    const assets = Array.isArray(item?.assets) ? item.assets.map(String).filter(Boolean) : [];
    const ready = String(item?.status || "").toUpperCase() === "READY" && assets.length > 0;
    return {
      key,
      status: ready ? "READY" : "FAILED",
      assets: ready ? assets : [],
      failureReason: ready ? "" : String(item?.failureReason || "未回传可用成品"),
    };
  });
}
