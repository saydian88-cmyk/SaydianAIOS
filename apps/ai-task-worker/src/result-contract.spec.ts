import { describe, expect, it, vi } from "vitest";
import { ResultSchemaError, runWithSchemaRetry, validateResult } from "./result-contract";

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    outputFiles: { type: "array" },
  },
  required: ["summary", "outputFiles"],
};

describe("unified result contract", () => {
  it("retries a schema-invalid result and accepts the corrected result", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ summary: 1, outputFiles: [] })
      .mockResolvedValueOnce({ summary: "ok", outputFiles: [] });
    const completed = await runWithSchemaRetry(
      execute,
      (result) => validateResult(result, schema),
      2,
    );
    expect(completed.attempts).toBe(2);
    expect(completed.result.summary).toBe("ok");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("does not accept a final result without execution trace", () => {
    expect(() => validateResult({ summary: "ok", outputFiles: [] }, schema, true))
      .toThrow(ResultSchemaError);
  });
});
