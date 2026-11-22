import { expect, it } from "vitest";
import { hasReferenceToken as desktop } from "../src/shared/inputPreview";
import { hasReferenceToken as phone } from "../../../packages/cutex-mobile/src/chat/timeline";

// The desktop and the phone decide the same way whether a `$skill` / `@file` word is already in the text.
const cases: [string, string, boolean][] = [
  ["比较 @计划书.md", "@计划", false],
  ["比较 @计划 和别的", "@计划", true],
  ["看@计划", "@计划", false], // glued to a word before it, as `a@plan.md`: not counted (the ref is shown, never hidden wrongly)
  ["用 $审阅者", "$审阅", false],
  ["Use $reviewer", "$review", false],
  ["Use $review now", "$review", true],
  ["Compare @plan.md.bak", "@plan.md", false],
  ["Read @plan.md.", "@plan.md", true],
  ["Read @plan.md, then go", "@plan.md", true],
  ["see @dir/sub", "@dir", false],
  ["see @dir\sub", "@dir", false],
  ["mail a@plan.md", "@plan.md", false],
  ["café @naïve", "@naïve", true],
  ["@e\u0301x", "@e", false],
  ["$a.b", "$a", false],
];
it.each(cases)("%j has %j: %s (desktop and phone alike)", (text, token, want) => {
  expect(desktop(text, token)).toBe(want);
  expect(phone(text, token)).toBe(want);
});
