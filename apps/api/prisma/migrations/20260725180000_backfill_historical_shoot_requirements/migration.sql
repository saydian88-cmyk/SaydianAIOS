UPDATE "ContentPlan"
SET "shootRequirements" = '[{"id":"shot-main","description":"本脚本所需拍摄素材","status":"OPEN","assetIds":[]}]'::jsonb
WHERE "kind" = 'VIDEO'
  AND "productionStage" = 'AWAITING_ASSETS'
  AND "shootRequirements" = '[]'::jsonb;
