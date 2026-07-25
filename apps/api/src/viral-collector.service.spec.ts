import { describe, expect, it } from "vitest";
import { parseCollectorCsv, parseDouyinSearchItems } from "./viral-collector.service";

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

describe("parseDouyinSearchItems", () => {
  it("maps official search results into collector items", () => {
    expect(parseDouyinSearchItems({
      err_no: 0,
      data: {
        data: {
          search_id: "search-1",
          video_list: [{
            item_id: "7471252140422401337",
            title: "智能手表体验",
            nickname: "测试账号",
            create_time: 1739536450,
            statistics: { digg_count: 9254 },
            link: "https://www.douyin.com/video/7471252140422401337",
          }],
        },
      },
    }, "智能手表")).toEqual([expect.objectContaining({
      externalContentId: "7471252140422401337",
      sourceUrl: "https://www.douyin.com/video/7471252140422401337",
      accountName: "测试账号",
      metrics: expect.objectContaining({ likes: 9254, keyword: "智能手表" }),
    })]);
  });
});
