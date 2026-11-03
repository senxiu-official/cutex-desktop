// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, vars?: { time?: string }) => `${key}${vars?.time ?? ""}` }) }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {} }));
import { TerminalsBody } from "../src/renderer/src/modules/background-terminals/TerminalsStatus";

it("shows a Claude shell's command, running state, known start time and output limitation in the Shelf", () => {
  const data = { threadId: "thread", terminals: [{ itemId: "item", processId: "shell", command: "bash final-a.sh", cwd: "/work", osPid: null, cpuPercent: null, rssKb: null }], refresh() {}, claude: true, startedAt: { shell: 1793674623117 } };
  const html = renderToStaticMarkup(createElement(TerminalsBody, { sessionId: "claude", data }));
  expect(html).toContain("bash final-a.sh");
  expect(html).toContain("background-terminals.running");
  expect(html).toContain("background-terminals.started");
  expect(html).toContain("background-terminals.agentOutputOnly");
  const unknown = renderToStaticMarkup(createElement(TerminalsBody, { sessionId: "claude", data: { ...data, startedAt: {} } }));
  expect(unknown).toContain("background-terminals.startedUnknown");
});
