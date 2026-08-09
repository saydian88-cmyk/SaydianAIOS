import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canResume,
  directVideoUploadLedgerKey,
  ensureTaskWorkspace,
  freshWorkspaceState,
  loadWorkspaceState,
  saveWorkspaceState,
  uploadLedgerKey,
} from "./workspace-state";

describe("task workspace resume and upload idempotency", () => {
  it("resumes only the same package and Skill digest", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "ai-task-workspace-"));
    await ensureTaskWorkspace(workspace);
    const state = freshWorkspaceState("package-a", "skill-a");
    state.stage = "QUALITY_CHECK";
    await saveWorkspaceState(workspace, state);
    state.stage = "UPLOADING";
    await saveWorkspaceState(workspace, state);
    const restored = await loadWorkspaceState(workspace);
    expect(restored?.stage).toBe("UPLOADING");
    expect(canResume(restored, "package-a", "skill-a")).toBe(true);
    expect(canResume(restored, "package-b", "skill-a")).toBe(false);
    expect(canResume(restored, "package-a", "skill-b")).toBe(false);
  });

  it("uses a stable upload ledger key for duplicate uploads", () => {
    const first = uploadLedgerKey("outputs\\result.png", "abc", "IMAGE_OUTPUT");
    const second = uploadLedgerKey("outputs/result.png", "abc", "IMAGE_OUTPUT");
    expect(first).toBe(second);
  });

  it("refreshes direct-video masters once when technical metadata is introduced", () => {
    const original = uploadLedgerKey("outputs\\result.mp4", "abc", "VIDEO_MASTER");
    const refreshed = directVideoUploadLedgerKey("outputs/result.mp4", "abc", "VIDEO_MASTER");
    expect(refreshed).toContain(original);
    expect(refreshed).not.toBe(original);
  });
});
