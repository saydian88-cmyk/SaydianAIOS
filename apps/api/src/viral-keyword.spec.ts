import { describe, expect, it } from "vitest";
import { allowedViralKeyword } from "./viral-keyword";

const products = ["赛电智能血压手表W9", "赛电健康心电血糖手环B8"];

describe("allowedViralKeyword", () => {
  it("rejects the Saydian brand and complete product names", () => {
    expect(allowedViralKeyword("赛电W9测评", products)).toBe(false);
    expect(allowedViralKeyword("智能血压手表W9", products)).toBe(false);
    expect(allowedViralKeyword("SAYDIAN 智能手表", products)).toBe(false);
  });

  it("keeps natural category, pain and scene searches", () => {
    expect(allowedViralKeyword("血压手表怎么选", products)).toBe(true);
    expect(allowedViralKeyword("送父母健康礼物", products)).toBe(true);
    expect(allowedViralKeyword("老人不会用智能手表", products)).toBe(true);
  });
});
