export type TaskDocument = {
  type: "doc";
  content?: TaskDocumentNode[];
};

type TaskDocumentMark = {
  type: "bold" | "link";
  attrs?: { href?: string; target?: string; rel?: string };
};

type TaskDocumentNode = {
  type: string;
  attrs?: Record<string, unknown>;
  marks?: TaskDocumentMark[];
  text?: string;
  content?: TaskDocumentNode[];
};

const containerNodes = new Set(["doc", "paragraph", "bulletList", "orderedList", "listItem", "taskList", "taskItem"]);
const allowedProtocols = new Set(["http:", "https:", "mailto:"]);
const maxDocumentLength = 100_000;
const maxDepth = 20;

function safeLink(href: unknown) {
  if (typeof href !== "string" || href.length > 2_048) return "";
  try {
    const url = new URL(href);
    return allowedProtocols.has(url.protocol) ? href : "";
  } catch {
    return "";
  }
}

function cleanContent(input: unknown, depth: number): TaskDocumentNode[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((child): TaskDocumentNode[] => {
    const cleaned = cleanNode(child, depth + 1);
    return cleaned ? [cleaned] : [];
  });
}

function cleanNode(input: unknown, depth = 0): TaskDocumentNode | null {
  if (!input || typeof input !== "object" || depth > maxDepth) return null;
  const node = input as Record<string, unknown>;
  const type = typeof node.type === "string" ? node.type : "";

  if (type === "text") {
    const text = typeof node.text === "string" ? node.text : "";
    if (!text) return null;
    const marks = Array.isArray(node.marks)
      ? node.marks.flatMap((raw): TaskDocumentMark[] => {
          if (!raw || typeof raw !== "object") return [];
          const mark = raw as Record<string, unknown>;
          if (mark.type === "bold") return [{ type: "bold" }];
          if (mark.type !== "link") return [];
          const attrs = mark.attrs && typeof mark.attrs === "object" ? (mark.attrs as Record<string, unknown>) : {};
          const href = safeLink(attrs.href);
          return href ? [{ type: "link", attrs: { href, target: "_blank", rel: "noopener noreferrer nofollow" } }] : [];
        })
      : [];
    return { type, text, ...(marks.length ? { marks } : {}) };
  }

  if (type === "hardBreak") return { type };
  if (type === "heading") {
    const level = Number((node.attrs as Record<string, unknown> | undefined)?.level);
    const content = cleanContent(node.content, depth);
    return { type, attrs: { level: level === 4 ? 4 : 3 }, ...(content.length ? { content } : {}) };
  }
  if (!containerNodes.has(type)) return null;
  const content = cleanContent(node.content, depth);
  if (type === "taskItem") {
    return { type, attrs: { checked: Boolean((node.attrs as Record<string, unknown> | undefined)?.checked) }, ...(content.length ? { content } : {}) };
  }
  return { type, ...(content.length ? { content } : {}) };
}

export function normalizeTaskDocument(input: unknown): TaskDocument | null {
  if (!input || typeof input !== "object") return null;
  if (JSON.stringify(input).length > maxDocumentLength) return null;
  const cleaned = cleanNode(input);
  return cleaned?.type === "doc" ? (cleaned as TaskDocument) : null;
}

export function taskDocumentText(document: TaskDocument | null) {
  if (!document) return "";
  const blocks: string[] = [];
  const visit = (node: TaskDocumentNode) => {
    if (node.type === "text") return blocks.push(node.text || "");
    if (node.type === "hardBreak") return blocks.push("\n");
    if (node.type === "listItem") blocks.push("• ");
    if (node.type === "taskItem") blocks.push(`${node.attrs?.checked ? "☑" : "☐"} `);
    node.content?.forEach(visit);
    if (["paragraph", "heading", "listItem", "taskItem"].includes(node.type)) blocks.push("\n");
  };
  document.content?.forEach(visit);
  return blocks.join("").replace(/\n{3,}/g, "\n\n").trim();
}

export function taskDocumentFields(documentInput: unknown, legacyText: unknown) {
  const hasDocumentInput = documentInput !== undefined && documentInput !== null;
  const document = normalizeTaskDocument(documentInput);
  const fallback = typeof legacyText === "string" ? legacyText.trim() : "";
  return { document, text: document ? taskDocumentText(document) : hasDocumentInput ? "" : fallback };
}
