// Composer undo / redo (owner-approved survey C1, 2026-11-25): an in-memory history per draft (host + session) over
// text, attachments and picked skills; typing bursts; IME compositions as one step; send ends it.
import { describe, expect, it } from "vitest";
import { composerDraftKey, createComposerDraftStore, UNDO_IDLE_MS } from "../src/renderer/src/lib/composerDrafts";
import { changedEnd, undoKeyOf } from "../src/renderer/src/lib/draftUndo";
import type { DraftImage } from "../src/shared/input";

const image = (id: string): DraftImage => ({ id, name: `${id}.png`, preview: "data:image/png;base64,AA==", source: { kind: "path", path: `/p/${id}.png` } });
const skill = { name: "review", path: "/skills/review/SKILL.md" };
const typing = { history: "typing" as const };

function setup() {
  let clock = 1_000_000;
  const store = createComposerDraftStore(undefined, undefined, () => clock);
  const key = composerDraftKey("local", "s1");
  const type = (text: string, composing = false) => store.update(key, "text", text, { ...typing, composing });
  return { store, key, type, tick: (ms: number) => { clock += ms; }, text: () => store.read(key).text };
}

describe("composer undo history", () => {
  it("typing coalesces into bursts; a pause or switching insert/delete starts a new step; redo walks back", () => {
    const { store, key, type, tick, text } = setup();
    type("h"); tick(100); type("he"); tick(100); type("hel"); tick(100); type("hello");
    tick(UNDO_IDLE_MS + 1); type("hello w"); tick(50); type("hello wo");
    tick(50); type("hello w"); // a deletion: its own step
    store.undo(key); expect(text()).toBe("hello wo");
    store.undo(key); expect(text()).toBe("hello");
    store.undo(key); expect(text()).toBe("");
    expect(store.undo(key)).toBeNull();
    store.redo(key); expect(text()).toBe("hello");
    store.redo(key); store.redo(key); expect(text()).toBe("hello w");
    expect(store.redo(key)).toBeNull();
  });

  it("removing an attachment, adding a skill and replacing a big paste are each undone in one step", () => {
    const { store, key, type, text } = setup();
    type("see the diagram");
    store.update(key, "images", [image("a"), image("b")]);
    store.update(key, "images", (prev) => prev.filter((x) => x.id !== "a"));
    expect(store.read(key).images.map((x) => x.id)).toEqual(["b"]);
    store.undo(key);
    expect(store.read(key).images.map((x) => x.id)).toEqual(["a", "b"]);
    store.redo(key);
    expect(store.read(key).images.map((x) => x.id)).toEqual(["b"]);

    const big = "x".repeat(200_000);
    store.markStep(key); type(big);
    store.markStep(key); type("replaced by mistake");
    type("replaced by mistake!"); // typing after a paste is a new step, not part of it
    store.undo(key); expect(text()).toBe("replaced by mistake");
    store.undo(key); expect(text()).toBe(big);
    store.undo(key); expect(text()).toBe("see the diagram");

    store.group(key, () => { store.update(key, "pickedSkills", [skill]); store.update(key, "text", "$review ", typing); });
    expect(store.read(key)).toMatchObject({ text: "$review ", pickedSkills: [skill] });
    store.undo(key);
    expect(store.read(key)).toMatchObject({ text: "see the diagram", pickedSkills: [] });
  });

  it("an IME composition is one step: nothing is recorded in its middle, its commit ends the step", () => {
    const { store, key, type, tick, text } = setup();
    type("你"); // committed earlier
    tick(UNDO_IDLE_MS + 1);
    type("你n", true); tick(5000); type("你ni", true); tick(5000); type("你nih", true); // long pauses mid-composition
    type("你你好"); // the commit (no longer composing)
    type("你你好！"); // typing right after: a new step
    store.undo(key); expect(text()).toBe("你你好");
    store.undo(key); expect(text()).toBe("你");
    store.undo(key); expect(text()).toBe("");
  });

  it("per host + session: histories never cross", () => {
    const { store } = setup();
    const a = composerDraftKey("local", "same"), b = composerDraftKey("ssh-x", "same"), c = composerDraftKey("local", "other");
    store.update(a, "text", "A", typing);
    store.update(b, "text", "B", typing);
    store.update(c, "images", [image("c")]);
    store.undo(a);
    expect([store.read(a).text, store.read(b).text, store.read(c).images.length]).toEqual(["", "B", 1]);
    expect(store.canUndo(b)).toBe(true);
    expect(store.canUndo(a)).toBe(false);
  });

  it("send ends the history (clear, or the side composer's endHistory); forgotten hosts take theirs", () => {
    const { store, key, type } = setup();
    type("sent text");
    store.clear(key);
    expect(store.undo(key)).toBeNull();
    expect(store.read(key).text).toBe("");
    type("next");
    store.endHistory(key);
    expect(store.canUndo(key)).toBe(false);
    const remote = composerDraftKey("ssh-gone", "s");
    store.update(remote, "text", "x", typing);
    store.retainHosts(["local"]);
    expect(store.canUndo(remote)).toBe(false);
    expect(store.stats().histories).toBeLessThanOrEqual(1);
  });

  it("a restored (inserted) draft is a step; a new change drops redo", () => {
    const { store, key, type, text } = setup();
    type("mine");
    store.insert(key, "edited from queue", "replace");
    store.undo(key); expect(text()).toBe("mine");
    type("mine2");
    expect(store.redo(key)).toBeNull();
  });

  it("bounded: steps per draft and bytes in all", () => {
    let clock = 0;
    const store = createComposerDraftStore(undefined, { steps: 5, bytes: 4000 }, () => (clock += 10_000));
    const a = composerDraftKey("local", "a"), b = composerDraftKey("local", "b");
    for (let i = 0; i < 20; i++) store.update(a, "text", `a${i}`, typing);
    let undos = 0;
    while (store.undo(a)) undos++;
    expect(undos).toBe(5);
    store.update(b, "text", "y".repeat(1500), { history: "step" });
    store.update(b, "text", "z".repeat(1500), { history: "step" });
    expect(store.stats().historyBytes).toBeLessThanOrEqual(4000);
    expect(store.canUndo(b)).toBe(true);
  });
});

describe("undo keys and caret", () => {
  it("Ctrl/⌘+Z undo, Ctrl/⌘+Shift+Z and Ctrl/⌘+Y redo; Alt or other keys are not undo", () => {
    const k = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
      undoKeyOf({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
    expect(k("z", { ctrlKey: true })).toBe("undo");
    expect(k("Z", { ctrlKey: true, shiftKey: true })).toBe("redo");
    expect(k("y", { ctrlKey: true })).toBe("redo");
    expect(k("z", { metaKey: true })).toBe("undo");
    expect(k("z", { ctrlKey: true, altKey: true })).toBeNull();
    expect(k("z")).toBeNull();
    expect(k("x", { ctrlKey: true })).toBeNull();
  });
  it("the caret lands at the end of what changed", () => {
    expect(changedEnd("hello world", "hello")).toBe(5);
    expect(changedEnd("hello", "hello world")).toBe(11);
    expect(changedEnd("abXYcd", "abcd")).toBe(2);
    expect(changedEnd("", "")).toBe(0);
  });
});
