// @vitest-environment jsdom
// @-mentions (owner 2026-10-26, replacing 10-25's 「@<formal name>」): the wire is the link itself and always carries the
// full id — [@name](cutex:agent/<id>), another host [@name@host](cutex:agent/<id>@host) — so renames, duplicate names,
// recreated names and same-named agents elsewhere never point at the wrong one; messages sent as 「@<formal name>」
// still show chips from the locally kept draft; old chip-markup messages render as chips; the chip never makes its
// line taller.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  state: { entries: new Map<string, any>(), hosts: { active: "local", hosts: [{ id: "local", label: "HOST-A" }, { id: "ws", label: "workstation" }] }, sidebars: {} as Record<string, any> },
  avatars: [] as { seed: string; size: number }[],
}));
vi.mock("../src/renderer/src/store", () => ({
  useApp: Object.assign((select: (state: typeof mocks.state) => unknown) => select(mocks.state), { getState: () => mocks.state }),
  sidebarOf: (state: typeof mocks.state, host: string) => state.sidebars[host] ?? null,
}));
vi.mock("../src/renderer/src/lib/agentLook", () => ({ agentIndex: (state: typeof mocks.state) => state.entries }));
vi.mock("../src/renderer/src/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
  translate: (key: string, vars: Record<string, string>) => (key === "mention.wire.project" ? `@${vars.name}（项目 ${vars.project}）` : key),
}));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ openMenuFrom: vi.fn() }));
vi.mock("../src/renderer/src/lib/menus", () => ({ copyText: vi.fn() }));
vi.mock("../src/renderer/src/components/Avatar", () => ({
  Avatar: (props: { seed: string; size: number }) => (mocks.avatars.push({ seed: props.seed, size: props.size }), h("span", { "data-avatar": props.seed })),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { mentionWireText, mentionPlainText, mentionRichText, noteMentionWire, wireForSend, resetMentionWireForTest, MENTION_WIRE_KEY } = await import("../src/renderer/src/lib/mentionWire");
const { agentMentionMarkdown } = await import("../src/renderer/src/lib/agentMentions");
const { MentionText } = await import("../src/renderer/src/components/MentionText");

const ASTRA = "cutex.00000000-0000-4000-8000-000000000002";
const TWIN = "cutex.ag-astra-twin";
const FAR = "cutex.ag-far";
const OTHER = "cutex.ag-other";
const OLD = "cutex.ag-old";
const ME = "cutex.ag-me";

function agent(id: string, displayName: string, formalAgentName: string | null, hostId = "local", projectId: string | null = "p1") {
  mocks.state.entries.set(id, { hostId, row: { projectId }, session: { cutexSessionId: id, displayName, formalAgentName, lifecycle: "active", runtime: { status: "online" } } });
}
const chip = (name: string, id: string) => agentMentionMarkdown(name, id);

let root: Root, div: HTMLDivElement;
beforeEach(() => {
  localStorage.clear(); resetMentionWireForTest(); mocks.avatars = [];
  mocks.state.entries = new Map();
  mocks.state.sidebars = { local: { hostRows: { [ME]: { projectId: "p1" } }, projects: { projects: [{ project_id: "p2", presentation: { display_name: "kks" } }] } } };
  agent(ME, "Me", "me");
  agent(ASTRA, "Astra", "astra-composer");
  agent(FAR, "Far", "far-agent", "ws");
  agent(OTHER, "Other", "other-agent", "local", "p2");
  agent(OLD, "Old", null);
  div = document.createElement("div"); document.body.append(div); root = createRoot(div);
});
afterEach(() => { act(() => root.unmount()); div.remove(); });

describe("the wire text", () => {
  it("same host (any project): [@name](cutex:agent/<full id>), under the current display name", () => {
    expect(mentionWireText(`请 ${chip("Astra", ASTRA)} 看看`, "local", ME)).toBe(`请 [@Astra](cutex:agent/${ASTRA}) 看看`);
    expect(mentionWireText(chip("Other", OTHER), "local", ME)).toBe(`[@Other](cutex:agent/${OTHER})`);
    mocks.state.entries.get(ASTRA).session.displayName = "Astra Prime";
    expect(mentionWireText(chip("Astra", ASTRA), "local", ME)).toBe(`[@Astra Prime](cutex:agent/${ASTRA})`);
  });
  it("an owner-set 显示名称 never goes out: the agent gets its own name (owner 2026-11-05)", () => {
    Object.assign(mocks.state.entries.get(ASTRA).session, { displayName: "小星", displayNameOverride: "小星" });
    expect(mentionWireText(chip("小星", ASTRA), "local", ME)).toBe(`[@astra-composer](cutex:agent/${ASTRA})`);
    Object.assign(mocks.state.entries.get(FAR).session, { displayName: "远方", displayNameOverride: "远方" });
    expect(mentionWireText(chip("远方", FAR), "local", ME)).toBe(`[@far-agent@workstation](cutex:agent/${FAR}@workstation)`);
    // The owner still reads the 显示名称 on the chip of a sent message; a copy carries the own name like the wire.
    act(() => root.render(h(MentionText, { text: `[@astra-composer](cutex:agent/${ASTRA}) 看看`, hostId: "local", sessionId: ME })));
    expect(div.querySelector("[data-agent-mention-name]")?.textContent).toBe("@小星");
    expect(div.querySelector<HTMLElement>("[data-agent-mention]")?.dataset.agentMentionWire).toBe(`[@astra-composer](cutex:agent/${ASTRA})`);
    // Not in the current lists: the name it was written with.
    expect(mentionWireText(chip("Gone", "cutex.ag-gone"), "local", ME)).toBe("[@Gone](cutex:agent/cutex.ag-gone)");
  });
  it("another host: [@name@host](cutex:agent/<id>@host); from that host itself, no suffix", () => {
    expect(mentionWireText(chip("Far", FAR), "local", ME)).toBe(`[@Far@workstation](cutex:agent/${FAR}@workstation)`);
    expect(mentionWireText(chip("Far", FAR), "ws", ME)).toBe(`[@Far](cutex:agent/${FAR})`);
  });
  it("duplicate or missing names still go out by their full id; an unseen agent keeps its written name and host", () => {
    agent(TWIN, "Astra", "astra-composer");
    expect(mentionWireText(chip("Astra", ASTRA), "local", ME)).toBe(`[@Astra](cutex:agent/${ASTRA})`);
    expect(mentionWireText(chip("Old", OLD), "local", ME)).toBe(`[@Old](cutex:agent/${OLD})`);
    expect(mentionWireText(chip("Gone", "cutex.ag-gone-agent"), "local", ME)).toBe("[@Gone](cutex:agent/cutex.ag-gone-agent)");
    expect(mentionWireText(agentMentionMarkdown("Gone", "cutex.ag-gone-agent", "remote"), "local", ME)).toBe("[@Gone@remote](cutex:agent/cutex.ag-gone-agent@remote)");
  });
  it("a draft already in wire form is sent as it is (nothing to remember)", () => {
    const draft = `请 ${chip("Astra", ASTRA)} 看看`;
    expect(wireForSend("local", ME, draft)).toBe(draft);
    expect(localStorage.getItem(MENTION_WIRE_KEY)).toBeNull();
  });
  it("messages sent as 「@<formal name>」 (10-25 – 10-26) still get their chip form back from the kept draft", () => {
    const draft = `请 ${chip("Astra", ASTRA)} 看看`;
    noteMentionWire("local", ME, "请 @astra-composer 看看", draft);
    expect(mentionRichText("local", ME, "请 @astra-composer 看看")).toBe(draft);
    expect(mentionRichText("ws", ME, "请 @astra-composer 看看")).toBe("请 @astra-composer 看看");
    resetMentionWireForTest();
    expect(mentionRichText("local", ME, "请 @astra-composer 看看")).toBe(draft);
  });
  it("copy gives the names as shown", () => {
    expect(mentionPlainText(`hi ${chip("Astra", ASTRA)}!`)).toBe("hi @Astra!");
  });
});

describe("user bubble", () => {
  it("renders an old chip-markup message as chips without the escapes", () => {
    agent("cutex.41194d0d-0000-4000-8000-000000000001", "next-strip-linger", "next-strip-linger");
    const text = String.raw`[@Astra](cutex:agent/${ASTRA}) 和 [@next\-strip\-linger](cutex:agent/cutex.41194d0d-0000-4000-8000-000000000001) 看看`;
    act(() => root.render(h(MentionText, { text, hostId: "local", sessionId: ME })));
    expect(div.querySelectorAll("[data-agent-mention]")).toHaveLength(2);
    expect(div.textContent).toBe("@Astra 和 @next-strip-linger 看看");
    expect(div.textContent).not.toContain("cutex:agent");
  });
  it("renders a sent message as chips, under the current display name; another host's link shows the name only", () => {
    const wire = wireForSend("local", ME, `${chip("Astra", ASTRA)} 你好 ${agentMentionMarkdown("Far", FAR, "workstation")}`);
    mocks.state.entries.get(ASTRA).session.displayName = "Astra Prime";
    act(() => root.render(h(MentionText, { text: wire, hostId: "local", sessionId: ME })));
    expect(div.querySelector(`[data-agent-mention="${ASTRA}"]`)).not.toBeNull();
    expect(div.textContent).toBe("@Astra Prime 你好 @Far");
  });
  it("an id not in the current lists (archived, host offline) falls back to a plain @name chip", () => {
    act(() => root.render(h(MentionText, { text: "[@Ghost@remote](cutex:agent/cutex.ag-ghost@remote) 在吗", hostId: "local", sessionId: ME })));
    const ghost = div.querySelector('[data-agent-mention="cutex.ag-ghost"]')!;
    expect(ghost.textContent).toBe("@Ghost");
    expect(ghost.querySelector("[data-mention-avatar]")).toBeNull();
    expect(ghost.getAttribute("role")).toBeNull();
  });

  it("plain text stays plain", () => {
    act(() => root.render(h(MentionText, { text: "@astra 没有链接", hostId: "local", sessionId: ME })));
    expect(div.querySelector("[data-agent-mention]")).toBeNull();
    expect(div.textContent).toBe("@astra 没有链接");
  });
});

describe("mention text spacing", () => {
  // Browser line-box geometry is tested by scripts/mention-line-box.mjs; jsdom cannot lay out text.
  it("does not add whitespace between the chip label and adjacent punctuation or the next line", () => {
    act(() => root.render(h(MentionText, { text: `我给 ${chip("Astra", ASTRA)}批准了。\n下一行`, hostId: "local", sessionId: ME })));
    expect(div.textContent).toBe("我给 @Astra批准了。\n下一行");
    expect(div.querySelector("[data-agent-mention-name]")?.textContent).toBe("@Astra");
  });
});
