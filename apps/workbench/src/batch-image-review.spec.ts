import { describe, expect, it } from "vitest";
import { batchImagePreviewPages, batchImageReviewGroup } from "./batch-image-review";

describe("batchImageReviewGroup", () => {
  const project = { variants: [{ metadata: { groups: [{ groupKey: "1-1", title: "真实回传标题", publishCopy: "真实发布文案", tags: ["赛电"], pages: [{ title: "封面", imageUrl: "https://example.com/real.jpg" }] }] } }] };

  it("returns the real result bound to a batch group", () => {
    expect(batchImageReviewGroup(project, { groupKey: "1-1" })).toMatchObject({ status: "READY", title: "真实回传标题", pages: [{ imageUrl: "https://example.com/real.jpg" }] });
  });

  it("reports an absent group as missing instead of inventing copy", () => {
    expect(batchImageReviewGroup(project, { groupKey: "2-1" })).toMatchObject({ status: "MISSING" });
  });

  it("previews only the pages of the selected group", () => {
    const twoGroups = { variants: [{ metadata: { groups: [
      { groupKey: "1-1", title: "甲", publishCopy: "甲文案", pages: [{ title: "甲页", imageUrl: "https://example.com/a.jpg" }] },
      { groupKey: "2-1", title: "乙", publishCopy: "乙文案", pages: [{ title: "乙页", imageUrl: "https://example.com/b.jpg" }] },
    ] } }] };
    expect(batchImagePreviewPages(twoGroups, { groupKey: "2-1" })).toEqual([{ title: "乙页", imageUrl: "https://example.com/b.jpg" }]);
  });
});
