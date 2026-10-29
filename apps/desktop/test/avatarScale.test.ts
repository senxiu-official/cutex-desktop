// Avatar sizes stay on the design 040 scale (16 / 20 / 28 / 32 / 40 / 72; owner 2026-10-23): every literal size
// given to an agent / owner / user avatar in the renderer. Profile badges (ProfileAvatar) and the avatar pickers'
// choice grids are not avatars in a place and are not checked.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { expect, it } from "vitest";

const ROOT = resolve(__dirname, "../src/renderer/src");
const SCALE = new Set([16, 20, 28, 32, 40, 72]);
const TAG = /<(Avatar|StatusAvatar|Who|MemberAvatar|SenderAvatar|MeAvatar|IdentityAvatar)\b[^>]*?\bsize=\{(\d+)\}/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "dev" ? [] : files(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

it("every literal avatar size is on the 040 scale", () => {
  const off: string[] = [];
  for (const file of files(ROOT)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(TAG)) if (!SCALE.has(Number(m[2]))) off.push(`${relative(ROOT, file)}: <${m[1]} size={${m[2]}}>`);
  }
  expect(off).toEqual([]);
});
