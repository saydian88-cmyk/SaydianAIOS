import { describe, expect, it } from "vitest";
import { batchImagePreviewPages, batchImageReviewGroup } from "./batch-image-review";

const page = (number: number, group = "real") => ({
  title: `page-${number}`,
  imageUrl: `https://example.com/${group}-${number}.jpg`,
});

describe("batchImageReviewGroup", () => {
  it("returns a five-page batch group as ready", () => {
    const project = { variants: [{ metadata: { groups: [{ groupKey: "1-1", title: "Complete", publishCopy: "Caption", tags: ["SaiDian"], pages: [1, 2, 3, 4, 5].map((number) => page(number)) }] } }] };
    expect(batchImageReviewGroup(project, { groupKey: "1-1" })).toMatchObject({ status: "READY", title: "Complete" });
  });

  it("does not mark a three-page batch group ready", () => {
    const project = { variants: [{ metadata: { groups: [{ groupKey: "1-1", title: "Incomplete", publishCopy: "Caption", pages: [1, 2, 3].map((number) => page(number)) }] } }] };
    expect(batchImageReviewGroup(project, { groupKey: "1-1" }).status).toBe("MISSING");
  });

  it("reports an absent group as missing instead of inventing copy", () => {
    const project = { variants: [{ metadata: { groups: [] } }] };
    expect(batchImageReviewGroup(project, { groupKey: "2-1" })).toMatchObject({ status: "MISSING" });
  });

  it("previews only the pages of the selected group", () => {
    const project = { variants: [{ metadata: { groups: [
      { groupKey: "1-1", title: "A", publishCopy: "A copy", pages: [page(1, "a")] },
      { groupKey: "2-1", title: "B", publishCopy: "B copy", pages: [page(1, "b")] },
    ] } }] };
    expect(batchImagePreviewPages(project, { groupKey: "2-1" })).toEqual([page(1, "b")]);
  });

  it("does not mark a group ready when its image is reused by another group", () => {
    const duplicatePages = [1, 2, 3, 4, 5].map((number) => page(number, "same"));
    const project = { variants: [{ metadata: { groups: [
      { groupKey: "1-1", title: "A", publishCopy: "A copy", pages: duplicatePages },
      { groupKey: "2-1", title: "B", publishCopy: "B copy", pages: duplicatePages },
    ] } }] };
    expect(batchImageReviewGroup(project, { groupKey: "1-1" }).status).toBe("MISSING");
  });
});
