// @vitest-environment jsdom
// The receipt block of a cross-host delegation (components/CrossHostReceipt via DelegationPeerSection; cutex
// peer-delivery-receipts-v1): the other host by its current name (the instance id in the hover when two hosts share
// a name), the receipt and its reason in the spec's words, the connection as a separate fact (此主机未连接 never reads
// as a refusal), 打开对端记录 only on the host with the same instance id, and today's display on an older host.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskSummary } from "../src/shared/ipc";

const LAB = "ci-7a3f01c2b4d5e6f708192a3b4c5d6e7f";
const fx = vi.hoisted(() => ({ features: new Set<string>(), hosts: [] as unknown[], opened: [] as [string, string][], refreshed: [] as [string, string][] }));

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/store", async (importOriginal) => {
  const state = () => {
    const views = fx.hosts as { id: string; conn?: { daemon: unknown } }[];
    return {
      hosts: { active: "local", hosts: views },
      daemon: views.find((v) => v.id === "local")?.conn?.daemon ?? { kind: "unreachable", baseUrl: "", message: "" },
      byHost: Object.fromEntries(views.filter((v) => v.id !== "local" && v.conn).map((v) => [v.id, { daemon: v.conn!.daemon }])),
      features: fx.features,
      sidebar: null,
    };
  };
  return {
    ...(await importOriginal<object>()),
    useApp: Object.assign((select: (s: unknown) => unknown) => select(state()), { getState: state, setState: () => {}, subscribe: () => () => {} }),
    featuresOf: () => fx.features,
  };
});
vi.mock("../src/renderer/src/lib/delegationOpen", () => ({ openDelegationDetail: (host: string, askId: string) => fx.opened.push([host, askId]) }));
vi.mock("../src/renderer/src/lib/delegationStore", () => ({
  refreshDelegation: async (host: string, askId: string) => (fx.refreshed.push([host, askId]), null),
  delegationApi: () => ({}),
}));

const { I18nProvider } = await import("../src/renderer/src/i18n");
const { DelegationPeerSection } = await import("../src/renderer/src/components/DelegationPeer");
const { PeerParty } = await import("../src/renderer/src/components/PeerParty");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const host = (id: string, label: string, instanceId: string | null) => ({
  id, label, kind: id === "local" ? "local" : "ssh",
  conn: { epoch: `e-${id}`, tunnel: null, cutexBuild: null, daemon: { kind: "connected", baseUrl: "", hostId: id, ...(instanceId ? { instanceId } : {}) } },
});
const mirror = (extra: Partial<AskSummary> = {}): AskSummary => ({
  askId: "ask-px-srcref", title: "清理旧镜像", requester: { kind: "owner" }, target: "cutex.4be81f2a9c", targetName: "proj-worker", execution: "queued", revision: 2, createdAt: "2026-11-25T09:00:00Z", attempts: 0,
  remote: { peerId: LAB, label: "workstation-lab", targetName: "proj-worker", syncState: "remote_credential_refused", lastError: null },
  ...extra,
} as AskSummary);
const receipt = (state: string, reason: string | null) => ({ crossHost: { direction: "outbound" as const, peer: { instanceId: LAB, label: "workstation-lab" }, receipt: { state, reason, confirmedAt: "2026-11-25T09:30:00Z" } } });

let container: HTMLDivElement;
let root: Root;
const $ = (sel: string) => container.querySelector<HTMLElement>(sel);

