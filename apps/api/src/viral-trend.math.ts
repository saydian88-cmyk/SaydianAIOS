export const VIRAL_FORMULA_VERSION = "DOUYIN_TREND_V1";

export type ViralRawMetrics = {
  capturedAt: Date;
  publishedAt: Date;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  saves?: number | null;
  shares?: number | null;
  followers?: number | null;
  recentHitRate?: number | null;
};

export type ViralComponents = {
  ageHours: number;
  playVelocity: number;
  engagementRate: number;
  saveShareRate: number;
  velocityScore: number;
  engagementScore: number;
  saveShareScore: number;
  accountQualityScore: number;
  viralIndex: number;
  viralGrade: "S" | "A" | "B" | "C";
};

function finite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function clampScore(value: number) {
  return Math.max(0, Math.min(100, value));
}

export function percentileScore(value: number, cohort: number[]) {
  const valid = cohort.filter(Number.isFinite).sort((left, right) => left - right);
  if (!valid.length) return 0;
  if (valid.length === 1) return 100;
  let below = 0;
  let equal = 0;
  for (const entry of valid) {
    if (entry < value) below += 1;
    else if (entry === value) equal += 1;
  }
  return clampScore(((below + Math.max(0, equal - 1) / 2) / (valid.length - 1)) * 100);
}

export function gradeFor(index: number): ViralComponents["viralGrade"] {
  if (index >= 85) return "S";
  if (index >= 70) return "A";
  if (index >= 55) return "B";
  return "C";
}

export function calculateViralComponents(
  input: ViralRawMetrics,
  percentile?: {
    velocities: number[];
    engagements: number[];
    saveShares: number[];
    accountQualities: number[];
  },
): ViralComponents {
  const ageHours = Math.max(
    0.25,
    (input.capturedAt.getTime() - input.publishedAt.getTime()) / 3_600_000,
  );
  const views = finite(input.views);
  const likes = finite(input.likes);
  const comments = finite(input.comments);
  const saves = finite(input.saves);
  const shares = finite(input.shares);
  const followers = finite(input.followers);
  const playVelocity = views / ageHours;
  const engagementRate = views ? (likes + comments + saves + shares) / views : 0;
  const saveShareRate = views ? (saves + shares) / views : 0;
  const followerScale = clampScore((Math.log10(followers + 1) / 6) * 100);
  const recentHitRate = clampScore(finite(input.recentHitRate) * 100);
  const rawAccountQuality = followerScale * 0.7 + recentHitRate * 0.3;
  const enough = Boolean(
    percentile
      && percentile.velocities.length >= 30
      && percentile.engagements.length >= 30
      && percentile.saveShares.length >= 30
      && percentile.accountQualities.length >= 30,
  );
  const velocityScore = enough
    ? percentileScore(playVelocity, percentile!.velocities)
    : clampScore((playVelocity / 50_000) * 100);
  const engagementScore = enough
    ? percentileScore(engagementRate, percentile!.engagements)
    : clampScore((engagementRate / 0.1) * 100);
  const saveShareScore = enough
    ? percentileScore(saveShareRate, percentile!.saveShares)
    : clampScore((saveShareRate / 0.03) * 100);
  const accountQualityScore = enough
    ? percentileScore(rawAccountQuality, percentile!.accountQualities)
    : rawAccountQuality;
  const viralIndex = Math.round((
    velocityScore * 0.4
    + engagementScore * 0.3
    + saveShareScore * 0.2
    + accountQualityScore * 0.1
  ) * 10) / 10;
  return {
    ageHours,
    playVelocity,
    engagementRate,
    saveShareRate,
    velocityScore,
    engagementScore,
    saveShareScore,
    accountQualityScore,
    viralIndex,
    viralGrade: gradeFor(viralIndex),
  };
}
