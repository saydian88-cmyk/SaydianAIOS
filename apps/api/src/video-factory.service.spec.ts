import { BadRequestException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptIntegrationValue } from "./integration-secret";
import { materialReviewApproved, VideoFactoryService } from "./video-factory.service";

afterEach(() => vi.unstubAllGlobals());

describe("material review gate", () => {
  it("accepts only the approved current workflow and binding fingerprint", () => {
    const plan = {
      workflowVersion: 4,
      sourceSignals: [{
        type: "VIDEO_FACTORY",
        materialReview: {
          status: "APPROVED",
          workflowVersion: 4,
          bindingFingerprint: "shot-1:asset-1:0:3",
        },
      }],
    };
    expect(materialReviewApproved(plan, "shot-1:asset-1:0:3")).toBe(true);
    expect(materialReviewApproved(plan, "shot-1:asset-2:0:3")).toBe(false);
    expect(materialReviewApproved({ ...plan, workflowVersion: 5 }, "shot-1:asset-1:0:3")).toBe(false);
  });
});

describe("VideoFactoryService model routing", () => {
  let prisma: Record<string, any>;
  let service: VideoFactoryService;

  beforeEach(() => {
    prisma = {
      videoModelConfig: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      videoRoutingPolicy: {
        findFirst: vi.fn(),
      },
      videoModelProvider: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      contentPlan: {
        count: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      contentVariant: {
        updateMany: vi.fn(),
      },
      aiTask: {
        count: vi.fn(),
        updateMany: vi.fn(),
      },
      videoGenerationJob: {
        count: vi.fn(),
        updateMany: vi.fn(),
      },
      asset: {
        findUnique: vi.fn(),
      },
      contentAsset: {
        findMany: vi.fn(),
      },
      videoRenderJob: {
        count: vi.fn(),
        updateMany: vi.fn(),
        upsert: vi.fn(),
      },
      videoQualityCheck: {
        updateMany: vi.fn(),
      },
      approval: {
        create: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      opsTask: {
        updateMany: vi.fn(),
      },
      $transaction: vi.fn().mockResolvedValue([]),
    };
    service = new VideoFactoryService(prisma as never, {} as never, {} as never, {} as never, {} as never);
    vi.spyOn(service, "ensureCatalog").mockResolvedValue();
  });

  it("rejects an unavailable fixed model without silently replacing it", async () => {
    prisma.videoModelConfig.findFirst.mockResolvedValue(null);

    await expect(service.resolveModel({
      requestedModelId: "disabled-model",
      platform: "TIKTOK",
      capability: "IMAGE_TO_VIDEO",
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.videoModelConfig.findMany).not.toHaveBeenCalled();
  });

  it("keeps configured policy order for AUTO primary and fallbacks", async () => {
    prisma.videoRoutingPolicy.findFirst.mockResolvedValue({
      primaryModelId: "runway",
      fallbackModelIds: ["wan"],
    });
    prisma.videoModelConfig.findMany.mockResolvedValue([
      { id: "wan", priority: 10, provider: { code: "BAILIAN_WAN" } },
      { id: "runway", priority: 20, provider: { code: "RUNWAY" } },
    ]);

    const result = await service.resolveModel({
      platform: "TIKTOK",
      capability: "IMAGE_TO_VIDEO",
    });

    expect(result.primary.id).toBe("runway");
    expect(result.fallbacks.map((item) => item.id)).toEqual(["wan"]);
  });

  it("never returns encrypted provider credentials", async () => {
    prisma.videoModelProvider.findMany.mockResolvedValue([{
      id: "provider-1",
      code: "RUNWAY",
      displayName: "Runway",
      secretRef: "encrypted-secret",
      models: [],
    }]);

    const result = await service.providers();

    expect(result[0]).toMatchObject({ code: "RUNWAY", secretConfigured: true });
    expect(result[0]).not.toHaveProperty("secretRef");
  });

  it("checks Seedance credentials without creating a paid generation task", async () => {
    prisma.videoModelProvider.findUnique.mockResolvedValue({
      id: "seedance-provider",
      code: "VOLCENGINE_SEEDANCE",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      publicConfig: {},
      secretRef: encryptIntegrationValue(JSON.stringify({ apiKey: "ark-key" })),
    });
    prisma.videoModelProvider.update.mockImplementation(({ data }: any) => Promise.resolve({
      id: "seedance-provider",
      code: "VOLCENGINE_SEEDANCE",
      secretRef: "encrypted",
      ...data,
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 404 }));

    const result = await service.checkProvider("seedance-provider", "admin");

    expect(result).toMatchObject({ state: "HEALTHY", secretConfigured: true });
    expect(fetch).toHaveBeenCalledWith(
      "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/__saydian_connection_check__",
      expect.objectContaining({ headers: { Authorization: "Bearer ark-key" } }),
    );
  });

  it("serializes nested asset BigInt fields in project lists", async () => {
    prisma.contentPlan.findMany.mockResolvedValue([{
      id: "project-1",
      videoShots: [{ selectedAsset: { id: "asset-1", sizeBytes: 1024n } }],
    }]);

    const result = await service.projects({});

    expect(result[0].videoShots[0].selectedAsset?.sizeBytes).toBe("1024");
  });

  it("projects returned master videos as ready to edit instead of generating", async () => {
    prisma.contentPlan.findMany.mockResolvedValue([{
      id: "project-returned",
      productionStage: "FACTORY_GENERATING",
      videoRenderJobs: [{
        status: "SUCCEEDED",
        outputAsset: { id: "asset-1", reviewStatus: "RETURNED" },
      }],
      aiTaskOutputs: [],
      videoShots: [],
    }]);

    const result = await service.projects({});

    expect(result[0].productionStage).toBe("READY_TO_EDIT");
  });

  it("keeps downstream packaging and tracking stages after the master is approved", async () => {
    prisma.contentPlan.findMany.mockResolvedValue([{
      id: "project-tracking",
      productionStage: "TRACKING",
      videoRenderJobs: [{
        status: "SUCCEEDED",
        outputAsset: { id: "asset-1", reviewStatus: "APPROVED" },
      }],
      aiTaskOutputs: [],
      videoShots: [],
    }]);

    const result = await service.projects({});

    expect(result[0].productionStage).toBe("TRACKING");
  });

  it("projects completed Codex script outputs into script review for legacy records", async () => {
    prisma.contentPlan.findMany.mockResolvedValue([{
      id: "project-script-complete",
      productionStage: "SCRIPT_GENERATING",
      videoRenderJobs: [],
      aiTaskOutputs: [{
        kind: "VIDEO_PROJECT",
        aiTask: { status: "COMPLETED" },
      }],
      videoShots: [],
    }]);

    const result = await service.projects({});

    expect(result[0].productionStage).toBe("FACTORY_SCRIPT_READY");
  });

  it("archives a project and cancels linked AI, generation, render, and employee tasks", async () => {
    prisma.contentPlan.findUnique.mockResolvedValue({
      id: "project-delete",
      kind: "VIDEO",
      createdBy: "运营甲",
      productionStage: "SCRIPT_GENERATING",
      sourceSignals: [{ type: "VIDEO_FACTORY" }],
    });
    prisma.aiTask.count.mockResolvedValue(1);
    prisma.videoGenerationJob.count.mockResolvedValue(2);
    prisma.videoRenderJob.count.mockResolvedValue(1);

    const result = await service.archiveProject("project-delete", "运营甲");

    expect(result).toMatchObject({
      archived: true,
      cancelledAiTasks: 1,
      cancelledGenerationJobs: 2,
      cancelledRenderJobs: 1,
    });
    expect(prisma.aiTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "CANCELLED" }),
    }));
    expect(prisma.videoGenerationJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "CANCELLED" }),
    }));
    expect(prisma.videoRenderJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "CANCELLED" }),
    }));
    expect(prisma.opsTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "CANCELLED" }),
    }));
  });

  it("keeps a single-project script task in the dedicated generating stage", async () => {
    prisma.contentPlan.findUnique.mockResolvedValue({
      id: "single-project",
      workflowVersion: 4,
      productionStage: "SCRIPT_GENERATING",
      sourceSignals: [{ type: "VIDEO_FACTORY", lastTaskMode: "SCRIPT_ONLY", scriptCandidates: [] }],
    });

    const result = await service.syncProjectTaskState("single-project", "RUNNING");

    expect(result?.productionStage).toBe("SCRIPT_GENERATING");
    expect(prisma.contentPlan.update).not.toHaveBeenCalled();
  });

  it("keeps line ids and material bindings for punctuation-only script edits", async () => {
    prisma.contentPlan.findUnique.mockResolvedValue({
      id: "project-script",
      topic: "原标题",
      hook: "原钩子",
      productionStage: "FACTORY_SCRIPT_READY",
      sourceSignals: [{
        type: "VIDEO_FACTORY",
        selectedCandidateIndex: 0,
        scriptCandidates: [{
          title: "原标题",
          hook: "原钩子",
          script: "消息来了抬腕看",
          scripts: {},
          shots: [{ lineId: "line_01", voiceover: "消息来了抬腕看", selectedAssetIds: ["asset-1"] }],
          scriptPackage: {
            voiceoverLines: [{ lineId: "line_01", text: "消息来了抬腕看" }],
            shotRequirements: [{ lineId: "line_01", line: "消息来了抬腕看", assetStatus: "COVERED" }],
          },
        }],
      }],
    });
    prisma.contentPlan.update.mockResolvedValue({});
    prisma.contentVariant.updateMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.create.mockResolvedValue({});

    await service.updateDraftScript("project-script", {
      title: "原标题", hook: "原钩子", script: "消息来了，抬腕看。",
      coreTheme: "", communicationGoal: "", userPainPoint: "", uniqueSellingPoint: "",
      voiceoverLines: ["消息来了，抬腕看。"], retentionDesign: [], subtitles: [], emphasisTexts: [],
      endingSummary: "", endingInteraction: "", endingVisual: "",
    }, "测试用户");

    const signals = prisma.contentPlan.update.mock.calls[0][0].data.sourceSignals;
    const candidate = signals[0].scriptCandidates[0];
    expect(candidate.shots[0]).toMatchObject({ lineId: "line_01", selectedAssetIds: ["asset-1"] });
    expect(candidate.script).toBe("消息来了，抬腕看。");
  });

  it("marks meaning-changed script lines for material rematching", async () => {
    prisma.contentPlan.findUnique.mockResolvedValue({
      id: "project-script",
      topic: "原标题",
      hook: "原钩子",
      productionStage: "FACTORY_SCRIPT_READY",
      sourceSignals: [{
        type: "VIDEO_FACTORY",
        selectedCandidateIndex: 0,
        materialReview: { status: "APPROVED" },
        scriptCandidates: [{
          title: "原标题",
          hook: "原钩子",
          script: "消息来了抬腕看",
          scripts: {},
          shots: [{ lineId: "line_01", voiceover: "消息来了抬腕看", selectedAssetIds: ["asset-1"] }],
          scriptPackage: {
            voiceoverLines: [{ lineId: "line_01", text: "消息来了抬腕看" }],
            shotRequirements: [{ lineId: "line_01", line: "消息来了抬腕看", assetStatus: "COVERED" }],
          },
        }],
      }],
    });
    prisma.contentPlan.update.mockResolvedValue({});
    prisma.contentVariant.updateMany.mockResolvedValue({ count: 1 });
    prisma.auditLog.create.mockResolvedValue({});

    await service.updateDraftScript("project-script", {
      title: "原标题", hook: "原钩子", script: "电话来了腕上接",
      coreTheme: "", communicationGoal: "", userPainPoint: "", uniqueSellingPoint: "",
      voiceoverLines: ["电话来了腕上接"], retentionDesign: [], subtitles: [], emphasisTexts: [],
      endingSummary: "", endingInteraction: "", endingVisual: "",
    }, "测试用户");

    const factory = prisma.contentPlan.update.mock.calls[0][0].data.sourceSignals[0];
    expect(factory.materialReview).toMatchObject({ status: "PENDING", invalidatedReason: "SCRIPT_EDITED" });
    expect(factory.scriptCandidates[0].shots[0]).toMatchObject({
      lineId: "line_01",
      selectedAssetIds: [],
      missingReason: "脚本文案已修改，需要重新匹配并确认素材",
    });
    expect(factory.scriptCandidates[0].scriptPackage.shotRequirements[0].assetStatus).toBe("REWRITABLE");
    expect(factory.selectedCandidateIndex).toBe(0);
    expect(factory.scriptRevisionHistory).toHaveLength(1);
    expect(factory.scriptRevisionHistory[0]).toMatchObject({
      revision: 1,
      candidateIndex: 0,
      editedBy: expect.any(String),
      lines: [{
        lineId: "line_01",
        beforeAssetIds: ["asset-1"],
        afterAssetIds: [],
        materialBindingChanged: true,
        materialMatchStatus: "MISSING",
      }],
    });
    expect(factory.scriptRevisionHistory[0].lines[0].beforeText).not.toBe(
      factory.scriptRevisionHistory[0].lines[0].afterText,
    );
  });

  it("returns a failed single-project script task to the project brief", async () => {
    prisma.contentPlan.findUnique.mockResolvedValue({
      id: "single-project",
      workflowVersion: 4,
      productionStage: "SCRIPT_GENERATING",
      sourceSignals: [{ type: "VIDEO_FACTORY", lastTaskMode: "SCRIPT_ONLY", scriptCandidates: [] }],
    });
    prisma.contentPlan.update.mockResolvedValue({ id: "single-project", productionStage: "PROJECT_BRIEF" });

    const result = await service.syncProjectTaskState("single-project", "FAILED");

    expect(result?.productionStage).toBe("PROJECT_BRIEF");
    expect(prisma.contentPlan.update).toHaveBeenCalledWith({
      where: { id: "single-project" },
      data: { productionStage: "PROJECT_BRIEF" },
    });
  });

  it("returns the review master with a topic card so the admin can preview it", async () => {
    prisma.contentPlan.findUnique.mockResolvedValue({
      id: "topic-card-1",
      productionStage: "VIDEO_REVIEW",
      sourceSignals: [{ type: "VIDEO_TOPIC_CARD", card: { cardNo: "VTC-1" } }],
      videoRenderJobs: [{
        status: "SUCCEEDED",
        outputAsset: { id: "asset-master", reviewStatus: "PENDING", width: 1080, height: 1920 },
      }],
      aiTaskOutputs: [],
    });

    const result = await service.topicCard("topic-card-1");

    expect(result.productionStage).toBe("VIDEO_REVIEW");
    expect(result.videoRenderJobs[0].outputAsset).toMatchObject({
      id: "asset-master",
      width: 1080,
      height: 1920,
    });
  });

  it("does not mix the default keyword pool into a viral-reference project", async () => {
    prisma.product = { findUnique: vi.fn().mockResolvedValue({ id: "product-c1", modelCode: "C1" }) };
    prisma.smartKeyword = { findMany: vi.fn().mockResolvedValue([{ id: "keyword-bp", keyword: "爸妈不愿意测血压" }]) };
    prisma.knowledgeEntry = { findMany: vi.fn().mockResolvedValue([]) };
    prisma.asset = { findMany: vi.fn().mockResolvedValue([]) };
    prisma.externalVideo = {
      findMany: vi.fn().mockResolvedValue([{
        id: "viral-1",
        platform: "DOUYIN",
        title: "固态电芯加持，告别充电宝安全焦虑 自用一段时间，和普通充电宝差距很明显。",
        transcript: "",
        moduleSummary: null,
        analysis: null,
      }]),
    };
    prisma.opsTask = { findFirst: vi.fn() };

    const context = await (service as any).buildContext({
      platform: "DOUYIN",
      productModel: "C1",
      topic: "参考结构：不应覆盖外部爆款标题",
      externalVideoIds: ["viral-1"],
    });

    expect(context.keywords).toEqual([]);
    expect(context.topic).toBe("固态电芯加持，告别充电宝安全焦虑");
    expect(prisma.smartKeyword.findMany).not.toHaveBeenCalled();
  });

  it("registers a Codex local master as a successful video factory render", async () => {
    prisma.asset.findUnique.mockResolvedValue({
      id: "asset-master",
      storageUrl: "https://oss.example/master.mp4",
      sourcePath: "C:\\tasks\\master.mp4",
      createdAt: new Date("2026-07-28T00:00:00.000Z"),
    });
    prisma.videoRenderJob.upsert.mockResolvedValue({ id: "render-local" });

    const result = await service.registerLocalMaster("plan-1", "asset-master", "task-1", "Codex执行器");

    expect(result.id).toBe("render-local");
    expect(prisma.videoRenderJob.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        contentPlanId: "plan-1",
        status: "SUCCEEDED",
        renderer: "CODEX_LOCAL_FFMPEG",
        outputAssetId: "asset-master",
      }),
    }));
    expect(prisma.videoQualityCheck.updateMany).toHaveBeenCalledWith({
      where: { contentPlanId: "plan-1", assetId: "asset-master", renderJobId: null },
      data: { renderJobId: "render-local" },
    });
    expect(prisma.contentPlan.update).toHaveBeenCalledWith({
      where: { id: "plan-1" },
      data: { masterVideoPath: "https://oss.example/master.mp4" },
    });
  });

  it("records the script candidate selected by the employee during approval", async () => {
    prisma.contentPlan.findUnique.mockResolvedValue({
      id: "project-dual-engine",
      workflowVersion: 4,
      productionStage: "FACTORY_SCRIPT_READY",
      sourceSignals: [{
        type: "VIDEO_FACTORY",
        selectedCandidateIndex: 0,
        brief: { scriptEngines: ["REMOTE_CODEX", "SYSTEM_AI"] },
        scriptEngineStatus: { REMOTE_CODEX: "COMPLETED", SYSTEM_AI: "COMPLETED" },
        scriptCandidates: [
          { title: "Remote Codex script" },
          { title: "System AI script" },
        ],
      }],
    });
    vi.spyOn(service, "project").mockResolvedValue({ id: "project-dual-engine" } as never);

    await service.reviewScript("project-dual-engine", true, "", "employee", 1);

    expect(prisma.contentPlan.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "project-dual-engine" },
      data: expect.objectContaining({
        productionStage: "SCRIPT_APPROVED",
        sourceSignals: [expect.objectContaining({
          type: "VIDEO_FACTORY",
          selectedCandidateIndex: 1,
        })],
      }),
    }));
  });

  it("does not allow script review while any requested engine is unfinished", async () => {
    prisma.contentPlan.findUnique.mockResolvedValue({
      id: "project-waiting-system-ai",
      workflowVersion: 4,
      productionStage: "SCRIPT_GENERATING",
      sourceSignals: [{
        type: "VIDEO_FACTORY",
        brief: { scriptEngines: ["REMOTE_CODEX", "SYSTEM_AI"] },
        scriptEngineStatus: { REMOTE_CODEX: "COMPLETED", SYSTEM_AI: "RUNNING" },
        scriptCandidates: [{ title: "Remote Codex script" }],
      }],
    });

    await expect(service.reviewScript(
      "project-waiting-system-ai",
      true,
      "",
      "employee",
      0,
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.contentPlan.update).not.toHaveBeenCalled();
  });

  it("preserves material IDs returned with each generated script line", async () => {
    const result = await (service as any).preMatchScriptCandidate({
      topic: "W9S素材优先脚本",
      audience: "给父母挑健康手表的人",
      objective: "展示气囊测量过程",
      hook: "先看腕带会不会动",
      outline: ["启动后气囊开始变化"],
      score: 90,
      scoreBreakdown: {},
      assetIds: [],
      referenceIds: [],
      missingAssets: [],
      titleZh: "先看腕带会不会动",
      titleEn: "",
      coverTextZh: "",
      coverTextEn: "",
      hashtags: [],
      scripts: { zh15: "", en15: "", zh30: "", en30: "" },
      scriptPackage: {
        voiceoverLines: [{
          lineId: "line_01",
          text: "启动后气囊开始变化",
          durationSeconds: 4,
        }],
        shotRequirements: [{
          lineId: "line_01",
          line: "启动后气囊开始变化",
          visual: "佩戴近景，完整展示气囊变化",
          matchedVideoAssetIds: ["video-1"],
          auxiliaryImageAssetIds: ["image-1"],
          assetStatus: "COVERED",
          factualProof: "真实操作视频",
          audioVisualRequirement: "动作完整",
        }],
      },
    }, [
      {
        id: "video-1",
        kind: "VIDEO",
        displayName: "W9S气囊测量.mp4",
        contentDescription: "佩戴后启动测量，气囊完整变化",
        tags: [],
      },
      {
        id: "image-1",
        kind: "IMAGE",
        displayName: "W9S结构图.jpg",
        contentDescription: "气囊表带结构",
        tags: [],
      },
    ]);

    expect(result.shots[0].selectedAssetIds).toEqual(["video-1"]);
    expect(result.shots[0].auxiliaryImageAssetIds).toEqual(["image-1"]);
    expect(result.shots[0].materialMatchStatus).toBe("COVERED");
    expect(result.scriptPackage.shotRequirements[0].matchedVideoAssetIds).toEqual(["video-1"]);
    expect(result.scriptPackage.shotRequirements[0].auxiliaryImageAssetIds).toEqual(["image-1"]);
    expect(result.missingAssets).toEqual([]);
  });
});
