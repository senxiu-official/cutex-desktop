import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { defaultRehypePlugins, Streamdown } from "streamdown";
import { createHastCachePlugin, WeightedLru } from "../src/renderer/src/lib/markdownCache";

describe("WeightedLru", () => {
  it("evicts the least recently used entry past the entry cap", () => {
    const lru = new WeightedLru<string, number>(2, 100);
    lru.set("a", 1, 1);
    lru.set("b", 2, 1);
    expect(lru.get("a")).toBe(1); // a is now the newest
    lru.set("c", 3, 1);
    expect(lru.has("b")).toBe(false);
    expect(lru.get("a")).toBe(1);
    expect(lru.get("c")).toBe(3);
    expect(lru.size).toBe(2);
  });

  it("evicts oldest entries until the total weight fits", () => {
    const lru = new WeightedLru<string, string>(10, 10);
    lru.set("a", "a", 4);
    lru.set("b", "b", 4);
    lru.set("c", "c", 4);
    expect(lru.has("a")).toBe(false);
    expect(lru.weight).toBe(8);
    lru.set("b", "b2", 1); // replacing re-weighs
    expect(lru.weight).toBe(5);
    expect(lru.get("b")).toBe("b2");
  });

  it("never keeps an entry above the per-entry cap and drops the old value for that key", () => {
    const lru = new WeightedLru<string, string>(10, 100, 20);
    lru.set("x", "small", 5);
    lru.set("y", "kept", 5);
    lru.set("x", "huge", 21);
    expect(lru.has("x")).toBe(false);
    expect(lru.get("y")).toBe("kept");
    expect(lru.weight).toBe(5);
  });
});

interface Root {
  type: string;
  children?: unknown[];
  source?: string;
}

/** Mimics how streamdown runs a frozen unified processor: `parse(text)` then `runSync(tree, text)`. */
function processor(cache: WeightedLru<string, Root>) {
  let parses = 0;
  const proc: { parser?: (doc: string, file: never) => Root } = {
    parser: (doc) => {
      parses++;
      return { type: "root", children: [{ type: "text" }], source: doc };
    },
  };
  const transform = createHastCachePlugin(cache).call(proc);
  const run = (text: string): Root => {
    const parsed = proc.parser!(text, { value: text } as never);
    // Upstream transforms (remark-rehype etc.) produce a new tree from the parsed one.
    const hast: Root = { type: "root", children: [...(parsed.children ?? [])], source: parsed.source };
    return transform(hast, { value: text }) ?? hast;
  };
  return { run, parses: () => parses };
}

describe("createHastCachePlugin", () => {
  it("parses a text once and serves the same tree on the next run", () => {
    const cache = new WeightedLru<string, Root>(10, 1000);
    const p = processor(cache);
    const first = p.run("# hi");
    expect(p.parses()).toBe(1);
    expect(cache.has("# hi")).toBe(true);
    const again = p.run("# hi");
    expect(p.parses()).toBe(1);
    expect(again).toBe(first);
  });

  it("keys by exact text", () => {
    const cache = new WeightedLru<string, Root>(10, 1000);
    const p = processor(cache);
    const a = p.run("text a");
    const b = p.run("text b");
    expect(p.parses()).toBe(2);
    expect(a.source).toBe("text a");
    expect(b.source).toBe("text b");
    expect(p.run("text a")).toBe(a);
    expect(p.run("text b")).toBe(b);
  });

  it("weighs entries by text length", () => {
    const cache = new WeightedLru<string, Root>(10, 10);
    const p = processor(cache);
    p.run("12345678");
    p.run("abcdef");
    expect(cache.has("12345678")).toBe(false);
    expect(cache.weight).toBe(6);
    p.run("12345678");
    expect(p.parses()).toBe(3);
  });

  it("is a no-op when the processor has no parser", () => {
    const cache = new WeightedLru<string, Root>(10, 1000);
    const transform = createHastCachePlugin(cache).call({});
    expect(transform({ type: "root" }, { value: "x" })).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("has a stable function name (streamdown keys its processor cache by plugin names)", () => {
    expect(createHastCachePlugin().name).toBe("cutexHastCache");
  });
});

describe("hast cache inside streamdown (static mode)", () => {
  const MD = "# Title\n\nSome **bold** and [a link](https://example.com) and `code`.\n\n- one\n- two\n\n```ts\nconst x = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
  const base = Object.values(defaultRehypePlugins);
  const render = (rehypePlugins: unknown[], text = MD) =>
    renderToStaticMarkup(createElement(Streamdown, { mode: "static", plugins: { cjk, code }, rehypePlugins: rehypePlugins as never, children: text }));

  it("renders the same markup from a cached tree as from a fresh parse", () => {
    const cache = new WeightedLru<string, Root>(10, 100_000);
    let hits = 0;
    const get = cache.get.bind(cache);
    cache.get = (key) => {
      const hit = get(key);
      if (hit) hits++;
      return hit;
    };
    const cached = [...base, createHastCachePlugin(cache)];
    const fresh = render(base);
    expect(render(cached)).toBe(fresh);
    expect(cache.has(MD)).toBe(true);
    expect(hits).toBe(0);
    expect(render(cached)).toBe(fresh); // served from the cache
    expect(hits).toBe(1);
    const other = "plain *other* text";
    expect(render(cached, other)).toBe(render(base, other));
    expect(cache.size).toBe(2);
  });
});
