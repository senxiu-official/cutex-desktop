// @vitest-environment jsdom
// 添加主机 → 用令牌连接 (renderer): the mode switch, the password field cleared after every submit, the words
// after a successful import (who / scope / projects), import errors in plain words, 重新导入令牌 keeping the host,
// and the owner's issue-command hint on 用户 (components/settings/HostTokenImport.tsx, lib/hostTokenImport.ts).
import { createElement as h } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  calls: [] as unknown[],
  result: null as unknown,
  notify: vi.fn(),
  sidebar: null as unknown,
}));
vi.mock("../src/renderer/src/bridge", () => ({
  api: {
    sshConfigHosts: async () => ["remote-ema"],
    importSshHostToken: async (request: unknown) => (fx.calls.push(request), fx.result),
  },
}));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${Object.values(vars).join("|")}` : key) }) }));
vi.mock("../src/renderer/src/store", () => ({ useApp: (pick: (s: unknown) => unknown) => pick({ notify: fx.notify }) }));
vi.mock("../src/renderer/src/lib/useHostScope", () => ({ useHostsData: () => (fx.sidebar ? [{ sidebar: fx.sidebar }] : []) }));
vi.mock("../src/renderer/src/lib/menus", () => ({ copyText: vi.fn() }));
vi.mock("../src/renderer/src/components/settings/OwnerDevices", () => ({ scopeLabel: (_t: unknown, scope: string) => `scope-${scope}` }));
vi.mock("../src/renderer/src/components/settings/Form", async () => {
  const { createElement: e } = await import("react");
  return {
    SettingRow: ({ label, hint, children }: any) => e("div", { "data-row": label }, hint, children),
    RowGroup: ({ title, children }: any) => e("div", { "data-row-group": title }, children),
    SettingsGroup: ({ children }: any) => children,
    Button: ({ children, onClick, disabled }: any) => e("button", { type: "button", onClick, disabled }, children),
    TextInput: ({ value, onChange, type, label }: any) => e("input", { value, type, "aria-label": label, onChange: (ev: any) => onChange(ev.target.value) }),
    RadioList: ({ options, value, onChange }: any) => e("div", {}, options.map((o: any) => e("input", { key: o.value, type: "radio", value: o.value, checked: value === o.value, onChange: () => onChange(o.value) }))),
  };
});

import { AddHostChooser, IssueTokenHint, ReimportToken } from "../src/renderer/src/components/settings/HostTokenImport";
import { cleanToken, isTokenImportHost, issueTokenCommand, tokenProblemKey } from "../src/renderer/src/lib/hostTokenImport";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, box: HTMLDivElement;
beforeEach(() => {
  fx.calls = [];
  fx.result = null;
  fx.sidebar = null;
  fx.notify.mockReset();
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
});
afterEach(() => {
  act(() => root.unmount());
  box.remove();
});

const type = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const button = (text: string) => [...box.querySelectorAll("button")].find((b) => b.textContent === text)!;
const click = async (el: HTMLElement) => {
  await act(async () => {
    el.click();
    await new Promise((r) => setTimeout(r, 0));
  });
};
const openTokenMode = async (onDone = vi.fn()) => {
  await act(async () => root.render(h(AddHostChooser, { pair: h("p", { "data-pair": "" }), onDone })));
  expect(box.querySelector("[data-pair]")).not.toBeNull();
  await click(box.querySelector<HTMLInputElement>('input[value="token"]')!);
  expect(box.querySelector("[data-token-import-form]")).not.toBeNull();
};
const fill = async (token: string) => {
  await type(box.querySelector<HTMLInputElement>('input[aria-label="host.add.target"]')!, "remote-ema");
  await type(box.querySelector<HTMLInputElement>('input[aria-label="host.add.port"]')!, "24371");
  await type(box.querySelector<HTMLInputElement>('input[aria-label="host.token.token"]')!, token);
};
const tokenField = () => box.querySelector<HTMLInputElement>('input[aria-label="host.token.token"]');

describe("lib/hostTokenImport", () => {
  it("maps import errors to their own words, others to the general host problem", () => {
    expect(tokenProblemKey({ code: "refused" })).toBe("host.token.problem.unreachable");
    expect(tokenProblemKey({ code: "timeout" })).toBe("host.token.problem.unreachable");
    expect(tokenProblemKey({ code: "forwardDenied" })).toBe("host.token.problem.forwardDenied");
    expect(tokenProblemKey({ code: "tokenRejected" })).toBe("host.token.problem.tokenRejected");
    expect(tokenProblemKey({ code: "hostMismatch" })).toBe("host.token.problem.hostMismatch");
    expect(tokenProblemKey({ code: "remoteDaemon" })).toBe("host.token.problem.remoteDaemon");
    expect(tokenProblemKey({ code: "auth" })).toBe("host.problem.auth");
  });
  it("cleans a pasted token, names token hosts, and spells the owner's command", () => {
    expect(cleanToken("  ab12\n cd34 \r\n")).toBe("ab12cd34");
    expect(isTokenImportHost({ kind: "ssh", pairingMode: "tokenImport" })).toBe(true);
    expect(isTokenImportHost({ kind: "ssh", pairingMode: "ssh" })).toBe(false);
    expect(isTokenImportHost({ kind: "ssh" })).toBe(false);
    expect(issueTokenCommand("u-ema")).toBe("cutex management client-token issue --user u-ema --scope full");
  });
});

describe("添加主机 → 用令牌连接", () => {
  it("sends target / port / cleaned token, clears the password field, then says who you are there", async () => {
    fx.result = { ok: true, hostId: "ssh-1", access: { hostId: "ssh-1", featureList: [], user: { isOwner: false, pending: false, userId: "u-ema", name: "ema", displayName: "Ema", grant: { projects: ["p1"], standaloneAgents: [], send: true }, scope: "chat" } } };
    fx.sidebar = { projects: { projects: [{ project_id: "p1", lifecycle: "active", presentation: { display_name: "Thesis" } }] }, hostRows: {}, active: [] };
    const onDone = vi.fn();
    await openTokenMode(onDone);
    expect(tokenField()!.type).toBe("password");
    await fill(" ct_secret_token \n");
    await click(button("host.token.submit"));
    expect(fx.calls).toEqual([{ token: "ct_secret_token", target: "remote-ema", remotePort: 24371, label: undefined }]);
    const result = box.querySelector("[data-token-import-result]")!;
    expect(result.textContent).toContain("host.token.result.title:remote-ema");
    expect(result.textContent).toContain("host.token.result.who:Ema");
    expect(result.textContent).toContain("host.token.result.scope:scope-chat");
    expect(result.textContent).toContain("Thesis");
    expect(box.innerHTML).not.toContain("ct_secret_token");
    await click(button("host.token.result.done"));
    expect(onDone).toHaveBeenCalled();
  });

  it("an error in plain words; the token is gone from the field, the address stays", async () => {
    fx.result = { ok: false, error: { code: "forwardDenied", detail: "administratively prohibited" } };
    await openTokenMode();
    await fill("ct_secret_token");
    await click(button("host.token.submit"));
    expect(box.querySelector("[data-token-problem]")!.textContent).toContain("host.token.problem.forwardDenied");
    expect(tokenField()!.value).toBe("");
    expect(box.querySelector<HTMLInputElement>('input[aria-label="host.add.target"]')!.value).toBe("remote-ema");
    expect(button("host.token.submit").disabled).toBe(true);
  });

  it("an unassigned token says it waits for the owner", async () => {
    fx.result = { ok: true, hostId: "ssh-2", access: { hostId: "ssh-2", featureList: [], user: { isOwner: false, pending: true, userId: null, name: null, grant: null } } };
    await openTokenMode();
    await fill("ct_pending_token");
    await click(button("host.token.submit"));
    expect(box.querySelector("[data-token-import-result]")!.textContent).toContain("host.token.result.pending");
  });
});

describe("重新导入令牌", () => {
  it("rotates by host id only and clears the field", async () => {
    fx.result = { ok: true, hostId: "ssh-1" };
    const onClose = vi.fn();
    await act(async () => root.render(h(ReimportToken, { host: { id: "ssh-1", label: "Remote" }, onClose })));
    await type(tokenField()!, "ct_new_token");
    await click(button("host.token.reimportSubmit"));
    expect(fx.calls).toEqual([{ hostId: "ssh-1", token: "ct_new_token" }]);
    expect(fx.notify).toHaveBeenCalledWith("host.token.reimported:Remote");
    expect(onClose).toHaveBeenCalled();
  });
  it("a refused token stays on the page in plain words", async () => {
    fx.result = { ok: false, error: { code: "tokenRejected", detail: "" } };
    const onClose = vi.fn();
    await act(async () => root.render(h(ReimportToken, { host: { id: "ssh-1", label: "Remote" }, onClose })));
    await type(tokenField()!, "bad_token_x");
    await click(button("host.token.reimportSubmit"));
    expect(box.querySelector("[data-token-problem]")!.textContent).toContain("host.token.problem.tokenRejected");
    expect(tokenField()!.value).toBe("");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("用户 → the owner's issue hint", () => {
  it("shows the command and the user id, each with a copy button", async () => {
    await act(async () => root.render(h(IssueTokenHint, { userId: "u-ema" })));
    const copies = [...box.querySelectorAll<HTMLElement>("[data-copy]")].map((b) => b.dataset.copy);
    expect(copies).toEqual(["cutex management client-token issue --user u-ema --scope full", "u-ema"]);
  });
});
