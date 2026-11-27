// @vitest-environment jsdom
// Owner 2026-11-28 (artifact audience): the library opens on 呈阅 when the host has `artifact-audience`, 全部 marks
// team artifacts 内部, the file-kind / purpose chips go to cutex, an empty 呈阅 offers 查看全部成果, the star toggles
// in place and 本项目网页服务 opens the project's 服务 tab. An older host keeps today's library (no 呈阅, no chips).
import { act, createElement as h, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const env = vi.hoisted(() => ({ read: vi.fn(), star: vi.fn(), openPage: vi.fn(), features: new Set<string>() }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("../src/renderer/src/modules/app", () => ({ services: { daemonFor: () => ({ artifactStoreList: env.read }), ui: { openPage: env.openPage } } }));
vi.mock("../src/renderer/src/modules/artifacts/store", () => ({ useEpoch: () => 0, invalidateArtifact: vi.fn(), loadContent: vi.fn() }));
vi.mock("../src/renderer/src/modules/artifacts/View", () => ({ ViewBody: () => null }));
vi.mock("../src/renderer/src/modules/artifacts/ViewActions", () => ({ ViewActions: () => null }));
vi.mock("../src/renderer/src/modules/artifacts/actions", () => ({ artifactMenu: vi.fn(), openDelegation: vi.fn(), openVersion: vi.fn(), refusalText: vi.fn(), toggleStar: env.star }));
vi.mock("../src/renderer/src/lib/time", () => ({ useClock: () => 1, formatAbsolute: () => "", formatWhen: () => "" }));
vi.mock("../src/renderer/src/lib/fileThumbnails", () => ({ useThumbnail: () => ({ ref: null, state: { status: "idle" } }) }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ contextMenu: vi.fn() }));
vi.mock("../src/renderer/src/store", () => ({ agentHost: () => "local", useApp: (sel: (s: unknown) => unknown) => sel({ hosts: { active: "local" } }), featuresOf: () => env.features }));
import { LibraryBody } from "../src/renderer/src/modules/artifacts/Library";
import { DEFAULT_LIBRARY, type LibraryState } from "../src/renderer/src/modules/artifacts/model";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const SCOPE = { kind: "project", id: "demo" };
const summary = (id: string, name: string, audience: "owner" | "team", starred = false) => ({
  artifactId: `af-${id.padEnd(32, "0")}`, scope: SCOPE, name, kind: "report", audience, purpose: null, fileKind: "document", latestVersion: 1, revision: 1, starred, archivedAt: null,
  createdAt: "2026-11-28T00:00:00Z", updatedAt: "2026-11-28T00:00:00Z",
  latest: { mediaType: "text/markdown", sourcePath: name, storage: "blob", producer: { kind: "owner", sessionId: null, displayName: null, attribution: null, askId: null, candidates: [] } },
});
const OWNER_ITEM = summary("a1", "study.md", "owner");
const TEAM_ITEM = summary("b2", "evidence.md", "team");

let node: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
  env.read.mockReset();
  env.star.mockReset().mockResolvedValue(true);
  env.openPage.mockReset();
  env.read.mockImplementation(async (q: { view?: string }) => ({ scope: SCOPE, items: q.view === "forOwner" ? [] : [OWNER_ITEM, TEAM_ITEM], nextCursor: null }));
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
});

function Harness() {
  const [state, setState] = useState<LibraryState>(DEFAULT_LIBRARY);
  return h(LibraryBody, { instance: { id: "library", state }, hostId: "local", sessionId: "session", visible: true, setState, open: vi.fn() } as any);
}
const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy();
  await act(async () => (el as HTMLElement).click());
};
const lastQuery = () => env.read.mock.calls.at(-1)![0];

it("an artifact-audience host opens on 呈阅, offers 全部, marks team artifacts 内部 and sends the chips to cutex", async () => {
  env.features = new Set(["artifact-audience", "services"]);
  await act(async () => root.render(h(Harness)));
  expect(lastQuery()).toMatchObject({ forSession: "session", view: "forOwner" });
  expect(lastQuery().kind).toBeUndefined();
  expect(node.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("artifacts.view.forOwner");
  // Empty 呈阅: says why and switches to 全部.
  expect(node.querySelector("[data-artifacts-for-owner-empty]")?.textContent).toContain("artifacts.forOwnerEmpty");
  await click(node.querySelector("[data-artifacts-for-owner-empty] button"));
  expect(lastQuery()).toMatchObject({ view: "all" });
  expect(node.textContent).toContain("study.md");
  const rows = [...node.querySelectorAll('[role="button"]')];
  expect(rows.find((r) => r.textContent?.includes("evidence.md"))?.textContent).toContain("artifacts.internalTag");
  expect(rows.find((r) => r.textContent?.includes("study.md"))?.textContent).not.toContain("artifacts.internalTag");
  // Chips toggle and go to cutex (before pagination there).
  const chip = (label: string) => [...node.querySelectorAll("[data-artifacts-chips] button")].find((b) => b.textContent === label);
  await click(chip("artifacts.fileKind.slides"));
  expect(lastQuery()).toMatchObject({ view: "all", fileKind: "slides" });
  await click(chip("artifacts.purpose.deliverable"));
  expect(lastQuery()).toMatchObject({ fileKind: "slides", purpose: "deliverable" });
  await click(chip("artifacts.fileKind.slides"));
  expect(lastQuery().fileKind).toBeUndefined();
  // 未标用途 replaces the chosen purpose (one per group).
  await click(chip("artifacts.purposeUnset"));
  expect(lastQuery()).toMatchObject({ purpose: "unset", archived: "false" });
  // 本项目网页服务 → the project page's 服务 tab.
  await click(node.querySelector("[data-artifacts-services]"));
  expect(env.openPage).toHaveBeenCalledWith("projects.page", { project: "demo", tab: "services" });
});

it("the star toggles in place without opening the artifact", async () => {
  env.features = new Set(["artifact-audience"]);
  env.read.mockImplementation(async () => ({ scope: SCOPE, items: [TEAM_ITEM], nextCursor: null }));
  await act(async () => root.render(h(Harness)));
  await click(node.querySelector('button[aria-label="artifacts.star"]'));
  expect(env.star).toHaveBeenCalledWith("local", expect.objectContaining({ artifactId: TEAM_ITEM.artifactId }));
  // Without services the link is not offered.
  expect(node.querySelector("[data-artifacts-services]")).toBeNull();
});

it("an older host keeps today's full library: no 呈阅, no chips, no audience parameters", async () => {
  env.features = new Set(["services"]);
  env.read.mockImplementation(async () => ({ scope: SCOPE, items: [TEAM_ITEM], nextCursor: null }));
  await act(async () => root.render(h(Harness)));
  const q = lastQuery();
  expect(q.view).toBeUndefined();
  expect(q.fileKind).toBeUndefined();
  expect(node.querySelector('[role="tablist"]')).toBeNull();
  expect(node.querySelector("[data-artifacts-chips]")).toBeNull();
  expect(node.querySelector("[data-artifacts-services]")).toBeNull();
  expect(node.textContent).toContain("evidence.md");
  expect(node.textContent).not.toContain("artifacts.internalTag");
});
