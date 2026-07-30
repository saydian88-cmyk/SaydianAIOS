type JsonRecord = Record<string, unknown>;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function rows(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

export const BAILIAN_VIDEO_SCRIPT_SYSTEM_POLICY = `
你是赛电短视频脚本工程师，主要职责是根据系统已经学习完成的真实素材索引生成待审核脚本，不负责生成视频主体。

固定工作顺序：
1. 先读取产品事实、合规规则和assets中的持久化素材索引，再构思脚本；不得先写脚本再找画面。
2. 先按“型号→功能或场景→动作→景别→有效时段”检索VIDEO素材，只有可被真实视频直接证明的内容才可写成确定事实。
3. 每条脚本先比较至少3种不同机制的钩子。钩子必须能由第一段真实视频直接证明，后文必须兑现；不要做量化评分。
4. 再确定受众、账号语气、转化目标、唯一核心卖点、结构和逐句口播。
5. 每个voiceoverLine都必须有同lineId的shotRequirement，并给出COVERED、REWRITABLE、NEED_SHOOT或PROHIBITED结论。
6. 核心功能、参数、步骤或结果缺少直接视频时必须NEED_SHOOT；非核心句只有在不改变事实时才可REWRITABLE。
7. 输出只作为script_review待审核稿。脚本未经用户明确确认，不得声称已进入配音、剪辑或成片阶段。

素材硬规则：
- 主体时间线只能由真实VIDEO素材构成。IMAGE、DOCUMENT、AUDIO及包装资源不能作为主镜头，不能补时长。
- 图片仅可记录为叠加在仍播放的视频上的auxiliaryImageAssetIds，不能单独形成镜头。
- 外观、包装、佩戴空镜不能证明具体功能；具体功能必须有对应操作、过程或结果视频。
- 只能引用输入中真实存在、已审核且可用的assetId。不得凭文件名猜测，不得虚构素材ID、时间段、功能或用户体验。
- 优先使用indexNeedsReview=false且indexConfidence较高的素材。低置信度或待复核素材不能作为确定事实的唯一证据。
- 素材不足时列出具体补拍：产品、动作、功能、景别、过程或结果、建议拍法。禁止使用无关素材、重复片段、图片、慢放或空镜掩盖缺口。

脚本规则：
- 先给结构，再写正文；自然短句，每句一个主要信息。
- 非个人号默认亲切导购型口吻，有共情、具体动作、轻反差和自然选择建议；不得伪装“我买了、我用了、亲测”。
- 普通种草默认organic_seeding，不得擅自写直播间、商品点击、优惠、价格、库存或赠品。
- 健康内容使用“监测、趋势、提醒、参考、健康管理”；禁止治疗、替代医院、精准诊断及未经核验的认证、保险、销量、榜单或代言。
- 健康提示写入overlayNotice，默认不写入口播。
- 同批候选使用不同钩子机制、核心方向和主要证明素材，禁止只换几个词。
- script字段只能由voiceoverLines.text按行组成，不混入行号、说明、时长、素材缺口或健康提示。

网感硬规则：
- 开头先给鲜明判断、具体冲突、生活处境、轻反差或可兑现利益，禁止从型号介绍、品牌问候或参数罗列起笔。
- 前3秒必须出现具体人群处境或产品动作，钩子口播、钩子字幕和第一视频镜头表达同一信息。
- 长句拆成自然短拍，允许省略主语和连接词；用“消息来了 抬腕看 电话来了 腕上接”这类动作节奏代替“支持、具备、可以、功能、查看”的说明书清单。
- 中段至少一次轻反差或重新定义，但必须由素材兑现，不得夸张。
- 每条只保留1至2句自然口语记忆点，不能堆热梗、感叹词或网络黑话。
- 结尾贴着本条内容自然互动或给选择建议，禁止批量套用“你说是不是、如果是你、你会考虑吗、点赞关注”。
- 完成后必须执行说明书反查；如果连续使用“支持、具备、可以、功能、查看”，或句长过于整齐，必须重写为场景、动作和有起伏的短句。
- scriptPackage.styleChecks必须如实返回attitudeOpening、shortSentenceRhythm、lightContrast、concreteActions、memorablePhrase、manualToneCheck、templateQuestionCheck及notes；任何布尔项未通过都不得提交候选。
`.trim();

export function validateBailianVideoScriptResult(candidate: JsonRecord, context: JsonRecord): string[] {
  const errors: string[] = [];
  const assets = rows(context.assets);
  const assetKinds = new Map(assets.map((asset) => [text(asset.id), text(asset.kind || asset.mediaType).toUpperCase()]));
  const knownAssetIds = new Set(assetKinds.keys());
  const packageRow = candidate.scriptPackage && typeof candidate.scriptPackage === "object" && !Array.isArray(candidate.scriptPackage)
    ? candidate.scriptPackage as JsonRecord
    : {};
  const voiceLines = rows(packageRow.voiceoverLines);
  const requirements = rows(packageRow.shotRequirements);
  const styleChecks = packageRow.styleChecks && typeof packageRow.styleChecks === "object" && !Array.isArray(packageRow.styleChecks)
    ? packageRow.styleChecks as JsonRecord
    : {};

  for (const id of strings(candidate.assetIds)) {
    if (!knownAssetIds.has(id)) errors.push(`引用了输入中不存在的素材ID：${id}`);
    else if (assetKinds.get(id) !== "VIDEO") errors.push(`主体素材assetIds只能引用VIDEO：${id}`);
  }

  if (voiceLines.length !== requirements.length) {
    errors.push("voiceoverLines与shotRequirements数量不一致");
  }

  const requiredStyleChecks = [
    "attitudeOpening",
    "shortSentenceRhythm",
    "lightContrast",
    "concreteActions",
    "memorablePhrase",
    "manualToneCheck",
    "templateQuestionCheck",
  ];
  for (const field of requiredStyleChecks) {
    if (styleChecks[field] !== true) errors.push(`网感检查未通过：${field}`);
  }

  const scriptText = voiceLines.map((line) => text(line.text)).join(" ");
  const firstLine = text(voiceLines[0]?.text);
  const weakOpenings = ["今天介绍", "这款手表功能很多", "很多人都不知道", "大家好", "我是"];
  if (weakOpenings.some((opening) => firstLine.startsWith(opening))) {
    errors.push("开头仍是介绍式或泛化弱钩子");
  }
  const manualWords = scriptText.match(/支持|具备|可以|功能|查看/gu) || [];
  if (manualWords.length >= 5) errors.push("说明书词汇过密，需要改成场景和动作短句");
  if (voiceLines.some((line) => text(line.text).length > 42)) {
    errors.push("存在过长口播句，需要拆成自然短拍");
  }
  if (/你说是不是|如果是你|你会考虑吗|点赞关注/u.test(scriptText)) {
    errors.push("使用了模板互动或泛化引导");
  }

  voiceLines.forEach((line, index) => {
    const requirement = requirements[index] || {};
    const lineId = text(line.lineId) || `line_${index + 1}`;
    const requirementLineId = text(requirement.lineId) || lineId;
    if (lineId !== requirementLineId) errors.push(`逐句素材要求lineId不一致：${lineId}`);
    if (text(line.text) !== text(requirement.line)) errors.push(`逐句口播与素材要求不一致：${lineId}`);

    const primaryIds = strings(requirement.matchedVideoAssetIds);
    const auxiliaryIds = strings(requirement.auxiliaryImageAssetIds);
    const status = text(requirement.assetStatus).toUpperCase();

    for (const id of primaryIds) {
      if (!knownAssetIds.has(id)) errors.push(`${lineId}引用了不存在的视频素材：${id}`);
      else if (assetKinds.get(id) !== "VIDEO") errors.push(`${lineId}主镜头引用了非VIDEO素材：${id}`);
    }
    for (const id of auxiliaryIds) {
      if (!knownAssetIds.has(id)) errors.push(`${lineId}引用了不存在的辅助图片：${id}`);
      else if (assetKinds.get(id) !== "IMAGE") errors.push(`${lineId}辅助图片列表含非IMAGE素材：${id}`);
    }
    if (status === "COVERED" && primaryIds.length === 0) {
      errors.push(`${lineId}标记COVERED但没有绑定真实VIDEO素材`);
    }
    if (primaryIds.length === 0 && auxiliaryIds.length > 0 && status !== "NEED_SHOOT") {
      errors.push(`${lineId}只有图片辅助素材时必须标记NEED_SHOOT`);
    }
  });

  return Array.from(new Set(errors));
}
