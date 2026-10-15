import { describe, expect, it, vi } from "vitest";
import { composerDraftKey, createComposerDraftStore } from "../src/renderer/src/lib/composerDrafts";
import type { DraftImage } from "../src/shared/input";

const image: DraftImage = { id: "img", name: "diagram.png", preview: "data:image/png;base64,AA==", source: { kind: "path", path: "/private/diagram.png" } };
const skill = { name: "review", path: "/private/skills/review/SKILL.md" };

describe("window-local composer drafts", () => {
  it("keeps text, original image source and skill binding across unsubscribe/remount", () => {
    const store = createComposerDraftStore();
    const key = composerDraftKey("local", "session-a");
    const listener = vi.fn();
    const unsubscribe = store.subscribe(key, listener);
    store.update(key, "text", "draft $review");
    store.update(key, "images", [image]);
    store.update(key, "pickedSkills", [skill]);
    const snapshot = store.read(key);
    unsubscribe();
    store.subscribe(key, vi.fn());
    expect(store.read(key)).toBe(snapshot);
    expect(store.read(key)).toEqual({ text: "draft $review", images: [image], pickedSkills: [skill] });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("isolates identical session IDs across hosts and different sessions on one host", () => {
    const store = createComposerDraftStore();
    const local = composerDraftKey("local", "same");
    const remote = composerDraftKey("ssh-a", "same");
    const another = composerDraftKey("local", "other");
    store.update(local, "text", "local draft");
    store.update(remote, "images", [image]);
    store.update(another, "pickedSkills", [skill]);
    expect(store.read(local)).toEqual({ text: "local draft", images: [], pickedSkills: [] });
    expect(store.read(remote)).toEqual({ text: "", images: [image], pickedSkills: [] });
    expect(store.read(another)).toEqual({ text: "", images: [], pickedSkills: [skill] });
    expect(composerDraftKey(undefined, "same")).toBe(local);
    expect(composerDraftKey(null, "same")).toBe(local);
    expect(composerDraftKey("a:b", "c")).not.toBe(composerDraftKey("a", "b:c"));
  });

  it("late attachment belongs to original scope, survives ordinary typing, and never enters another host", async () => {
    const store = createComposerDraftStore();
    const oldKey = composerDraftKey("local", "same");
    const newKey = composerDraftKey("remote", "same");
    const captured = store.capture(oldKey);
    store.update(oldKey, "text", "typed while picker open");
    store.update(newKey, "text", "other host");
    await Promise.resolve();
    captured.setImages((previous) => [...previous, image]);
    expect(store.read(oldKey)).toEqual({ text: "typed while picker open", images: [image], pickedSkills: [] });
    expect(store.read(newKey)).toEqual({ text: "other host", images: [], pickedSkills: [] });
  });

  it("send clears all parts and fences old image and queue-edit continuations without deleting newer typing", () => {
    const store = createComposerDraftStore();
    const key = composerDraftKey("local", "a");
    store.update(key, "text", "sent $review");
    store.update(key, "images", [image]);
    store.update(key, "pickedSkills", [skill]);
    const outbox = store.read(key);
    const pending = store.capture(key);
    store.clear(key);
    expect(store.read(key)).toEqual({ text: "", images: [], pickedSkills: [] });
    store.update(key, "text", "next unsent draft");
    pending.setText("late old queue edit");
    pending.setImages([image]);
    pending.setPickedSkills([skill]);
    expect(store.read(key)).toEqual({ text: "next unsent draft", images: [], pickedSkills: [] });
    expect(outbox).toEqual({ text: "sent $review", images: [image], pickedSkills: [skill] });
    // A fresh acquisition after send belongs to the new draft epoch.
    store.capture(key).setImages([image]);
    expect(store.read(key).images).toEqual([image]);
  });

  it("clears only its scope and uses stable snapshots without any browser persistence", () => {
    const store = createComposerDraftStore();
    const empty = store.read("a");
    const other = vi.fn();
    store.subscribe("b", other);
    store.update("b", "text", "retained");
    other.mockClear();
    store.update("a", "text", "discard");
    store.clear("a");
    expect(store.read("a")).toBe(empty);
    expect(store.read("b").text).toBe("retained");
    expect(other).not.toHaveBeenCalled();
    expect(createComposerDraftStore().read("b").text).toBe("");
  });
  it("restores an unmounted draft atomically with all attachments and unique image IDs", () => {
    const store = createComposerDraftStore();
    const key = composerDraftKey("local", "restored");
    const extra = [{ type: "localImage", path: "/private/diagram.png" },
      { type: "image", url: "data:image/png;base64,AA==" }, { type: "skill", ...skill }];
    store.insert(key, "first", "replace", extra);
    const listener = vi.fn();
    store.subscribe(key, listener);
    store.insert(key, "second", "append", extra);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.read(key).text).toBe("first\n\nsecond");
    expect(store.read(key).images.map((x) => x.source)).toEqual([
      { kind: "path", path: "/private/diagram.png" }, { kind: "data", url: "data:image/png;base64,AA==" },
      { kind: "path", path: "/private/diagram.png" }, { kind: "data", url: "data:image/png;base64,AA==" },
    ]);
    expect(new Set(store.read(key).images.map((x) => x.id)).size).toBe(4);
    expect(store.read(key).images.every((x) => x.id.startsWith("restore-"))).toBe(true);
    expect(store.read(key).pickedSkills).toEqual([skill, skill]);
    store.insert(key, "replacement", "replace");
    expect(store.read(key).text).toBe("replacement");
    expect(store.read(key).images).toHaveLength(4);
  });

  it("is an LRU bounded by entry count, never evicting a mounted draft or the one being written", () => {
    const store = createComposerDraftStore({ entries: 3, bytes: Infinity });
    const key = (n: number) => composerDraftKey("local", `s${n}`);
    const mounted = store.subscribe(key(0), vi.fn());
    for (let n = 0; n < 6; n++) store.update(key(n), "text", `draft ${n}`);
    // s0 is mounted (kept); s1..s3 were the oldest unmounted ones.
    expect([0, 1, 2, 3, 4, 5].map((n) => store.read(key(n)).text)).toEqual(["draft 0", "", "", "", "draft 4", "draft 5"]);
    // Writing refreshes recency: s4 survives the next insert, s5 goes.
    store.update(key(4), "text", "draft 4b");
    store.update(key(6), "text", "draft 6");
    expect(store.read(key(4)).text).toBe("draft 4b");
    expect(store.read(key(5)).text).toBe("");
    expect(store.stats().entries).toBe(3);
    mounted();
  });

  it("counts image data URLs toward a byte bound", () => {
    const big = (id: string): DraftImage => ({ id, name: `${id}.png`, preview: "data:image/png;base64," + "A".repeat(1000), source: { kind: "data", url: "data:image/png;base64," + "A".repeat(1000) } });
    const store = createComposerDraftStore({ entries: 50, bytes: 10_000 });
    const a = composerDraftKey("local", "a");
    const b = composerDraftKey("local", "b");
    const c = composerDraftKey("local", "c");
    store.update(a, "images", [big("1")]);
    store.update(b, "images", [big("2")]);
    expect(store.stats().bytes).toBeGreaterThan(8000);
    store.update(c, "images", [big("3")]);
    // ~4 KB each: the oldest goes once the total passes 10 KB.
    expect(store.read(a).images).toEqual([]);
    expect(store.read(b).images).toHaveLength(1);
    expect(store.read(c).images).toHaveLength(1);
    expect(store.stats().bytes).toBeLessThanOrEqual(10_000);
    store.clear(b);
    store.clear(c);
    expect(store.stats()).toEqual({ entries: 0, bytes: 0, generations: 0 });
  });

  it("prunes drafts and pending acquisitions of removed hosts", () => {
    const store = createComposerDraftStore();
    const local = composerDraftKey("local", "x");
    const kept = composerDraftKey("ssh-kept", "x");
    const gone = composerDraftKey("ssh-gone", "x");
    for (const k of [local, kept, gone]) store.update(k, "text", k);
    const late = store.capture(gone);
    const listener = vi.fn();
    store.subscribe(gone, listener);
    store.retainHosts(["ssh-kept"]);
    expect(store.read(local).text).toBe(local);
    expect(store.read(kept).text).toBe(kept);
    expect(store.read(gone).text).toBe("");
    expect(listener).toHaveBeenCalled();
    late.setImages([image]);
    expect(store.read(gone).images).toEqual([]);
  });

  it("sending does not grow per-key bookkeeping", () => {
    const store = createComposerDraftStore();
    for (let n = 0; n < 500; n++) {
      const key = composerDraftKey("local", `s${n % 7}`);
      const pending = store.capture(key);
      store.update(key, "text", "x");
      store.clear(key);
      pending.setText("late");
      expect(store.read(key).text).toBe("");
    }
    expect(store.stats()).toEqual({ entries: 0, bytes: 0, generations: 0 });
  });
});
