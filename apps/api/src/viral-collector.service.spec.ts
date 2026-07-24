import { describe, expect, it } from "vitest";
import { parseCollectorCsv } from "./viral-collector.service";

describe("parseCollectorCsv", () => {
  it("parses Chinese headers and quoted commas", () => {
    const rows = parseCollectorCsv([
      "视频链接,账号,标题,播放量,点赞量",
      "\"https://example.com/video/1\",赛电观察,\"父母健康,正确测量\",\"12,345\",345",
    ].join("\n"));

    expect(rows).toEqual([{
      视频链接: "https://example.com/video/1",
      账号: "赛电观察",
      标题: "父母健康,正确测量",
      播放量: "12,345",
      点赞量: "345",
    }]);
  });

  it("supports UTF-8 BOM and CRLF", () => {
    const rows = parseCollectorCsv("\uFEFFsourceUrl,title\r\nhttps://example.com/a,测试\r\n");
    expect(rows).toEqual([{ sourceUrl: "https://example.com/a", title: "测试" }]);
  });
});
