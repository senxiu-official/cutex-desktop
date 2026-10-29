// @vitest-environment jsdom
// Storage audit 2026-10-23 (fix/0.2-storage-desktop): a full localStorage is said once, in plain words; pictures of
// deleted agents go (only when no listed agent wears them, and never on a guess); stored Shelves are pruned only
// against a complete agent list of the host in view.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
const NONE: never[] = [];
vi.mock("../src/renderer/src/modules/app", () => ({
  appModules: () => ({ subscribe: () => () => {}, snapshot: () => NONE, statuses: () => new Map(), modules: [] }),
}));

import type { SessionResource } from "@cutex-desktop/protocol";
import { forgetAgentPicture, newPictureAvatar } from "../src/renderer/src/lib/agentPicture";
import { readConvShelf, writeConvShelf } from "../src/renderer/src/lib/paneFile";
import { savePendingSteers } from "../src/renderer/src/lib/pendingSteerStore";
import { emptyLayout } from "../src/renderer/src/lib/sideLayout";
import { resetConvShelves, startSideStore, switchConversation, useSide } from "../src/renderer/src/lib/sideLayoutStore";
import { resetStorageFullNotice, setStorageFullNotifier } from "../src/renderer/src/lib/storageFull";
import { pictureInUse, useApp } from "../src/renderer/src/store";

const session = (id: string, avatar: unknown = null) => ({ cutexSessionId: id, displayName: id, avatar, native: { threadId: null }, runtime: { status: "online" }, cwd: "" }) as unknown as SessionResource;
const sidebar = (active: SessionResource[], extra: Record<string, unknown> = {}) => ({ active, retired: [], hostRows: {}, projects: null, ...extra }) as never;

beforeEach(() => {
  localStorage.clear();
  resetStorageFullNotice();
});
afterEach(() => vi.restoreAllMocks());

describe("a full localStorage is said once", () => {
  it("layouts and unsent steers that fail to save tell the owner once per run", async () => {
    const told = vi.fn();
    setStorageFullNotifier(told);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    writeConvShelf("host:local", "local|eva", emptyLayout(), {}, null);
    savePendingSteers({ a: [{ id: "1", text: "hi", imageCount: 0, turnId: null, baseline: 0, state: "waiting" }] as never });
    writeConvShelf("host:local", "local|eva", emptyLayout(), {}, null);
    await new Promise((r) => setTimeout(r, 0));
    expect(told).toHaveBeenCalledTimes(1);
    setStorageFullNotifier(null);
  });
});

describe("pictures of deleted agents", () => {
  it("go when no other listed agent wears them; stay when one does or a host's list is unknown", () => {
    const avatar = newPictureAvatar();
    const key = `cutex-desktop.agentPictures.${avatar.value}`;
    localStorage.setItem(key, "data:image/png;base64,AAAA");
    useApp.setState({ hosts: null, sidebar: sidebar([session("eva", avatar), session("fork", avatar)]) } as never);
    // The fork still wears it.
    expect(forgetAgentPicture(avatar, (v) => pictureInUse(useApp.getState(), v, "eva"))).toBe(false);
    expect(localStorage.getItem(key)).not.toBeNull();
    // A second host whose list is not loaded: unknown counts as in use.
    useApp.setState({ hosts: { active: "local", hosts: [{ id: "local" }, { id: "remote" }], groups: [] }, byHost: {}, sidebar: sidebar([session("eva", avatar)]) } as never);
    expect(forgetAgentPicture(avatar, (v) => pictureInUse(useApp.getState(), v, "eva"))).toBe(false);
    expect(localStorage.getItem(key)).not.toBeNull();
    // Every list known, nobody else wears it: gone.
    useApp.setState({ hosts: null, sidebar: sidebar([session("eva", avatar)]) } as never);
    expect(forgetAgentPicture(avatar, (v) => pictureInUse(useApp.getState(), v, "eva"))).toBe(true);
    expect(localStorage.getItem(key)).toBeNull();
  });
});

describe("stored Shelves are pruned only against a complete list", () => {
  it("a partial list (archived listing failed / hidden refused) prunes nothing; a complete one does", () => {
    resetConvShelves();
    useApp.setState({ selectedId: "eva", selectedHost: null, hosts: null, sidebar: sidebar([session("eva")]) } as never);
    useSide.setState({ scope: "host:local", layout: emptyLayout(), mode: null, peers: {} } as never);
    const stop = startSideStore(() => () => {});
    try {
      switchConversation("local|eva");
      writeConvShelf("host:local", "local|gone", emptyLayout(), { open: true }, null);
      expect(readConvShelf("host:local", "local|gone").own).not.toBeNull();
      useApp.setState({ sidebar: sidebar([session("eva")], { partial: true }) } as never);
      expect(readConvShelf("host:local", "local|gone").own).not.toBeNull();
      useApp.setState({ sidebar: sidebar([session("eva"), session("bob")]) } as never);
      expect(readConvShelf("host:local", "local|gone").own).toBeNull();
    } finally {
      stop();
    }
  });
});
