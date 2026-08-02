import { describe, expect, it } from "vitest";
import { WorkbenchService } from "./workbench.service";

describe("WorkbenchService task ordering", () => {
  it("places newest video projects before ordinary tasks", () => {
    const service = new WorkbenchService({} as never, {} as never, {} as never);
    const sorted = (service as any).sortTasks([
      {
        id: "urgent-normal",
        sourceType: "SELF_CREATED",
        category: "GENERAL",
        priority: "URGENT",
        dueAt: new Date("2026-07-30T08:00:00+08:00"),
        createdAt: new Date("2026-07-30T08:00:00+08:00"),
      },
      {
        id: "older-video",
        sourceType: "VIDEO_PROJECT",
        category: "VIDEO_PROJECT",
        priority: "MEDIUM",
        dueAt: null,
        createdAt: new Date("2026-07-30T09:00:00+08:00"),
        updatedAt: new Date("2026-08-02T10:00:00+08:00"),
      },
      {
        id: "newer-video",
        sourceType: "VIDEO_PROJECT",
        category: "VIDEO_PROJECT",
        priority: "LOW",
        dueAt: null,
        createdAt: new Date("2026-07-30T10:00:00+08:00"),
        updatedAt: new Date("2026-07-30T10:01:00+08:00"),
      },
    ]);

    expect(sorted.map((task: { id: string }) => task.id)).toEqual([
      "newer-video",
      "older-video",
      "urgent-normal",
    ]);
  });
});
