// 复制地址 / 复制端口 for a service (lib/serviceAddress, owner report 2026-11-09): on this machine the loopback
// address, never cutex's `url` (http://<machine name>:<port>/); on another host the same address labelled as that
// host's own, and nothing is copied until a row is chosen.
import { describe, expect, it, vi } from "vitest";
import type { MenuAction, MenuEntry } from "../src/renderer/src/lib/contextMenu";
import { sameMachine, serviceAddressOf, serviceCopyEntries, serviceTabPath } from "../src/renderer/src/lib/serviceAddress";

const t = (key: string, vars?: Record<string, string | number>) => (vars ? `${key} ${JSON.stringify(vars)}` : key);
const rows = (entries: MenuEntry[]) => entries.filter((e): e is MenuAction => !!e && e !== "separator");
const svc = { url: "http://host-02:24421/", localUrl: "http://127.0.0.1:24421/", port: 24421 };

describe("service address", () => {
  it("same machine: the local host and dev loopback hosts; an SSH host is another machine", () => {
    expect(sameMachine("local", undefined)).toBe(true);
    expect(sameMachine("dev-a", { kind: "dev-direct" })).toBe(true);
    expect(sameMachine("ssh-remote", { kind: "ssh" })).toBe(false);
    expect(sameMachine("ssh-remote", undefined)).toBe(false);
  });

  it("this machine: copies http://127.0.0.1:<port>/ and the port, not the machine name", () => {
    const copy = vi.fn();
    const a = serviceAddressOf(svc, "local", { kind: "local", label: "HOST-02" });
    expect(a).toEqual({ address: "http://127.0.0.1:24421/", port: 24421, remoteHost: null });
    const items = rows(serviceCopyEntries(a, t, copy));
    expect(items.map((i) => i.label)).toEqual(["services.copyUrl", "services.copyPort"]);
    expect(items.every((i) => i.info === undefined)).toBe(true);
    expect(copy).not.toHaveBeenCalled();
    void items[0]!.onSelect();
    void items[1]!.onSelect();
    expect(copy.mock.calls).toEqual([["http://127.0.0.1:24421/"], ["24421"]]);
  });

  it("another host: the same loopback address, named as that host's own and explained", () => {
    const a = serviceAddressOf(svc, "ssh-eva", { kind: "ssh", label: "HOST-02" });
    expect(a.remoteHost).toBe("HOST-02");
    const items = rows(serviceCopyEntries(a, t, vi.fn()));
    expect(items[0]!.label).toBe('services.copyHostLocalUrl {"host":"HOST-02"}');
    expect(items[0]!.info).toBe('services.copyHostLocalUrl.info {"host":"HOST-02"}');
    expect(items[1]!.info).toBe('services.copyPort.info {"host":"HOST-02"}');
  });

  it("a service tab keeps the page's path; static files (no port / address) offer nothing", () => {
    expect(serviceTabPath("cutex:service/photos/album/2?x=1")).toBe("/album/2?x=1");
    expect(serviceTabPath("cutex:service/photos")).toBe("/");
    expect(serviceTabPath("https://example.org/")).toBeNull();
    expect(serviceAddressOf(svc, "local", null, "/album/2?x=1").address).toBe("http://127.0.0.1:24421/album/2?x=1");
    const none = serviceAddressOf({ localUrl: null as unknown as string, port: null as unknown as number }, "local", null);
    expect(rows(serviceCopyEntries(none, t, vi.fn()))).toEqual([]);
  });
});
