import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const [mode, inputPath, outputDir] = process.argv.slice(2);
if (!mode || !inputPath || !outputDir) {
  throw new Error("用法: node import-workbooks.mjs <evidence|material-sop> <input.xlsx> <output-dir>");
}

const input = await FileBlob.load(inputPath);
const workbook = await SpreadsheetFile.importXlsx(input);
await fs.mkdir(outputDir, { recursive: true });

function rows(sheetName) {
  const sheet = workbook.worksheets.getItem(sheetName);
  const values = sheet.getUsedRange(true)?.values ?? [];
  if (values.length < 2) return [];
  const headers = values[0].map((value) => String(value ?? "").trim());
  return values.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null])));
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function evidenceType(name) {
  if (/注册证/.test(name)) return "医疗注册";
  if (/备案/.test(name)) return "经营备案";
  if (/检验|检测|报告/.test(name)) return "第三方检验";
  if (/授权|委托生产|协议/.test(name)) return "生产或品牌关系";
  if (/保险|承保/.test(name)) return "保险资料";
  if (/CCTV|广告|播出/.test(name)) return "历史广告";
  return "品牌资料";
}

if (mode === "evidence") {
  const evidence = rows("宣传证据表").map((row) => ({
    id: text(row["编号"]),
    name: text(row["证据名称"]),
    evidenceType: evidenceType(text(row["证据名称"])),
    entityIdentifier: text(row["编号/主体"]),
    coveredObject: text(row["适用范围"]),
    confirmedFact: text(row["允许表述"]),
    publicWording: text(row["允许表述"]),
    internalRestriction: text(row["禁止扩展"]),
    status: text(row["当前状态"]),
    validityText: text(row["有效期/日期"]),
    source: text(row["原件位置"]),
  })).filter((row) => row.id);

  const mappings = rows("型号映射").map((row) => ({
    commercialName: text(row["商品名称"]),
    pageFacts: text(row["官网外观/功能资料"]),
    nameplateModel: text(row["包装/铭牌型号"]),
    registeredModel: text(row["对应注册型号"]),
    registrationNumber: text(row["注册证"]),
    productionRelation: text(row["生产/品牌授权"]),
    status: text(row["发布状态"]),
    requiredAction: text(row["发布前动作"]),
  })).filter((row) => row.commercialName);

  const phraseRules = rows("表述词库").flatMap((row) => {
    const blocked = text(row["高风险/禁用表述"]);
    return blocked.split(/[、，,]/).map((item) => item.trim()).filter(Boolean).map((item) => ({
      category: text(row["类别"]),
      blockedText: item,
      replacement: text(row["建议替代表述"]),
      condition: text(row["使用条件"]),
    }));
  });

  const assetSeeds = rows("素材台账").map((row) => ({
    name: text(row["素材"]),
    purpose: text(row["用途"]),
    status: text(row["状态"]),
    restriction: text(row["限制/备注"]),
    source: text(row["路径或链接"]),
  })).filter((row) => row.name);

  await Promise.all([
    fs.writeFile(path.join(outputDir, "evidence.json"), JSON.stringify(evidence, null, 2), "utf8"),
    fs.writeFile(path.join(outputDir, "product-mappings.json"), JSON.stringify(mappings, null, 2), "utf8"),
    fs.writeFile(path.join(outputDir, "phrase-rules.json"), JSON.stringify(phraseRules, null, 2), "utf8"),
    fs.writeFile(path.join(outputDir, "asset-seeds.json"), JSON.stringify(assetSeeds, null, 2), "utf8"),
  ]);
  process.stdout.write(JSON.stringify({ evidence: evidence.length, mappings: mappings.length, phraseRules: phraseRules.length, assetSeeds: assetSeeds.length }));
} else if (mode === "material-sop") {
  const tasks = rows("Sheet1").map((row) => ({
    category: text(row["模块分类"]),
    task: text(row["具体任务内容"]),
    standard: text(row["产出形式/标准"]),
    owner: text(row["负责人"]),
  })).filter((row) => row.category || row.task || row.standard);
  await fs.writeFile(path.join(outputDir, "asset-sop-tasks.json"), JSON.stringify(tasks, null, 2), "utf8");
  process.stdout.write(JSON.stringify({ tasks: tasks.length }));
} else {
  throw new Error(`不支持的导入模式: ${mode}`);
}

