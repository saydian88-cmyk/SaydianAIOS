export type QualityWarning = {
  validator: string;
  summary: string;
  recommendation: string;
};

export type QualityGate =
  | { disposition: "BLOCKING" }
  | { disposition: "WARNING"; warning: QualityWarning };

export function classifyQualityGate(script: string, detail: string, hasDeliverable = false): QualityGate {
  const value = `${script}\n${detail}`;
  if (hasDeliverable || /validate_rendered_composition|reviewed_from_render|contrast|timeline_track_too_dense|transition-qc/i.test(value)) {
    return {
      disposition: "WARNING",
      warning: {
        validator: script,
        summary: detail.slice(0, 800),
        recommendation: "成片可交付；如需优化，请在审核中退回并说明具体画面问题。",
      },
    };
  }
  return { disposition: "BLOCKING" };
}

export function appendQualityWarning(existing: QualityWarning[], warning: QualityWarning) {
  return existing.some((item) => item.validator === warning.validator && item.summary === warning.summary)
    ? existing
    : [...existing, warning];
}
