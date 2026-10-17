// 复制到其他主机 dialog (components/settings/CopyProfileToHostDialog): one page — target host, new name,
// the credential row of the profile's kind (API key checkbox on by default; ChatGPT: log in again;
// Claude: the target's account), 复制.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProfileItem } from "../src/shared/ipc";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, p?: Record<string, unknown>) => (p ? `${key}(${Object.values(p).join(",")})` : key), locale: "en" }),
}));
const state = { hosts: { active: "local" }, openSettings: () => {} };
vi.mock("../src/renderer/src/store", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useApp: Object.assign((select: (s: unknown) => unknown) => select(state), { getState: () => state, setState: () => {}, subscribe: () => () => {} }),
}));
vi.mock("../src/renderer/src/lib/useTransferTargets", () => ({ useTransferTargets: () => ["ssh-bbbb2222"] }));
vi.mock("../src/renderer/src/lib/useHostScope", () => ({ useHostScope: () => ({ host: (id: string) => ({ label: id === "local" ? "box-b" : "box-a" }) }) }));

const { CopyProfileToHostDialog } = await import("../src/renderer/src/components/settings/CopyProfileToHostDialog");

const item = (patch: Partial<ProfileItem>): ProfileItem => ({ id: "p1", name: "GLM", cliKind: "codex", source: "api-key", authPresent: true, authKind: "apiKey", ...patch }) as ProfileItem;
const render = (p: Partial<ProfileItem>) => renderToStaticMarkup(h(CopyProfileToHostDialog, { item: item(p), sourceHostId: "local", onClose: () => {} }));

describe("CopyProfileToHostDialog", () => {
  it("API-key profile: target host, the source name, the key checkbox on", () => {
    const html = render({});
    expect(html).toContain('role="dialog"');
    expect(html).toContain("agent-config.profile.transfer.title(GLM)");
    expect(html).toContain('<option value="ssh-bbbb2222" selected="">box-a</option>');
    expect(html).toContain('value="GLM"');
    expect(html).toMatch(/role="checkbox" aria-checked="true" aria-label="agent-config.profile.transfer.apiKey"/);
    expect(html).toContain("agent-config.profile.transfer.apiKeyHint(box-b)");
    expect(html).not.toContain("agent-config.profile.transfer.chatgpt");
  });

  it("API-key profile without a key: no checkbox, enter it on the target", () => {
    const html = render({ authPresent: false, authKind: "none" });
    expect(html).not.toContain('role="checkbox"');
    expect(html).toContain("agent-config.profile.transfer.apiKeyMissing");
  });

  it("ChatGPT (also logged out) and Claude profiles explain what happens to the login", () => {
    expect(render({ source: "official", authKind: "none", authPresent: false })).toContain("agent-config.profile.transfer.chatgpt");
    expect(render({ source: "official", authKind: "chatgpt" })).not.toContain('role="checkbox"');
    expect(render({ cliKind: "claude", source: "official", authKind: "claude" })).toContain("agent-config.profile.transfer.claude");
  });
});
