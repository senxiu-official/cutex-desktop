// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { InteractionDock } from "../src/renderer/src/components/InteractionDock";
import { answerFailureOf, questionTrim, questionOptionsV1, toInteraction, type PendingRequest } from "../src/renderer/src/lib/interactions";
import { questionAnswer, questionAnswers, questionDraftKey, questionSchemaIdentity, readQuestionDraft, writeQuestionDraft } from "../src/renderer/src/lib/questionDrafts";
vi.mock("../src/renderer/src/i18n", () => ({ translate: (key: string) => key, useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/components/ApprovalSource", () => ({ ApprovalSource: () => null }));
const api = vi.hoisted(() => ({ respond: vi.fn(), bootstrap: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({ api, onEvent: () => () => {} }));
// Loading the real store transforms the full module graph. Keep that fixture
// setup outside the answer-restoration test's normal five-second deadline.
beforeAll(async () => {
  await import("../src/renderer/src/store");
  await import("../src/renderer/src/lib/timeline");
}, 60_000);
const scope = { hostId: "eva", sessionId: "agent", runtimeGeneration: 7 };
const rich = { version: 1 as const, question: "Clean question", multiSelect: true, options: [
  { label: "A", description: "Alpha", preview: '<img src="https://example.com" onerror="alert(1)"><script>alert(2)</script>' },
  { label: "B", description: "Beta" },
] };
const q = (id = "q0") => ({ id, header: "Choice", question: "Legacy fallback", isOther: true, isSecret: false, options: null, cutexQuestionOptions: rich });
const request = (questions: unknown[] = [q()]): PendingRequest => ({ id: 4, method: "item/tool/requestUserInput", params: { questions, isBlocking: true } });
let host: HTMLDivElement, root: Root;
const reply = vi.fn();
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); reply.mockReset(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const draw = (pending = [request()], optionsV1 = true, draftScope = scope) => act(() => root.render(h(InteractionDock, { pending, optionsV1, draftScope, onReply: reply })));
const button = (text: string) => [...host.querySelectorAll("button")].find(b => b.textContent?.includes(text))!;
const click = (text: string) => act(() => button(text).click());
const type = (text: string) => act(() => {
  const input = host.querySelector("input")!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
const projected = (req = request()) => {
  const m = toInteraction(req, true);
  if (m.kind !== "questions") throw Error("not questions");
  return m.questions;
};
it("r269 ignores enrichment without capability and uses fallback free text", () => {
  draw([request()], false);
  expect(host.textContent).toContain("Legacy fallback"); expect(host.textContent).not.toContain("Clean question");
  expect(host.querySelector("details")).toBeNull(); type("Legacy answer"); click("interaction.submit");
  expect(reply).toHaveBeenCalledWith(expect.anything(), { result: { answers: { q0: { answers: ["Legacy answer"] } } } });
});
it("old hosts and capable hosts without valid enrichment retain immediate single options", () => {
  for (const enabled of [false, true]) {
    draw([request([{ ...q(), options: [{ label: "Old", description: "" }], cutexQuestionOptions: { ...rich, version: 2 } }])], enabled);
    click("Old");
    expect(reply).toHaveBeenLastCalledWith(expect.anything(), { result: { answers: { q0: { answers: ["Old"] } } } });
  }
  draw([request([{ ...q(), options: [{ label: "Old", description: "" }], cutexQuestionOptions: undefined }])]); click("Old");
  expect(reply).toHaveBeenCalledTimes(3);
});
it("multi toggles selections, combines one Other entry and submits explicitly", () => {
  draw(); expect(button("interaction.submit").disabled).toBe(true);
  click("Alpha"); click("Beta"); expect(reply).not.toHaveBeenCalled(); click("Alpha"); type("Custom"); click("interaction.submit");
  expect(reply).toHaveBeenCalledWith(expect.anything(), { result: { answers: { q0: { answers: ["B", "Custom"] } } } });
});
it("preview HTML stays inert text without links, images or script nodes", () => {
  draw(); expect(host.querySelector("pre")!.textContent).toBe(rich.options[0]!.preview); expect(host.querySelector("img,script,iframe,a")).toBeNull();
});
it("preserves options, free text and index through back, remount and storage reload", () => {
  const pending = [request([q(), q("q1")])];
  draw(pending); click("Alpha"); type("Custom"); click("interaction.next"); click("Beta"); click("interaction.back");
  expect(host.querySelector("input")!.value).toBe("Custom"); expect(button("Alpha").getAttribute("aria-pressed")).toBe("true");
  click("interaction.next"); draw([]); draw(pending);
  expect(host.textContent).toContain("2 / 2"); expect(button("Beta").getAttribute("aria-pressed")).toBe("true");
  const questions = projected(pending[0]!);
  const restored = readQuestionDraft(questionDraftKey(scope, pending[0]!, questions), questions);
  expect(restored.index).toBe(1); expect(restored.answers.q0).toEqual({ selected: ["A"], text: "Custom" });
});
it("isolates host, session, generation, typed native ID and schema identities", () => {
  draw(); click("Alpha"); type("Draft");
  for (const changed of [{ ...scope, hostId: "host-b" }, { ...scope, sessionId: "other" }, { ...scope, runtimeGeneration: 8 }]) {
    draw([request()], true, changed); expect(host.querySelector("input")!.value).toBe(""); expect(button("Alpha").getAttribute("aria-pressed")).toBe("false");
  }
  draw([{ ...request(), id: "4" }]); expect(host.querySelector("input")!.value).toBe("");
  draw([request([{ ...q(), cutexQuestionOptions: { ...rich, question: "Changed" } }])]); expect(host.querySelector("input")!.value).toBe("");
  draw(); expect(host.querySelector("input")!.value).toBe("Draft");
});
it("old-scope edits cannot overwrite newer generation drafts", () => {
  draw(); click("Alpha"); draw([request()], true, { ...scope, runtimeGeneration: 8 }); click("Beta");
  draw(); type("Old generation"); draw([request()], true, { ...scope, runtimeGeneration: 8 });
  expect(button("Beta").getAttribute("aria-pressed")).toBe("true"); expect(host.querySelector("input")!.value).toBe("");
});
it("failed response / void callback and transient pending absence preserve the full draft", () => {
  draw(); click("Alpha"); type("Retry me"); click("interaction.submit");
  expect(answerFailureOf(new Error("invalid_question_answer: invalid"))).toBe("retry");
  draw([]); draw(); expect(host.querySelector("input")!.value).toBe("Retry me");
  expect(button("Alpha").getAttribute("aria-pressed")).toBe("true"); click("interaction.submit"); expect(reply).toHaveBeenCalledTimes(2);
});
it("number keys toggle multi without submitting, ignoring IME, input, modifier and repeat", () => {
  draw(); const card = host.querySelector('[tabindex="-1"]')!;
  const key = (target: Element, props = {}) => act(() => target.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true, cancelable: true, ...props })));
  key(card); expect(button("Alpha").getAttribute("aria-pressed")).toBe("true"); expect(reply).not.toHaveBeenCalled();
  for (const props of [{ isComposing: true }, { ctrlKey: true }, { repeat: true }]) key(card, props);
  key(host.querySelector("input")!); expect(button("Alpha").getAttribute("aria-pressed")).toBe("true");
  key(card); expect(button("Alpha").getAttribute("aria-pressed")).toBe("false");
});
it("single enhanced requires exactly one and respects isOther false", () => {
  draw([request([{ ...q(), isOther: false, cutexQuestionOptions: { ...rich, multiSelect: false } }])]);
  expect(host.querySelector("input")).toBeNull(); click("Alpha"); expect(reply).not.toHaveBeenCalled(); click("Beta"); click("interaction.submit");
  expect(reply).toHaveBeenCalledWith(expect.anything(), { result: { answers: { q0: { answers: ["B"] } } } });
});
it("validates nonempty distinct answers and UTF-8 individual and total limits", () => {
  const question = projected()[0]!;
  for (const text of [" A ", "字".repeat(21846)]) expect(questionAnswer(question, { selected: ["A"], text })).toBeNull();
  expect(questionAnswer(question, { selected: [], text: "   " })).toBeNull();
  expect(questionAnswer(question, { selected: [], text: "x".repeat(65536) })).toEqual(["x".repeat(65536)]);
  const questions = Array.from({ length: 5 }, (_, i) => ({ ...question, id: `q${i}` }));
  const answers = Object.fromEntries(questions.map(q => [q.id, { selected: [], text: "x".repeat(65536) }]));
  expect(questionAnswers(questions, { index: 4, answers })).toBeNull();
  expect(questionAnswer({ ...question, cutexQuestionOptions: { ...rich, multiSelect: false } }, { selected: ["A", "B"], text: "" })).toBeNull();
});
it("strict v1 rejects unknown fields, versions, wrong types, duplicate labels, oversized preview", () => {
  for (const bad of [null, [], { ...rich, version: "1" }, { ...rich, extra: true }, { ...rich, multiSelect: 1 }, { ...rich, options: [rich.options[0], rich.options[0]] }, { ...rich, options: [{ label: "A", description: 1 }] }, { ...rich, options: [{ label: "A", description: "", preview: "字".repeat(21846) }] }]) expect(questionOptionsV1(bad)).toBeNull();
  expect(questionOptionsV1(rich)).toEqual(rich);
});

it("real store invalid_question_answer restores pending and the dock restores its saved draft", async () => {
  const { useApp } = await import("../src/renderer/src/store");
  const { timelineFromThreadRead } = await import("../src/renderer/src/lib/timeline");
  const { viewKey } = await import("../src/renderer/src/lib/viewKey");
  const req = request();
  const timeline = timelineFromThreadRead({ thread: { id: "t", turns: [] } }, [{ runtimeGeneration: 7, native: req }]);
  useApp.setState({ selectedId: "agent", sessions: { [viewKey("local", "agent")]: { timeline, runtimeGeneration: 7, version: 0 } as never }, notice: null });
  const localScope = { ...scope, hostId: "local" };
  draw([req], true, localScope); click("Alpha"); type("Keep on error");
  let reject!: (error: Error) => void;
  api.respond.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  const sending = useApp.getState().respond(4, { result: { answers: { q0: { answers: ["A", "Keep on error"] } } } });
  expect(timeline.pending.size).toBe(0); draw([]);
  reject(new Error("invalid_question_answer: HTTP 400")); await sending;
  expect(timeline.pending.get("4")).toEqual(req);
  draw([...timeline.pending.values()], true, localScope);
  expect(host.querySelector("input")!.value).toBe("Keep on error");
  expect(button("Alpha").getAttribute("aria-pressed")).toBe("true");
});
it("arrows focus options without answering; Other IME Enter never submits", () => {
  draw(); const card = host.querySelector('[tabindex="-1"]')!;
  act(() => card.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  expect(document.activeElement).toBe(button("Alpha"));
  act(() => button("Alpha").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  expect(document.activeElement).toBe(button("Beta"));
  type("Composing");
  const event = new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true });
  act(() => host.querySelector("input")!.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true); expect(reply).not.toHaveBeenCalled();
});
it("invalid zero-option enrichment falls back to the base free-text question", () => {
  draw([request([{ ...q(), isOther: false, cutexQuestionOptions: { ...rich, options: [] } }])]);
  type("Free"); click("interaction.submit");
  expect(reply).toHaveBeenCalledWith(expect.anything(), { result: { answers: { q0: { answers: ["Free"] } } } });
});

it("schema scope ignores object insertion order and presentation but includes answer modes", () => {
  const questions = projected();
  const key = questionDraftKey(scope, request(), questions);
  const reordered = questions.map(q => ({ isSecret: q.isSecret, isOther: q.isOther, options: q.options, question: q.question, header: q.header, id: q.id, cutexQuestionOptions: q.cutexQuestionOptions }));
  expect(questionDraftKey(scope, request(), reordered)).toBe(key);
  expect(questionDraftKey(scope, request(), questions.map(q => ({ ...q, isSecret: true })))).not.toBe(key);
  const changed = projected(request([{ ...q(), cutexQuestionOptions: { ...rich, options: rich.options.map(o => ({ ...o, preview: "changed" })) } }]));
  expect(questionDraftKey(scope, request(), changed)).toBe(key);
});

it("Codex base-only legacy draft survives reload, back navigation and failed reply", () => {
  const legacy = (id: string) => ({ ...q(id), cutexQuestionOptions: undefined, options: [{ label: "Old", description: "" }] });
  const pending = [request([legacy("q0"), legacy("q1")])];
  draw(pending, false); type("First free entry"); click("interaction.next"); type("Second free entry");
  draw([]); draw(pending, false);
  expect(host.textContent).toContain("2 / 2"); expect(host.querySelector("input")!.value).toBe("Second free entry");
  act(() => host.querySelector('[tabindex="-1"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(host.querySelector("input")!.value).toBe("First free entry");
  click("interaction.next"); click("interaction.submit"); draw([]); draw(pending, false);
  expect(host.querySelector("input")!.value).toBe("Second free entry");
  expect(reply).toHaveBeenCalledWith(expect.anything(), { result: { answers: { q0: { answers: ["First free entry"] }, q1: { answers: ["Second free entry"] } } } });
});

it("question whitespace matches Python strip, including controls and excluding BOM", () => {
  expect(questionTrim("\u001c\u001d\u001e\u001f\u0085 A\u2003")).toBe("A");
  expect(questionTrim("\ufeffA\ufeff")).toBe("\ufeffA\ufeff");
  const question = projected()[0]!;
  expect(questionAnswer(question, { selected: [], text: "\u001c\u001f" })).toBeNull();
  expect(questionAnswer(question, { selected: ["A"], text: "\u001cA\u001f" })).toBeNull();
  expect(questionAnswer(question, { selected: ["\u001cA", "A"], text: "" })).toBeNull();
  expect(questionAnswer(question, { selected: [], text: "\ufeff" })).toEqual(["\ufeff"]);
  expect(questionOptionsV1({ ...rich, question: "\u001c\u001f" })).toBeNull();
  expect(questionOptionsV1({ ...rich, options: [{ label: "\u001c", description: "" }] })).toBeNull();
  expect(questionOptionsV1({ ...rich, options: [{ label: "A", description: "" }, { label: "\u001cA", description: "" }] })).toBeNull();
});
it("Other uses Python-compatible trim in both enriched and legacy cards", () => {
  for (const enabled of [true, false]) {
    draw([request()], enabled); type("\u001c\u001f"); expect(button("interaction.submit").disabled).toBe(true);
    type("\u001c custom \u001f"); click("interaction.submit");
    expect(reply).toHaveBeenLastCalledWith(expect.anything(), { result: { answers: { q0: { answers: ["custom"] } } } });
    draw([]);
  }
});
it("control-prefixed Other cannot duplicate an option after normalization", () => {
  draw(); click("Alpha"); type("\u001cA\u001f");
  expect(button("interaction.submit").disabled).toBe(true); expect(reply).not.toHaveBeenCalled();
});
it("bounded keys exclude huge previews/descriptions and collision-check exact schemas in values", () => {
  const questions = projected(); const key = questionDraftKey(scope, request(), questions)!;
  const huge = projected(request([{ ...q(), cutexQuestionOptions: { ...rich, options: rich.options.map(o => ({ ...o, description: "x".repeat(65536), preview: "x".repeat(65536) })) } }]));
  expect(questionDraftKey(scope, request(), huge)).toBe(key); expect(key.length).toBeLessThan(300);
  expect(key).not.toContain("Clean question");
  writeQuestionDraft(key, { index: 0, answers: { q0: { selected: ["A"], text: "Saved" } } }, questions);
  expect(readQuestionDraft(key, huge).answers.q0?.text).toBe("Saved");
  // Simulate two different schemas sharing an index: the full value identity is authoritative.
  const collision = questions.map(q => ({ ...q, question: "Other schema" }));
  expect(readQuestionDraft(key, collision)).toEqual({ index: 0, answers: {} });
  const stored = JSON.parse(localStorage.getItem(key)!);
  expect(stored.schema).toBe(questionSchemaIdentity(questions));
  expect(stored.schema).not.toContain("preview");
});
it("request thread/turn/item scopes, question text and modes isolate reload drafts", () => {
  const questions = projected();
  const base = { ...request(), params: { ...request().params as object, threadId: "t", turnId: "u", itemId: "i" } };
  const key = questionDraftKey(scope, base, questions)!;
  writeQuestionDraft(key, { index: 0, answers: { q0: { selected: ["A"], text: "" } } }, questions);
  for (const field of ["threadId", "turnId", "itemId"]) {
    const changed = { ...base, params: { ...base.params, [field]: "changed" } };
    expect(readQuestionDraft(questionDraftKey(scope, changed, questions), questions).answers).toEqual({});
  }
  for (const changed of [questions.map(q => ({ ...q, question: "Changed" })), questions.map(q => ({ ...q, cutexQuestionOptions: { ...rich, multiSelect: false } })), questions.map(q => ({ ...q, isOther: false }))]) {
    expect(readQuestionDraft(questionDraftKey(scope, base, changed), changed).answers).toEqual({});
  }
});
it("a corrupt restored legacy index returns to the first unanswered question and cannot send []", () => {
  const legacy = (id: string) => ({ ...q(id), cutexQuestionOptions: undefined });
  const pending = [request([legacy("q0"), legacy("q1")])];
  const model = toInteraction(pending[0]!, false);
  if (model.kind !== "questions") throw Error("not questions");
  const key = questionDraftKey(scope, pending[0]!, model.questions)!;
  writeQuestionDraft(key, { index: 1, answers: { q1: { selected: [], text: "last" } } }, model.questions);
  draw(pending, false); expect(host.textContent).toContain("1 / 2");
  type("\u001c"); expect(button("interaction.next").disabled).toBe(true); expect(reply).not.toHaveBeenCalled();
  type("first"); click("interaction.next"); expect(host.querySelector("input")!.value).toBe("last"); click("interaction.submit");
  expect(reply).toHaveBeenLastCalledWith(expect.anything(), { result: { answers: { q0: { answers: ["first"] }, q1: { answers: ["last"] } } } });
});

it("legacy final submit uses shared validation and retains an oversized draft without sending", () => {
  draw([request([{ ...q(), cutexQuestionOptions: undefined }])], false);
  type("x".repeat(65537)); click("interaction.submit"); expect(reply).not.toHaveBeenCalled();
  draw([]); draw([request([{ ...q(), cutexQuestionOptions: undefined }])], false);
  expect(host.querySelector("input")!.value.length).toBe(65537);
  type("valid"); click("interaction.submit");
  expect(reply).toHaveBeenCalledWith(expect.anything(), { result: { answers: { q0: { answers: ["valid"] } } } });
});

it.each([false, true])("valid magic question IDs render, reload and reply as own JSON keys (rich=%s)", (richMode) => {
  const questions = [q("constructor"), q("__proto__")].map(q => richMode ? q : { ...q, cutexQuestionOptions: undefined });
  const pending = [request(questions)];
  draw(pending, richMode);
  // Empty maps must treat constructor as unanswered, not as an inherited draft object.
  expect(host.querySelector("input")!.value).toBe("");
  type("first"); click("interaction.next");
  expect(host.querySelector("input")!.value).toBe("");
  type("second"); draw([]); draw(pending, richMode);
  expect(host.textContent).toContain("2 / 2"); expect(host.querySelector("input")!.value).toBe("second");
  click("interaction.submit");
  const result = reply.mock.calls.at(-1)![1].result;
  const wire = JSON.parse(JSON.stringify(result));
  for (const [id, answer] of [["constructor", "first"], ["__proto__", "second"]]) {
    expect(Object.hasOwn(result.answers, id!)).toBe(true);
    expect(Object.hasOwn(wire.answers, id!)).toBe(true);
    expect(wire.answers[id!]).toEqual({ answers: [answer] });
  }
  const model = toInteraction(pending[0]!, richMode);
  if (model.kind !== "questions") throw Error("not questions");
  const restored = readQuestionDraft(questionDraftKey(scope, pending[0]!, model.questions), model.questions);
  expect(Object.hasOwn(restored.answers, "constructor")).toBe(true);
  expect(Object.hasOwn(restored.answers, "__proto__")).toBe(true);
  expect(restored.answers["__proto__"]?.text).toBe("second");
  expect(Object.getPrototypeOf(restored.answers)).toBe(Object.prototype);
});

it.each([0, 1, 5])("extension option count %s falls back without changing the legacy base question", (count) => {
  const options = Array.from({ length: count }, (_, i) => ({ label: `Option ${i}`, description: "" }));
  const invalid = { ...rich, options };
  expect(questionOptionsV1(invalid)).toBeNull();
  draw([request([{ ...q(), options: [{ label: "Legacy", description: "Base option" }], cutexQuestionOptions: invalid }])]);
  expect(host.textContent).toContain("Legacy fallback"); expect(host.textContent).not.toContain("Clean question");
  expect(host.querySelector("details")).toBeNull(); click("Base option");
  expect(reply).toHaveBeenCalledWith(expect.anything(), { result: { answers: { q0: { answers: ["Legacy"] } } } });
});
it("extension question, label and description enforce 64 KiB UTF-8 limits", () => {
  const oversized = "字".repeat(21846);
  for (const field of ["question", "label", "description"] as const) {
    const extension = field === "question" ? { ...rich, question: oversized } : { ...rich, options: rich.options.map((o, i) => i ? o : { ...o, [field]: oversized }) };
    expect(questionOptionsV1(extension)).toBeNull();
    draw([request([{ ...q(), cutexQuestionOptions: extension }])]);
    expect(host.textContent).toContain("Legacy fallback"); expect(host.querySelector("details")).toBeNull();
  }
  const exact = "x".repeat(65536);
  expect(questionOptionsV1({ ...rich, question: exact, options: [{ label: exact, description: exact, preview: exact }, rich.options[1]] })).not.toBeNull();
  expect(questionOptionsV1({ ...rich, options: Array.from({ length: 4 }, (_, i) => ({ label: `Option ${i}`, description: "" })) })).not.toBeNull();
});
