#!/usr/bin/env node
// Writes the generated sections of docs/module-authoring.md from this package's source and the app's SLOT_SPECS, so the
// reference cannot disagree with the code. Each section sits between `<!-- generated:NAME -->` and `<!-- /generated:NAME -->`.
// test/docs.test.ts fails when the file is out of date.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ROOT = new URL("../", import.meta.url);
const DOC = new URL("../../docs/module-authoring.md", ROOT);
const SPECS = new URL("../../apps/desktop/src/renderer/src/modules/slots.ts", ROOT);
const read = (url) => readFileSync(url, "utf8").replaceAll("\r\n", "\n");
const source = (name) => read(new URL(`src/${name}.ts`, ROOT));

/** Top-level declarations of a source file, each with the comment above it. */
function statements(text) {
  const out = [];
  let current = [];
  let open = false;
  for (const line of text.split("\n")) {
    if (!open) {
      if (line.startsWith("/**") || line.startsWith("// eslint")) {
        if (!line.startsWith("// eslint")) current.push(line);
        if (line.startsWith("/**") && !line.includes("*/")) open = "comment";
        continue;
      }
      if (/^(?:export )?(?:declare )?(?:interface|type|function|const) /.test(line)) {
        current.push(line);
        const done = /^(?:export )?interface .*\{\}$/.test(line) || (!/^(?:export )?interface /.test(line) && /;$/.test(line));
        if (done) {
          out.push(current.join("\n"));
          current = [];
        } else {
          open = "body";
        }
        continue;
      }
      current = [];
      continue;
    }
    current.push(line);
    if (open === "comment" && line.includes("*/")) open = false;
    else if (open === "body" && (line === "}" || line === "};" || /^ {2}\| .*;$/.test(line))) {
      out.push(current.join("\n"));
      current = [];
      open = false;
    }
  }
  return out;
}

const code = (text) => `\`\`\`ts\n${text.replaceAll(/^export (?:declare )?/gm, "")}\n\`\`\``;

function slotDefaults() {
  const out = new Map();
  const block = /SLOT_SPECS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(read(SPECS));
  if (!block) throw new Error("no SLOT_SPECS in the app's slots.ts");
  for (const m of block[1].matchAll(/"([a-zA-Z.]+)":\s*\{ unavailable: "(\w+)"/g)) out.set(m[1], m[2]);
  return out;
}

function slotsSection() {
  const defaults = slotDefaults();
  const slots = [];
  const types = [];
  for (const statement of statements(source("slots"))) {
    const m = /\/\*\* @slot (\S+) (.*?) \*\//.exec(statement);
    if (!m) {
      if (!/\b(?:SlotMap|SlotId)\b/.test(statement.split("\n").find((l) => !l.startsWith("/**")) ?? "")) types.push(statement);
      continue;
    }
    const fallback = defaults.get(m[1]);
    if (!fallback) throw new Error(`${m[1]} is not in the app's SLOT_SPECS`);
    const body = statement.split("\n").filter((line) => !line.startsWith("/** @slot")).join("\n");
    slots.push(`### \`${m[1]}\`\n\n${m[2]} While its requirements are not met it is \`${fallback}\` unless the item says otherwise.\n\n${code(body)}`);
  }
  return `${slots.join("\n\n")}\n\n### Types the slots use\n\n${code(types.join("\n\n"))}`;
}

const SECTIONS = {
  slots: slotsSection,
  services: () => code(statements(source("services")).join("\n\n")),
  stable: () => code(statements(source("index")).join("\n\n")),
  ui: () => code(statements(source("ui")).join("\n\n")),
  experimental: () => code(statements(source("experimental")).join("\n\n")),
  base: () => code(statements(source("types")).join("\n\n")),
};

export function renderDoc(text = read(DOC)) {
  let out = text;
  for (const [name, make] of Object.entries(SECTIONS)) {
    const open = `<!-- generated:${name} -->`;
    const close = `<!-- /generated:${name} -->`;
    const start = out.indexOf(open);
    const end = out.indexOf(close);
    if (start < 0 || end < start) throw new Error(`docs/module-authoring.md has no ${open} section`);
    out = `${out.slice(0, start + open.length)}\n\n${make()}\n\n${out.slice(end)}`;
  }
  return out;
}
export const currentDoc = () => read(DOC);

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) writeFileSync(DOC, renderDoc());
