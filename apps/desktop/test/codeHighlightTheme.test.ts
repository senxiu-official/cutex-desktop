import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCodePlugin, type HighlightOptions, type HighlightResult } from "@streamdown/code";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "../src/renderer/src/modules/terminal/xtermTheme";

const samples: Record<string, { language: HighlightOptions["language"]; code: string }> = {
  powershell: { language: "powershell", code: 'ssh -o BatchMode=yes -o ForwardAgent=no -L 127.0.0.1:53122:127.0.0.1:24270 -- "D:/Work/report.md"' },
  bash: { language: "bash", code: "printf '%s\\n' 'deploy' && ssh -o BatchMode=yes -- workstation 'cutex management client-token issue'" },
  json: { language: "json", code: '{"host":"hachimi-lan","enabled":true,"count":3,"path":"D:/Work/report.md"}' },
};

const highlighter = createCodePlugin({ themes: ["github-light", "github-dark"] });

function highlight(language: HighlightOptions["language"], code: string): Promise<HighlightResult> {
  return new Promise((resolve, reject) => {
    try {
      const immediate = highlighter.highlight({ code, language, themes: ["github-light", "github-dark"] }, resolve);
      if (immediate) resolve(immediate);
    } catch (error) {
      reject(error);
    }
  });
}

describe("Markdown code highlighting", () => {
  it("uses the app data-theme as well as the system dark-scheme fallback", () => {
    const css = readFileSync(resolve("src/renderer/src/styles.css"), "utf8");
    const selector = '.markdown [data-streamdown="code-block-body"] pre span';
    expect(css).toContain(`:root[data-theme="dark"] ${selector}`);
    expect(css).toContain(`:root:not([data-theme="light"]) ${selector}`);
    expect(css).toContain("color: var(--shiki-dark, var(--sdm-c, inherit))");
  });

  it("keeps every dark Shiki token above WCAG AA on the lightest dark code palette", async () => {
    for (const [name, sample] of Object.entries(samples)) {
      const result = await highlight(sample.language, sample.code);
      const fallback = /--shiki-dark:(#[0-9a-f]{6})/i.exec(result.fg ?? "")?.[1];
      expect(fallback, `${name} dark foreground`).toBeTruthy();
      for (const token of result.tokens.flat().filter((token) => token.content.trim())) {
        const color = token.htmlStyle?.["--shiki-dark"] ?? fallback;
        if (!color) throw new Error(`${name}: missing dark token colour`);
        expect(contrastRatio(color, "#262624"), `${name}: ${JSON.stringify(token.content)} ${color}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
