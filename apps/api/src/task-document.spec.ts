import { describe, expect, it } from "vitest";
import { normalizeTaskDocument, taskDocumentFields, taskDocumentText } from "./task-document";

describe("task document", () => {
  it("keeps supported task formatting and extracts searchable text", () => {
    const document = normalizeTaskDocument({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2, style: "color:red" }, content: [{ type: "text", text: "拍摄要求", marks: [{ type: "bold" }] }] },
        {
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "完成正面镜头" }] }] },
          ],
        },
      ],
    });
    expect(document?.content?.[0].attrs).toEqual({ level: 3 });
    expect(taskDocumentText(document)).toContain("拍摄要求");
    expect(taskDocumentText(document)).toContain("☑ 完成正面镜头");
  });

  it("removes images, styles, scripts and unsafe links", () => {
    const document = normalizeTaskDocument({
      type: "doc",
      content: [
        { type: "image", attrs: { src: "data:image/png;base64,xx" } },
        {
          type: "paragraph",
          attrs: { style: "font-size:99px;color:red" },
          content: [
            { type: "text", text: "安全文本", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }, { type: "italic" }] },
          ],
        },
      ],
    });
    expect(document?.content).toHaveLength(1);
    expect(document?.content?.[0].attrs).toBeUndefined();
    expect(document?.content?.[0].content?.[0].marks).toBeUndefined();
  });

  it("supports legacy plain text when no structured document exists", () => {
    expect(taskDocumentFields(null, " 历史任务说明 ").text).toBe("历史任务说明");
  });

  it("does not trust a client summary when a structured document was submitted", () => {
    expect(taskDocumentFields({ type: "image", attrs: { src: "x" } }, "伪造摘要").text).toBe("");
  });
});
