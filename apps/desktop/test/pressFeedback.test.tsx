// @vitest-environment jsdom
// Press feedback (owner 2026-11-18; press-feedback audit): one shared set of transient states for controls that are not a
// components/Button (styles.css `@utility press*`, named in components/Button), the pressed fill clearly deeper than the
// hover, the confirmed drag-region / focus-hidden bugs, and a pending state for buttons whose click starts a request.
// The computed styles in a real browser: scripts/qa-press-feedback.mjs (forced :active / :focus-visible on the preview).
import { readFileSync } from "node:fs";
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ bridge: {}, api: {}, onEvent: () => () => {}, cleanIpcMessage: (s: string) => s }));
vi.mock("../src/renderer/src/i18n", async (original) => ({
  ...(await original<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
const { RefreshButton } = await import("../src/renderer/src/components/settings/Form");
const { usePending } = await import("../src/renderer/src/lib/usePending");
const Button = await import("../src/renderer/src/components/Button");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const render = (node: ReactNode) => act(() => root.render(node));
const src = (rel: string) => readFileSync(`src/renderer/src/${rel}`, "utf8");
/** A promise settled from outside. */
function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("the shared primitives (styles.css)", () => {
  const css = src("styles.css");
  const block = (name: string) => css.slice(css.indexOf(`@utility ${name} {`), css.indexOf("\n}\n", css.indexOf(`@utility ${name} {`)));

  it("the pressed fill is clearly deeper than the hover (14 % vs 6 %)", () => {
    expect(css).toContain("--pressed: color-mix(in oklab, var(--fg) 14%, transparent);");
    expect(css).toMatch(/--hover: rgba\(20, 20, 30, 0\.06\)/);
  });

  it("press: the pressed fill, never on a disabled control", () => {
    expect(block("press")).toContain('&:active:not(:disabled, [aria-disabled="true"])');
    expect(block("press")).toContain("background-color: var(--pressed);");
  });

  it("press-icon: fill, press-in, accent focus ring, no hover face while disabled", () => {
    const b = block("press-icon");
    expect(b).toContain("transform: scale(0.92);");
    expect(b).toContain("outline: 2px solid var(--accent);");
    expect(b).toMatch(/:is\(:disabled, \[aria-disabled="true"\]\):hover \{\s*background-color: transparent;/);
  });

  it("press-solid darkens, press-avatar presses in with a ring, reveal-focus shows a hidden action on keyboard focus", () => {
    expect(block("press-solid")).toContain("filter: brightness(0.92);");
    expect(block("press-avatar")).toContain("transform: scale(0.94);");
    expect(block("press-avatar")).toContain("outline: 2px solid var(--accent);");
    expect(block("reveal-focus")).toMatch(/&:focus-visible \{\s*opacity: 1;/);
  });

  it("components/Button names them; ICON_GHOST is the Button shape with press-icon", () => {
    expect([Button.PRESS_ROW, Button.PRESS_ICON, Button.PRESS_SOLID, Button.PRESS_AVATAR, Button.REVEAL_ON_FOCUS]).toEqual(["press", "press-icon", "press-solid", "press-avatar", "reveal-focus"]);
    expect(Button.ICON_GHOST).toContain(Button.btnShape({ icon: true }));
    expect(Button.ICON_GHOST.split(" ")).toContain("press-icon");
    expect(Button.btn({ variant: "ghost" })).toContain("active:bg-pressed");
  });
});

describe("pending: a button whose click starts a request", () => {
  it("RefreshButton turns its icon and says busy until the request settles; repeat clicks are ignored; focus stays", async () => {
    const d = deferred();
    const onClick = vi.fn(() => d.promise);
    render(h(RefreshButton, { onClick, label: "Reload" }));
    const b = host.querySelector("button")!;
    expect(b.getAttribute("aria-busy")).toBeNull();
    act(() => b.click());
    expect(b.getAttribute("aria-busy")).toBe("true");
    expect(b.hasAttribute("data-pending")).toBe(true);
    expect(b.querySelector("svg")!.getAttribute("class")).toContain("animate-spin");
    // Not disabled: the keyboard focus would drop to the page.
    expect(b.disabled).toBe(false);
    act(() => b.click());
    expect(onClick).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve());
    expect(b.getAttribute("aria-busy")).toBeNull();
    expect(b.querySelector("svg")!.getAttribute("class") ?? "").not.toContain("animate-spin");
  });

  it("a failed request ends the pending state too; a handler without a promise never shows it", async () => {
    const d = deferred();
    render(h(RefreshButton, { onClick: () => d.promise }));
    const b = host.querySelector("button")!;
    act(() => b.click());
    expect(b.getAttribute("aria-busy")).toBe("true");
    await act(async () => d.reject(new Error("offline")));
    expect(b.getAttribute("aria-busy")).toBeNull();
    const plain = vi.fn();
    render(h(RefreshButton, { onClick: plain }));
    act(() => host.querySelector("button")!.click());
    expect(plain).toHaveBeenCalledTimes(1);
    expect(host.querySelector("button")!.getAttribute("aria-busy")).toBeNull();
  });

  it("`pending` from the caller (a load started elsewhere) shows it as well", () => {
    render(h(RefreshButton, { onClick: () => {}, pending: true }));
    expect(host.querySelector("button")!.getAttribute("aria-busy")).toBe("true");
  });

  it("usePending survives an unmount before the request settles", async () => {
    const d = deferred();
    let run: ((f: () => unknown) => void) | null = null;
    function Probe() {
      run = usePending().run;
      return null;
    }
    render(h(Probe));
    act(() => run!(() => d.promise));
    act(() => root.render(null));
    await act(async () => d.resolve());
  });

  it("the composer quota ↻, the board ↻ and the approval rules 刷新 use it", () => {
    expect(src("components/Composer.tsx")).toMatch(/onClick=\{\(\) => refresh\.run\(\(\) => loadQuota\(profile, true\)\)\}/);
    expect(src("board/BoardApp.tsx")).toMatch(/data-board-refresh="" onClick=\{\(\) => refreshing\.run\(\(\) => bridge\.refresh\(\)\)\}/);
    expect(src("modules/approvals/ApprovalRules.tsx")).toContain("onClick={() => reloading.run(refresh)}");
    // Profile quota cards hand their request to RefreshButton (no `void`: the promise drives the pending state).
    expect(src("components/settings/ProfileQuota.tsx")).toContain("onClick={() => loadQuota(profile, true)}");
  });
});

describe("the confirmed bugs", () => {
  it("the identity chip is no-drag (with the sidebar collapsed it sits in the window bar's drag region)", () => {
    expect(src("components/IdentityMenu.tsx")).toMatch(/className=\{`\[app-region:no-drag\] press relative flex min-w-0 flex-1/);
  });
  it("the window bar's identity chip (sidebar collapsed) is no-drag and presses in", () => {
    const line = src("components/IdentityMenu.tsx").split("\n").find((l) => l.includes("relative ml-0.5 flex shrink-0 items-center rounded-full p-0.5"))!;
    expect(line).toContain("[app-region:no-drag] press-avatar");
  });
  it("the selected sidebar row presses too (its unlayered fill outranks the press utility, so the press is repeated there)", () => {
    expect(src("styles.css")).toContain('.sidebar-card :is([data-row-selected], [data-nav-active]).press:active:not(:disabled, [aria-disabled="true"]) {\n  background-color: color-mix(in oklab, var(--fg) 10%, var(--sidebar-active));');
  });
  it("the launchers' ⓘ is no-drag and the launchers use the shared bar icon button", () => {
    const launchers = src("components/side/TitleBarLaunchers.tsx");
    expect(launchers).toContain('<InfoMark text={multiInfo} className="hover-info px-0.5 [app-region:no-drag]" />');
    expect(launchers).toContain("const BTN = `[app-region:no-drag] relative ${ICON_GHOST}`;");
  });
  it("a solid confirm keeps its colour while pressed: the armed online control darkens instead of taking the grey fill", () => {
    const line = src("components/ConversationHeader.tsx").split("\n").find((l) => l.includes("ARMED_COUNTDOWN} press-solid bg-danger-solid"))!;
    expect(line).toBeTruthy();
    expect(line).toMatch(/`press text-subtle hover:bg-hover/);
    expect(line).not.toMatch(/className=\{`press flex/);
  });
  it("Popover gives its default trigger the pressed fill; a custom trigger keeps its own skin (the tray's lift, a field)", () => {
    const menu = src("components/Menu.tsx");
    expect(menu).toContain("className={triggerClassName ?? `press flex items-center gap-1");
    expect(src("modules/browser/MediaTrayButton.tsx")).toContain('triggerClassName="tray-item"');
  });
  it("a service row's ⋯ shows on keyboard focus (it stayed at opacity 0) and has a name", () => {
    const line = src("components/ServiceLine.tsx").split("\n").find((l) => l.includes("data-service-more"))!;
    for (const part of ["reveal-focus", "group-focus-within:opacity-100", "press-icon", 'aria-label={t("services.more")}']) expect(line).toContain(part);
  });
});

describe("pending is per target (cross-review: a switched Profile's refresh was swallowed)", () => {
  it("RefreshButton turned to another target while the old request runs: not waiting, and its click is sent", async () => {
    const d = deferred();
    const onClick = vi.fn((): unknown => d.promise);
    render(h(RefreshButton, { onClick, target: "local\u0000A" }));
    const b = () => host.querySelector("button")!;
    act(() => b().click());
    expect(b().getAttribute("aria-busy")).toBe("true");
    render(h(RefreshButton, { onClick: () => Promise.resolve(), target: "local\u0000B" }));
    expect(b().getAttribute("aria-busy")).toBeNull();
    const second = vi.fn(() => Promise.resolve());
    render(h(RefreshButton, { onClick: second, target: "local\u0000B" }));
    act(() => b().click());
    expect(second).toHaveBeenCalledTimes(1);
    // Back on A while its request still runs: shown waiting again, a repeat ignored.
    render(h(RefreshButton, { onClick, target: "local\u0000A" }));
    expect(b().getAttribute("aria-busy")).toBe("true");
    act(() => b().click());
    expect(onClick).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve());
    expect(b().getAttribute("aria-busy")).toBeNull();
  });
  it("the Settings quota cards and the composer ↻ key it by host + Profile, approval rules by host", () => {
    expect(src("components/settings/ProfileQuota.tsx").split("target={`${hostId}\\u0000${profile}`}").length - 1).toBe(2);
    expect(src("components/Composer.tsx")).toContain("const refresh = usePending(`${quotaHost}\\u0000${profile ?? \"\"}`);");
    expect(src("modules/approvals/ApprovalRules.tsx")).toContain("const reloading = usePending(useTargetHostId());");
  });
});
