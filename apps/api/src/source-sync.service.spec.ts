import { describe, expect, it } from "vitest";
import { ossLibraryPrefix, packagingCategoryFromPath } from "./source-sync.service";

describe("OSS 素材目录登记", () => {
  it("只使用固定的品牌素材和包装资源目录", () => {
    expect(ossLibraryPrefix("EDITING_FOOTAGE")).toBe("brand-assets/赛电品牌素材库/");
    expect(ossLibraryPrefix("PACKAGING_RESOURCE")).toBe("brand-assets/包装资源包/");
  });

  it.each([
    ["brand-assets/包装资源包/BGM/music.mp3", "BGM"],
    ["brand-assets/包装资源包/音效/最全音效素材01/click.wav", "SOUND_EFFECT"],
    ["brand-assets/包装资源包/贴纸素材/arrow.png", "STICKER"],
    ["brand-assets/包装资源包/字体/font.ttf", "FONT"],
    ["brand-assets/包装资源包/品牌元素/logo.png", "BRAND_ELEMENT"],
    ["brand-assets/包装资源包/授权资料/license.pdf", "LICENSE_DOCUMENT"],
    ["brand-assets/包装资源包/文字特效/title.mov", "TEXT_EFFECT"],
    ["brand-assets/包装资源包/视频特效/transition.mp4", "VIDEO_EFFECT"],
  ])("将 %s 分类为 %s", (path, category) => {
    expect(packagingCategoryFromPath(path)).toBe(category);
  });
});
