import { describe, expect, it } from "vitest";
import { parseOperationCsv } from "./operation-analysis.service";

describe("operation analysis import", () => {
  it("parses Chinese Jushuitan headers and quoted values", () => {
    const rows = parseOperationCsv([
      "渠道名称,销售金额,销售订单数,备注",
      "\"赛电天猫旗舰店-zy\",\"¥66,058.43\",75,\"组合商品,待核对\"",
    ].join("\r\n"));
    expect(rows).toEqual([{
      渠道名称: "赛电天猫旗舰店-zy",
      销售金额: "¥66,058.43",
      销售订单数: "75",
      备注: "组合商品,待核对",
    }]);
  });

  it("ignores empty lines without shifting columns", () => {
    const rows = parseOperationCsv("店铺,销售金额\n\n京东官方旗舰店,80797.68\n");
    expect(rows).toHaveLength(1);
    expect(rows[0].店铺).toBe("京东官方旗舰店");
  });
});
