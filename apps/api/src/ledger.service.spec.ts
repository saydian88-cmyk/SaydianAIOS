import { describe, expect, it } from "vitest";
import { parseCsvRecords } from "./ledger.service";

describe("经营快照CSV解析", () => {
  it("支持中文列名、引号和逗号", () => {
    const rows = parseCsvRecords('类型,订单号,状态,发生时间,未获取字段\nORDER,A-1001,PAID,2026-07-22T08:00:00+08:00,"物流单号;发货时间"\nORDER,A-1002,"待处理,需复核",2026-07-22T09:00:00+08:00,');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ 类型: "ORDER", 订单号: "A-1001", 未获取字段: "物流单号;发货时间" });
    expect(rows[1]).toMatchObject({ 状态: "待处理,需复核" });
  });

  it("空表或只有表头时返回空数组", () => {
    expect(parseCsvRecords("类型,订单号\n")).toEqual([]);
  });
});
