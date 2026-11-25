// Composer undo, review fixes (roster-bottom-review on aeeb8af79, 2026-11-25): a skill pick keeps its `$name` (so it
// is bound at send), an IME commit that changes nothing still ends its step, and the history bounds hold after
// undo / redo and for drafts that end up empty.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripTypeScriptTypes } from "node:module";
import { describe, expect, it } from "vitest";
import { composerDraftKey, createComposerDraftStore, DRAFT_LIMITS, UNDO_IDLE_MS } from "../src/renderer/src/lib/composerDrafts";
import { appendToken } from "../src/renderer/src/lib/composerTools";
import { boundSkills, skillToken } from "../src/renderer/src/lib/slashCommands";

const typing = { history: "typing" as const };
const skill = { name: "review", path: "/skills/review/SKILL.md", description: "", enabled: true };

/** Composer's own `pickSkill` (its source, run against a real draft store), as the palette / "+" menu call it. */
function composerPickSkill(store: ReturnType<typeof createComposerDraftStore>, key: string) {
  const source = readFileSync(join(__dirname, "../src/renderer/src/components/Composer.tsx"), "utf8");
  const start = source.indexOf("  const pickSkill ="), end = source.indexOf("  const pickPalette", start);
  expect(start).toBeGreaterThan(0);
  const env = {
    skillToken, appendToken, focusEnd: () => {},
    groupDraft: (fn: () => void) => store.group(key, fn),
    setPickedSkills: (v: never) => store.update(key, "pickedSkills", v),
    setText: (v: never) => store.update(key, "text", v, { history: "step" }),
  };
  const body = stripTypeScriptTypes(source.slice(start, end), { mode: "transform" }) + "\nreturn pickSkill;";
  return new Function(...Object.keys(env), body)(...Object.values(env)) as (s: typeof skill, mode: "replace" | "append") => void;
}

describe("skill pick → send", () => {
  it("the picked skill's `$name` is in the draft, so the send binds it (palette replace and + append)", () => {
    const store = createComposerDraftStore();
    const key = composerDraftKey("local", "s");
    const pick = composerPickSkill(store, key);
    pick(skill, "replace");
    expect(store.read(key).text).toBe("$review ");
    expect(boundSkills(store.read(key).text, store.read(key).pickedSkills)).toEqual([{ name: skill.name, path: skill.path }]);
    store.clear(key);
    store.update(key, "text", "please", typing);
    pick(skill, "append");
    expect(store.read(key).text).toBe("please $review ");
    expect(boundSkills(store.read(key).text, store.read(key).pickedSkills).map((s) => s.name)).toEqual(["review"]);
    // One undo takes the skill and its `$name` away together.
    store.undo(key);
    expect(store.read(key)).toMatchObject({ text: "please", pickedSkills: [] });
  });
  it("the token is `$name `", () => expect(skillToken("x")).toBe("$x "));
});

describe("IME composition end", () => {
  it("a commit with the same value still ends the step (compose 你, commit 你, type ！, undo → 你)", () => {
    let clock = 0;
    const store = createComposerDraftStore(undefined, undefined, () => clock);
    const key = composerDraftKey("local", "s");
    store.update(key, "text", "你", { ...typing, composing: true });
    store.update(key, "text", "你", typing); // the commit: same value, no change
    store.endComposition(key); // compositionend
    clock += 10;
    store.update(key, "text", "你！", typing);
    store.undo(key);
    expect(store.read(key).text).toBe("你");
    store.undo(key);
    expect(store.read(key).text).toBe("");
  });
  it("Chromium's order (the committing input still composing, then compositionend): typing after it is a new step", () => {
    let clock = 0;
    const store = createComposerDraftStore(undefined, undefined, () => clock);
    const key = composerDraftKey("local", "s");
    store.update(key, "text", "n", { ...typing, composing: true });
    store.update(key, "text", "ni", { ...typing, composing: true });
    store.update(key, "text", "你", { ...typing, composing: true });
    store.endComposition(key);
    clock += 10;
    store.update(key, "text", "你好", typing);
    store.undo(key);
    expect(store.read(key).text).toBe("你");
  });
});

