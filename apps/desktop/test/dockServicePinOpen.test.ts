// A tray / desktop pin that does not open (owner 2026-10-25: the 看板 service pin showed 「打不开（unavailable）」
// as a red chip inside the composer): the reason in words, as the toast above the tray; a service pin of a host
// the Shelf does not show now (another host's agent is open) opens in the system browser instead of failing.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  shown: "local",
  why: null as string | null,
  external: [] as { slug: string; hostId: string; path: string }[],
  toasts: [] as string[],
  notices: [] as string[],
  refs: [] as unknown[],
}));
vi.mock("../src/renderer/src/i18n", () => ({
  translate: (key: string, vars?: Record<string, string>) => (vars ? `${key}(${Object.values(vars).join(",")})` : key),
}));
vi.mock("../src/renderer/src/lib/shelves", () => ({ showShelfToast: (text: string) => void mocks.toasts.push(text) }));
vi.mock("../src/renderer/src/lib/sideServices", () => ({ sideShowsHost: (hostId: string) => hostId === mocks.shown }));
vi.mock("../src/renderer/src/lib/services", () => ({
  openServiceExternal: async (s: { slug: string }, hostId: string, path: string) => void mocks.external.push({ slug: s.slug, hostId, path }),
}));
vi.mock("../src/renderer/src/lib/workspaces", () => ({
  openRefWhy: async (ref: unknown) => (mocks.refs.push(ref), mocks.why),
}));
vi.mock("../src/renderer/src/lib/pagePins", () => ({ pagePinKindNow: () => undefined }));
vi.mock("../src/renderer/src/modules/app", () => ({
  services: {
    ui: { notice: (text: string) => void mocks.notices.push(text) },
    refs: { open: async () => ({ status: "unavailable", reason: "gone" }) },
    panes: { open: () => ({ status: "opened" }) },
    side: { open: () => ({ status: "opened" }) },
  },
}));

const { openFailedText, openPin, openPinAs, serviceOutOfView } = await import("../src/renderer/src/modules/home/open");

const board = { hostId: "local", kind: "service" as const, key: "cutex-e-director-board", title: "看板" };

beforeEach(() => {
  mocks.shown = "local";
  mocks.why = null;
  mocks.external = [];
  mocks.toasts = [];
  mocks.notices = [];
  mocks.refs = [];
});

describe("the reason in words", () => {
  it("a refs reason gets its sentence; aliases share one; an unknown code is 「原因不明」; an error's text stays", () => {
    expect(openFailedText("host-offline")).toBe("home.openFailed(home.openFailed.host-offline)");
    expect(openFailedText("gone")).toBe("home.openFailed(home.openFailed.gone)");
    expect(openFailedText("bad-params")).toBe("home.openFailed(home.openFailed.bad-ref)");
    expect(openFailedText("agent-feature")).toBe("home.openFailed(home.openFailed.capability)");
    expect(openFailedText("unavailable")).toBe("home.openFailed(home.openFailed.unknown)");
    expect(openFailedText("Error: daemon said no")).toBe("home.openFailed(Error: daemon said no)");
  });
});

describe("a tray click", () => {
  it("a refused open: the toast above the tray with the reason, never the composer's notice", async () => {
    mocks.why = "gone";
    await openPinAs(board, "replace", openFailedText);
    expect(mocks.refs).toEqual([{ kind: "service", hostId: "local", key: board.key, title: "看板" }]);
    expect(mocks.toasts).toEqual(["home.openFailed(home.openFailed.gone)"]);
    expect(mocks.notices).toEqual([]);
  });

  it("opened: nothing to say", async () => {
    await openPinAs(board, "beside", openFailedText);
    expect(mocks.toasts).toEqual([]);
    expect(mocks.external).toEqual([]);
  });

  it("another host's agent is open: the service opens in the system browser (no Shelf open, no failure)", async () => {
    mocks.shown = "ssh-remote";
    expect(serviceOutOfView(board)).toBe(true);
    await openPinAs(board, "replace", openFailedText);
    expect(mocks.refs).toEqual([]);
    expect(mocks.external).toEqual([{ slug: board.key, hostId: "local", path: "/" }]);
    expect(mocks.toasts).toEqual([]);
    // A desktop tile / widget (openPin) the same way, with its path.
    await openPin(board, openFailedText, "/tasks");
    expect(mocks.external.at(-1)).toEqual({ slug: board.key, hostId: "local", path: "/tasks" });
  });

  it("only services: an artifact of the other host still goes through refs (and says why it did not open)", async () => {
    mocks.shown = "ssh-remote";
    expect(serviceOutOfView({ ...board, kind: "artifact" })).toBe(false);
    await openPin({ ...board, kind: "artifact" }, openFailedText);
    expect(mocks.external).toEqual([]);
    expect(mocks.toasts).toEqual(["home.openFailed(home.openFailed.gone)"]);
  });
});
