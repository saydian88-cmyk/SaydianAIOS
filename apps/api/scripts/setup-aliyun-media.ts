import "dotenv/config";
import IceClient, {
  CreateCustomTemplateRequest,
  CreatePipelineRequest,
  ListCustomTemplatesRequest,
  ListPipelinesRequest,
} from "@alicloud/ice20201109";
import { Config as OpenApiConfig } from "@alicloud/openapi-client";
import { opsConfig } from "../src/config";

const pipelineName = "saidian-ai-media-shenzhen";
const proxyTemplateName = "saidian-ai-proxy-720p";
const snapshotTemplateName = "saidian-ai-snapshot-3s";

function client() {
  if (!opsConfig.ims.accessKeyId || !opsConfig.ims.accessKeySecret) throw new Error("IMS AccessKey未配置");
  return new IceClient(new OpenApiConfig({
    accessKeyId: opsConfig.ims.accessKeyId,
    accessKeySecret: opsConfig.ims.accessKeySecret,
    regionId: opsConfig.ims.regionId,
    endpoint: opsConfig.ims.endpoint,
  }));
}

async function ensurePipeline(ice: IceClient) {
  const listed = await ice.listPipelines(new ListPipelinesRequest({ speed: "Standard" }));
  const existing = listed.body?.pipelineList?.find((item) => item.name === pipelineName);
  if (existing?.pipelineId) return existing.pipelineId;
  const created = await ice.createPipeline(new CreatePipelineRequest({ name: pipelineName, priority: 6, speed: "Standard" }));
  const id = created.body?.pipeline?.pipelineId;
  if (!id) throw new Error("IMS处理管道创建后未返回ID");
  return id;
}

async function ensureTemplate(ice: IceClient, input: { name: string; type: number; subtype: number; config: Record<string, unknown> }) {
  const listed = await ice.listCustomTemplates(new ListCustomTemplatesRequest({ name: input.name, type: String(input.type), pageNumber: 1, pageSize: 20 }));
  const existing = listed.body?.customTemplateList?.find((item) => item.templateName === input.name);
  if (existing?.templateId) return existing.templateId;
  const created = await ice.createCustomTemplate(new CreateCustomTemplateRequest({
    name: input.name,
    type: input.type,
    subtype: input.subtype,
    templateConfig: JSON.stringify(input.config),
  }));
  const id = created.body?.customTemplate?.templateId;
  if (!id) throw new Error(`${input.name}创建后未返回ID`);
  return id;
}

async function main() {
  if (opsConfig.ims.regionId !== "cn-shenzhen") throw new Error("IMS地域必须为cn-shenzhen");
  const ice = client();
  const pipelineId = await ensurePipeline(ice);
  const proxyTemplateId = await ensureTemplate(ice, {
    name: proxyTemplateName,
    type: 1,
    subtype: 1,
    config: {
      Type: "Normal",
      Container: { Format: "mp4" },
      Video: { Codec: "H.264", Width: 720, Crf: 28, Preset: "fast", PixFmt: "yuv420p" },
      Audio: { Codec: "AAC", Bitrate: 64, Samplerate: 44100, Channels: 2 },
    },
  });
  const snapshotTemplateId = await ensureTemplate(ice, {
    name: snapshotTemplateName,
    type: 2,
    subtype: 1,
    config: { Type: "Normal", FrameType: "intra", Time: 0, Count: 20, Interval: 3, Width: 720 },
  });
  process.stdout.write(`${JSON.stringify({
    region: opsConfig.ims.regionId,
    pipelineId,
    proxyTemplateId,
    snapshotTemplateId,
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
