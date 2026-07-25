import { describe, expect, it } from "vitest";
import {
  parseCollectorCsv,
  parseDouyinProviderItems,
  parseDouyinSearchItems,
} from "./viral-collector.service";

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

describe("parseDouyinProviderItems", () => {
  it("maps self-hosted and TikHub aweme payloads", () => {
    const items = parseDouyinProviderItems({
      data: {
        aweme_detail: {
          aweme_id: "759900112233",
          desc: "父母健康手表",
          create_time: 1753400000,
          author: { nickname: "健康观察" },
          statistics: {
            play_count: 123456,
            digg_count: 9876,
            comment_count: 432,
            share_count: 123,
          },
          video: {
            play_addr: {
              url_list: ["https://video.example.com/high.mp4"],
            },
          },
        },
      },
    }, "血压手表");

    expect(items).toEqual([expect.objectContaining({
      externalContentId: "759900112233",
      sourceUrl: "https://www.douyin.com/video/759900112233",
      downloadUrl: "https://video.example.com/high.mp4",
      accountName: "健康观察",
      metrics: expect.objectContaining({
        views: 123456,
        likes: 9876,
        comments: 432,
        shares: 123,
        keyword: "血压手表",
      }),
    })]);
  });
});
