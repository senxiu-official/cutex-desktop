// @vitest-environment jsdom
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/store", () => ({ useApp: (selector: (state: Record<string, never>) => unknown) => selector({}) }));
vi.mock("../src/renderer/src/lib/conversationScope", () => ({
  useConvHost: () => "local",
  useConvScope: () => null,
  convFeaturesOf: () => ({ has: () => false }),
}));
vi.mock("../src/renderer/src/lib/prefs", () => ({ useUiPrefs: () => ({ agentMessages: "compact" }) }));
vi.mock("../src/renderer/src/lib/userLayoutToggle", () => ({ useUserLayoutToggle: () => (action: () => void) => action() }));
vi.mock("../src/renderer/src/lib/wakeBusyWaitView", () => ({ useWakeHint: () => null }));
vi.mock("../src/renderer/src/lib/agentMessageStore", () => ({ useAgentMessage: () => null }));
vi.mock("../src/renderer/src/components/MessageSettlementControl", () => ({ MessageSettlementControl: () => null }));
vi.mock("../src/renderer/src/components/SystemAvatar", () => ({
  SenderAvatar: () => h("span", { "data-testid": "sender-avatar", className: "shrink-0" }),
}));

const { BusMessage } = await import("../src/renderer/src/components/BusMessage");

const render = (name: string, text: string) => renderToStaticMarkup(h(BusMessage, {
  direction: "in",
  name,
  mode: null,
  text,
  onContextMenu: () => {},
}));

describe("BusMessage compact row layout", () => {
  it("keeps the sender name whole and gives remaining width to the preview", () => {
    const html = render("Kittiwake", "r266 desktop：实现/修复 artifact path copy and make sure the long preview collapses");
    const name = html.match(/<span[^>]*data-testid="bus-message-name"[^>]*>/)![0];
    const preview = html.match(/<span[^>]*data-testid="bus-message-preview"[^>]*>/)![0];

    expect(name).toContain('title="Kittiwake"');
    expect(name).toContain('class="min-w-0 max-w-[16em] shrink-0 truncate whitespace-nowrap font-medium text-foreground"');
    expect(html).toContain(">Kittiwake</span>");
    expect(preview).toContain('class="min-w-0 flex-1 truncate text-subtle"');
    expect(html).not.toContain("message-body");
  });

  it("caps an absurd sender name with a tooltip", () => {
    const name = "K".repeat(80);
    const html = render(name, "short preview");
    const tag = html.match(/<span[^>]*data-testid="bus-message-name"[^>]*>/)![0];
    expect(tag).toContain(`title="${name}"`);
    expect(tag).toContain("max-w-[16em]");
  });
});
