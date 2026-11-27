// @vitest-environment jsdom
// 输入优化 boundaries (GPT review of 2d4a4a5de, its tests brought in as written; the composer.action host since
// 2026-11-26): an open action panel never lets the composer send, steer or queue the original draft; a cancel that
// overtakes the deferred IPC start means no request.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripTypeScriptTypes } from "node:module";
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { composerKeyAction } from "../src/renderer/src/lib/sendKeys";
import { composerCandidateKey } from "../src/renderer/src/lib/composerMentions";
import { delegationKeyAction } from "../src/renderer/src/lib/delegationTurn";
import { isImeComposing } from "../src/renderer/src/lib/ime";
import { undoKeyOf } from "../src/renderer/src/lib/draftUndo";
import { usePromptEnhance, type PromptEnhance } from "../src/renderer/src/modules/input-refinement/useRewrite";
import { TextRewrites } from "../src/main/textRewrite";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Composer's onKeyDown with an open composer.action that takes every key (its panel holds them). */
function composerHandler(_phase: "running" | "done" | "failed") {
  const source = readFileSync(join(__dirname, "../src/renderer/src/components/Composer.tsx"), "utf8");
  const start = source.indexOf("  const onKeyDown ="), end = source.indexOf("  const paletteRows", start);
  const send = vi.fn();
  const env = { text: "original draft", images: [], send, sendKeys: "queueFirst", busy: false,
    multilineNewline: false, composerKeyAction, composerCandidateKey, isImeComposing,
    delegationKeyAction, traceEnter: () => {}, popupCount: 0, selected: 0, profileMention: { open: false },
    paletteOpen: false, mentionPopupOpen: false, panel: null, anyOverlayOpen: () => false,
    sideLayersActive: () => false, textarea: { current: { selectionStart: 0, selectionEnd: 0 } },
    steersWaiting: 0, guardKeys: { delegation: false, allowSteerKeys: false },
    actions: { open: true, commandKey: () => false, openKey: (e: { preventDefault(): void }) => { e.preventDefault(); return true; } },
    undoKeyOf, travelDraft: vi.fn() };
  const body = stripTypeScriptTypes(source.slice(start, end), { mode: "transform" }) + "\nreturn onKeyDown;";
  return { send, handler: new Function(...Object.keys(env), body)(...Object.values(env)) };
}

it.each([
  ["failed", {}],
  ["running", { ctrlKey: true }],
  ["done", { ctrlKey: true }],
] as const)("an open %s enhance panel never dispatches Enter to the agent (%j)", (phase, modifiers) => {
  const { send, handler } = composerHandler(phase);
  handler({ key: "Enter", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
    ...modifiers, nativeEvent: {}, preventDefault: vi.fn(), timeStamp: performance.now() });
  expect(send).not.toHaveBeenCalled();
});

it("cancelling before the deferred IPC is dispatched never starts a provider request afterward", async () => {
  const main = new TextRewrites(30_000);
  let enhance!: PromptEnhance;
  const request = vi.fn((_method: string, _path: string, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }));
  const api = { textRewrite: (input: unknown) => main.run({ request } as never, input), cancelTextRewrite: (id: string) => main.cancel(id) };
  const call = { api: () => api as never, route: () => ({ mode: "agent" as const, sessionId: "cutex.test" }), sessionId: "cutex.test", uiLanguage: "zh-CN" };
  function Probe() { enhance = usePromptEnhance(call, "local|test"); return null; }
  const node = document.createElement("div"), root = createRoot(node);
  try {
    await act(async () => root.render(h(Probe)));
    await act(async () => { enhance.start("original draft", 0, 0, { id: "prompt-enhance-v1", kind: "enhance", v2: false }); enhance.cancel(); });
    expect(request).not.toHaveBeenCalled();
  } finally {
    main.cancelAll(); await act(async () => root.unmount());
  }
});