beforeEach(() => {
  fx.features = new Set(["peer-delivery-receipts-v1"]);
  fx.hosts = [host("local", "This PC", "ci-11111111111111111111111111111111")];
  fx.opened.length = 0;
  fx.refreshed.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(d: AskSummary, lang: "zh-CN" | "en" = "zh-CN", detail = false) {
  localStorage.setItem("cutex-desktop.locale", lang);
  await act(async () => root.render(h(I18nProvider, null, h(DelegationPeerSection, { d, hostId: "local", detail }))));
}

describe("cross-host receipt on a delegation", () => {
  it("a source-side refusal: the reason, the peer by its snapshot name, not connected here — and the old sync words are gone", async () => {
    await render(mirror(receipt("queuedAtSource", "sourceRoutingRefused")));
    expect($("[data-cross-host-word]")?.textContent).toBe("来源主机待发送");
    expect($("[data-cross-host-reason]")?.textContent).toContain("发起项目限制跨主机委托");
    expect($("[data-cross-host-peer]")?.textContent).toBe("workstation-lab");
    expect($("[data-cross-host-offline]")?.textContent).toBe("此主机未连接");
    expect(container.textContent).not.toContain("拒绝了这个委托");
    // Details: last confirmation and the full instance id; no 打开对端记录 without the host.
    await act(async () => $("[data-cross-host-more]")!.click());
    expect($("[data-cross-host-instance]")?.textContent).toContain(LAB);
    expect($("[data-cross-host-open]")).toBeNull();
    await act(async () => $("[data-cross-host-refresh]")!.click());
    expect(fx.refreshed).toEqual([["local", "ask-px-srcref"]]);
  });

  it("the peer connected here (same instance id): its current name and 打开对端记录 on that host", async () => {
    fx.hosts = [host("local", "This PC", null), host("hostb", "Hostb", LAB)];
    await render(mirror(receipt("failed", "destinationRoutingRefused")), "en", true);
    expect($("[data-cross-host-word]")?.textContent).toBe("Failed");
    expect($("[data-cross-host-reason]")?.textContent).toContain("Destination project declined the route");
    expect($("[data-cross-host-peer]")?.textContent).toBe("Hostb");
    expect($("[data-cross-host-offline]")).toBeNull();
    // The detail is open from the start and names the snapshot the record has.
    expect($("[data-cross-host-detail]")?.textContent).toContain("Name when recorded: workstation-lab");
    await act(async () => $("[data-cross-host-open]")!.click());
    expect(fx.opened).toEqual([["hostb", "ask-px-srcref"]]);
  });

  it("a host of the same name but another identity is not opened; the hover gives the instance id", async () => {
    fx.hosts = [host("local", "This PC", null), host("lab", "workstation-lab", "ci-00000000000000000000000000000002")];
    await render(mirror(receipt("deliveredToPeer", null)), "zh-CN", true);
    const peer = $("[data-cross-host-peer]")!;
    expect(peer.textContent).toBe("workstation-lab");
    expect(peer.getAttribute("title")).toContain(LAB);
    expect($("[data-cross-host-offline]")).not.toBeNull();
    expect($("[data-cross-host-open]")).toBeNull();
  });

  it("an older host (no capability) or an older record keeps today's sync words", async () => {
    fx.features = new Set();
    await render(mirror(receipt("queuedAtSource", "sourceRoutingRefused")));
    expect($("[data-testid=cross-host-receipt]")).toBeNull();
    expect(container.textContent).toContain("workstation-lab 拒绝了这个委托");
    fx.features = new Set(["peer-delivery-receipts-v1"]);
    await render(mirror());
    expect($("[data-testid=cross-host-receipt]")).toBeNull();
    expect(container.textContent).toContain("workstation-lab 拒绝了这个委托");
  });

  it("PeerParty (cards, lists, Next Up): the host part becomes the connected host's current name, by instance id only", async () => {
    fx.hosts = [host("local", "This PC", null), host("hostb", "Hostb", LAB)];
    localStorage.setItem("cutex-desktop.locale", "en");
    await act(async () => root.render(h(I18nProvider, null,
      h(PeerParty, { text: "proj-worker @ workstation-lab", label: "workstation-lab", instanceId: LAB, hostId: "local" }),
      h(PeerParty, { text: "helper@workstation-lab", label: "workstation-lab", instanceId: LAB, hostId: "local" }),
      h(PeerParty, { text: "proj-worker @ workstation-lab", label: "workstation-lab" }),
    )));
    expect([...container.querySelectorAll("[data-testid=peer-party]")].map((e) => e.textContent)).toEqual(["proj-worker @ Hostb", "helper@Hostb", "proj-worker @ workstation-lab"]);
    fx.features = new Set();
    await act(async () => root.render(h(I18nProvider, null, h(PeerParty, { text: "proj-worker @ workstation-lab", label: "workstation-lab", instanceId: LAB, hostId: "local" }))));
    expect($("[data-testid=peer-party]")?.textContent).toBe("proj-worker @ workstation-lab");
  });
});
