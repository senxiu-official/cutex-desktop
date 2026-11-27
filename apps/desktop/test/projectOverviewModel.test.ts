// 项目 › 概览 v2 (owner 2026-11-26): what each block shows (modules/projects/overviewModel.ts).
import { describe, expect, it } from "vitest";
import type { AskSummary, ProjectMemoryView, ServiceView } from "../src/shared/ipc";
import type { AgentRow } from "../src/renderer/src/lib/sidebar";
import { busyMembers, closedKind, recentClosed, recentMemory, serviceProblems } from "../src/renderer/src/modules/projects/overviewModel";

const row = (id: string, status: AgentRow["status"]) => ({ id, status }) as AgentRow;
const ask = (askId: string, o: Partial<AskSummary>) => ({ askId, title: askId, projectId: "p", updatedAt: "2026-11-26T00:00:00Z", ...o }) as AskSummary;

describe("project overview model", () => {
  it("成员: working members (running / waiting) other than the Director, at most 5, then how many more", () => {
    const online = [row("dir", "running"), ...Array.from({ length: 7 }, (_, i) => row(`b${i}`, i % 2 ? "running" : "needsInput")), row("idle", "idle")];
    const busy = busyMembers(online, "dir");
    expect(busy.shown.map((r) => r.id)).toEqual(["b0", "b1", "b2", "b3", "b4"]);
    expect(busy).toMatchObject({ more: 2, total: 7 });
    expect(busyMembers([row("a", "idle")], null)).toEqual({ shown: [], more: 0, total: 0 });
  });

  it("最近完成: this project's closed delegations, newest first; today's count with the failed ones", () => {
    const now = new Date(2026, 10, 26, 15, 0).getTime();
    const at = (h: number, day = 26) => new Date(2026, 10, day, h).toISOString();
    const rows = [
      ask("old", { closed: "completed", execution: "answered", closedAt: at(10, 25) }),
      ask("a", { closed: "completed", execution: "answered", closedAt: at(9) }),
      ask("b", { closed: "abandoned", execution: "failed", closedAt: at(12) }),
      ask("c", { closed: "stopped", execution: "interrupted", closedAt: at(14) }),
      ask("other", { closed: "completed", execution: "answered", closedAt: at(13), projectId: "q" }),
      ask("open", { execution: "running" }),
    ];
    const r = recentClosed(rows, "p", now, 3);
    expect(r.rows.map((d) => d.askId)).toEqual(["c", "b", "a"]);
    expect(r.today).toEqual({ done: 3, failed: 1 });
    expect(r.rows.map(closedKind)).toEqual(["stopped", "failed", "done"]);
  });

  it("服务: problems first (crash loop, unreachable, starting); the rest is a count", () => {
    const s = (slug: string, health: ServiceView["health"]) => ({ slug, health }) as ServiceView;
    const r = serviceProblems([s("ok", "reachable"), s("start", "starting"), s("idle", "stoppedIdle"), s("down", "unreachable"), s("loop", "crashLooped")]);
    expect(r.problems.map((x) => x.slug)).toEqual(["loop", "down", "start"]);
    expect(r.rest).toBe(2);
  });

  it("记忆: newest updates first; older hosts without times show none", () => {
    const memory = { dir: "", entries: [
      { file: "a.md", name: "a", updatedAt: "2026-11-20T00:00:00Z" },
      { file: "b.md", name: "b", updatedAt: "2026-11-26T00:00:00Z" },
      { file: "c.md", name: "c" },
      { file: "d.md", name: "d", updatedAt: "2026-11-24T00:00:00Z" },
      { file: "e.md", name: "e", updatedAt: "2026-11-01T00:00:00Z" },
    ] } as ProjectMemoryView;
    expect(recentMemory(memory).map((e) => e.name)).toEqual(["b", "d", "a"]);
    expect(recentMemory({ dir: "", entries: [{ file: "x", name: "x" }] } as ProjectMemoryView)).toEqual([]);
    expect(recentMemory(null)).toEqual([]);
  });
});
