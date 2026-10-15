import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  target: "local",
  features: new Set<string>(),
  state: { hosts: { hosts: [] as { id: string; tokenId?: string }[] } },
}));
vi.mock("../src/renderer/src/lib/targetHost", () => ({
  useTargetHostId: () => fixture.target,
  useTargetFeatures: () => fixture.features,
  useTargetApi: () => ({}),
}));
vi.mock("../src/renderer/src/store", () => ({ useApp: (select: (state: typeof fixture.state) => unknown) => select(fixture.state) }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
// SSR otherwise reads Zustand's initial snapshot, not the capability replies seeded below.
vi.mock("../src/renderer/src/lib/hostAccess", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/renderer/src/lib/hostAccess")>();
  return { ...actual, useHostAccess: (hostId: string) => ({ ...actual.hostAccessNow(hostId), known: true }) };
});
import { noteHostAccess } from "../src/renderer/src/lib/hostAccess";
import { fireHostReset } from "../src/renderer/src/lib/hostSwitch";
import { useOwnTokenId } from "../src/renderer/src/modules/users/shared";

function CurrentDevice() { return createElement("span", null, useOwnTokenId() ?? "no-device"); }
const rendered = () => renderToStaticMarkup(createElement(CurrentDevice));
const owner = { id: "owner", name: "Owner", isOwner: true, pending: false, grant: null };

describe("Users current device uses the target host's credential", () => {
  beforeEach(() => {
    for (const host of ["local", "dev-private", "ssh-other"]) fireHostReset(host);
    fixture.target = "local";
    fixture.features = new Set(["user-own-token"]);
    fixture.state.hosts.hosts = [{ id: "local" }, { id: "dev-private" }, { id: "ssh-other", tokenId: "stored-old-token" }];
  });

  it.each(["local", "dev-private"])("identifies an owner client token on %s without stored pairing metadata", (host) => {
    fixture.target = host;
    noteHostAccess(host, { user: { ...owner, token: { id: "actual-token", label: "device" } } });
    expect(rendered()).toBe("<span>actual-token</span>");
  });

  it("uses the settings target, not another host's credential", () => {
    noteHostAccess("local", { user: { ...owner, token: { id: "focus-token" } } });
    noteHostAccess("ssh-other", { user: { ...owner, token: { id: "target-token" } } });
    fixture.target = "ssh-other";
    expect(rendered()).toBe("<span>target-token</span>");
  });

  it("does not turn an explicit root null into a device, even with stale pairing metadata", () => {
    fixture.target = "ssh-other";
    noteHostAccess(fixture.target, { user: { ...owner, token: null } });
    expect(rendered()).toBe("<span>no-device</span>");
    fixture.features.clear();
    expect(rendered()).toBe("<span>no-device</span>");
  });

  it("does not guess while a modern host has no usable token reply", () => {
    fixture.target = "ssh-other";
    expect(rendered()).toBe("<span>no-device</span>");
    noteHostAccess(fixture.target, { user: { ...owner, token: {} } });
    expect(rendered()).toBe("<span>no-device</span>");
  });

  it("retains explicit SSH pairing metadata only for older hosts", () => {
    fixture.features.clear();
    fixture.target = "ssh-other";
    noteHostAccess(fixture.target, { user: owner });
    expect(rendered()).toBe("<span>stored-old-token</span>");
    fixture.target = "local";
    expect(rendered()).toBe("<span>no-device</span>");
  });
});
