// A translated sentence with nodes in its {{slots}} (owner 2026-11-25: a name in running text carries its icon,
// components/EntityIcon EntityMention). The catalog stays plain strings: each node slot gets a marker before
// formatting, and the formatted text is split back around the markers.
import { createElement, Fragment, type ReactNode } from "react";
import type { MessageKey } from "../i18n";

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;
// A private-use character: formatters keep it as is (JSON.stringify would escape a control character).
const MARK = "";
const SLOT = new RegExp(`${MARK}([^${MARK}]+)${MARK}`, "g");

/** `t(key, vars)` with React nodes allowed among `vars` (strings and numbers format as usual). */
export function tNodes(t: Translate, key: MessageKey, vars: Record<string, ReactNode>): ReactNode {
  const plain: Record<string, string | number> = {};
  const nodes = new Map<string, ReactNode>();
  for (const [name, value] of Object.entries(vars)) {
    if (typeof value === "string" || typeof value === "number") plain[name] = value;
    else { plain[name] = `${MARK}${name}${MARK}`; nodes.set(name, value); }
  }
  const text = t(key, plain);
  if (!nodes.size) return text;
  const parts = text.split(SLOT);
  // split with a capture group: even = text, odd = slot names.
  return createElement(Fragment, null, ...parts.map((part, i) => (i % 2 ? createElement(Fragment, { key: i }, nodes.get(part) ?? part) : part ? part : null)));
}

