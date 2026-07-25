INSERT INTO "PhraseRule" ("id", "category", "blockedText", "condition", "active", "createdAt", "updatedAt")
SELECT
  'restricted-word-' || md5(term),
  'HEALTH_RESTRICTED_WORD',
  term,
  '仅用于健康内容受限模式',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM unnest(ARRAY[
  '血氧', '血糖', '血脂', '尿酸', '血压', '心电', '三高', '高血压',
  '降压', '医疗', '保健', '测压', '压压', '糖', '氧', '喝酒',
  '喝那啥', '抽烟', '抽那啥'
]) AS term
ON CONFLICT ("category", "blockedText") DO UPDATE SET "active" = true, "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "PhraseRule" ("id", "category", "blockedText", "condition", "active", "createdAt", "updatedAt")
SELECT
  'restricted-visual-' || md5(term),
  'HEALTH_RESTRICTED_VISUAL',
  term,
  '仅用于健康内容受限模式',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM unnest(ARRAY[
  '血氧测量画面', '血糖测量画面', '血脂检测画面', '尿酸检测画面',
  '血压测量画面', '心电波形画面', '健康数据界面', '医疗器械画面',
  '饮酒画面', '吸烟画面'
]) AS term
ON CONFLICT ("category", "blockedText") DO UPDATE SET "active" = true, "updatedAt" = CURRENT_TIMESTAMP;