describe("history bounds", () => {
  it("undo / redo re-trims: moving a big current draft into redo never goes over the byte budget", () => {
    let clock = 0;
    const store = createComposerDraftStore(undefined, { steps: 100, bytes: 100 }, () => (clock += UNDO_IDLE_MS + 1));
    const key = composerDraftKey("local", "s");
    store.update(key, "text", "a".repeat(30), { history: "step" }); // 60 bytes
    store.update(key, "text", "b".repeat(40), { history: "step" }); // 80 bytes
    expect(store.stats().historyBytes).toBeLessThanOrEqual(100);
    store.undo(key);
    expect(store.stats().historyBytes).toBeLessThanOrEqual(100);
    store.undo(key);
    expect(store.stats().historyBytes).toBeLessThanOrEqual(100);
    expect(store.read(key).text).toBe("");
    expect(store.canRedo(key)).toBe(true); // the nearest redo stays; the farthest went
    store.redo(key);
    expect(store.read(key).text).toBe("a".repeat(30));
    for (let i = 0; i < 5; i++) { store.undo(key); store.redo(key); expect(store.stats().historyBytes).toBeLessThanOrEqual(100); }
  });

  it("drafts that end up empty do not pile up histories; the shown one keeps its own", () => {
    const store = createComposerDraftStore();
    const shown = composerDraftKey("local", "shown");
    const stop = store.subscribe(shown, () => {});
    store.update(shown, "text", "x", typing);
    store.update(shown, "text", "", { history: "step" }); // everything deleted: undo must still bring it back
    for (let i = 0; i < 1000; i++) {
      const key = composerDraftKey("local", `s${i}`);
      store.update(key, "text", "typed", typing);
      store.update(key, "text", "", { history: "step" });
    }
    expect(store.stats().entries).toBe(0);
    expect(store.stats().histories).toBeLessThanOrEqual(DRAFT_LIMITS.entries);
    store.undo(shown);
    expect(store.read(shown).text).toBe("x");
    stop();
  });
});

describe("the side composer's send boundary in the shared draft history", () => {
  it("the side composer sends only the text and ends the history; the main composer's attachments stay, nothing to undo", () => {
    const store = createComposerDraftStore();
    const key = composerDraftKey("local", "s");
    const image = { id: "i", name: "i.png", preview: "", source: { kind: "path" as const, path: "/i.png" } };
    store.update(key, "images", [image]); // main composer
    store.update(key, "text", "from the side page", typing); // side composer typing (same draft)
    store.undo(key);
    expect(store.read(key)).toMatchObject({ text: "", images: [image] });
    store.redo(key);
    // SideAgent's send: the text goes, the history ends.
    store.update(key, "text", "", { history: "none" });
    store.endHistory(key);
    expect(store.read(key)).toMatchObject({ text: "", images: [image] });
    expect(store.undo(key)).toBeNull();
    // Typing afterwards starts a fresh history.
    store.update(key, "text", "next", typing);
    store.undo(key);
    expect(store.read(key)).toMatchObject({ text: "", images: [image] });
  });

  it("the side composer is wired to the draft history (keys, edit menu, composition end, send)", () => {
    const side = readFileSync(join(__dirname, "../src/renderer/src/modules/conversation/SideAgent.tsx"), "utf8");
    expect(side).toMatch(/useHistoryBeforeInput\(input, travel\)/);
    expect(side).toMatch(/undoKeyOf\(e\)/);
    expect(side).toMatch(/onCompositionEnd=\{endDraftComposition\}/);
    expect(side).toMatch(/setText\("", \{ history: "none" \}\);\s*endDraftHistory\(\);/);
  });
});
