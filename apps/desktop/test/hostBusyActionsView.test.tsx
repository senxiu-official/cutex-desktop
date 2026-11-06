// @vitest-environment jsdom
// 后台操作 in the tray (owner 2026-11-05): the button shows only while something runs or a failure is unread (spinner and
// 「1/2」, red dot); its panel lists per-agent results, keeps them after closing and reopening, retries a failed agent
// (one call, never an uncertain one), and says only operations started from this desktop are listed.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../src/renderer/src/store", () => ({ useApp: (pick: (s: unknown) => unknown) => pick({ hosts: { hosts: [{ id: "remote", label: "Remote" }] } }) }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
import { BackgroundOperations } from "../src/renderer/src/components/BackgroundOperations";
import { OwnerDocumentContext } from "../src/renderer/src/lib/ownerContext";
import { beginOperation, updateOperationItem, useBackgroundOperations } from "../src/renderer/src/lib/backgroundOperations";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => useBackgroundOperations.setState({ operations: [] }));

const buttons = (root: ParentNode) => [...root.querySelectorAll<HTMLButtonElement>("[data-operations-list] button")];

it("opens running/results from the tray, keeps progress after reopening, and never retries uncertain calls", async () => {
  const div = document.createElement("div");
  document.body.append(div);
  const root = createRoot(div), retry = vi.fn();
  try {
    act(() => root.render(h(BackgroundOperations)));
    expect(div.querySelector("[data-tray-operations]")).toBeNull();
    let id = "";
    act(() => {
      id = beginOperation("remote", "operations.kind.restore", [{ key: "a", name: "Alpha" }, { key: "b", name: "Beta" }]);
      updateOperationItem({ operationId: id, key: "a" }, { state: "done" });
    });
    expect(div.querySelector("[data-operations-progress]")?.textContent).toBe("1/2");
    const tray = () => div.querySelector<HTMLButtonElement>("[data-tray-operations]")!;
    act(() => tray().click());
    const list = () => document.querySelector("[data-operations-list]");
    expect(list()?.textContent).toContain("Alpha");
    expect(list()?.textContent).toContain("operations.scopeNote");
    act(() => tray().click());
    expect(list()).toBeNull();
    act(() => updateOperationItem({ operationId: id, key: "b" }, { state: "failed", detail: "host busy", retry }));
    // Finished with an unread failure: the button stays, with the red dot.
    expect(div.querySelector("[data-operation-failure]")).not.toBeNull();
    act(() => tray().click());
    expect(list()?.textContent).toContain("host busy");
    expect(list()?.textContent).toContain("operations.failedCount");
    await act(async () => buttons(document).find((b) => b.textContent === "operations.retry")!.click());
    expect(retry).toHaveBeenCalledOnce();
    act(() => updateOperationItem({ operationId: id, key: "b" }, { state: "uncertain", retry: undefined, detail: "outcome unknown" }));
    expect(document.querySelector("[data-operation-item=uncertain]")?.textContent).toContain("operations.state.uncertain");
    expect(buttons(document).some((b) => b.textContent === "operations.retry")).toBe(false);
    // Seen while open: closing hides the button (nothing runs, nothing unread).
    act(() => tray().click());
    expect(div.querySelector("[data-tray-operations]")).toBeNull();
  } finally {
    act(() => root.unmount());
    div.remove();
  }
});

it("an operation that went fine folds to its title line; 清除已结束的 drops it", () => {
  const div = document.createElement("div");
  document.body.append(div);
  const root = createRoot(div);
  try {
    let id = "";
    act(() => {
      id = beginOperation("remote", "operations.kind.start", [{ key: "a", name: "Alpha" }, { key: "b", name: "Beta" }]);
      root.render(h(BackgroundOperations));
    });
    act(() => div.querySelector<HTMLButtonElement>("[data-tray-operations]")!.click());
    expect(document.querySelectorAll("[data-operation-item]")).toHaveLength(2);
    act(() => {
      updateOperationItem({ operationId: id, key: "a" }, { state: "done" });
      updateOperationItem({ operationId: id, key: "b" }, { state: "done" });
    });
    expect(document.querySelector("[data-operations-list]")?.textContent).toContain("operations.allDone");
    expect(document.querySelectorAll("[data-operation-item]")).toHaveLength(0);
    act(() => buttons(document).find((b) => b.textContent === "operations.clear")!.click());
    expect(useBackgroundOperations.getState().operations).toEqual([]);
    expect(document.querySelector("[data-operations-list]")?.textContent).toContain("operations.empty");
  } finally {
    act(() => root.unmount());
    div.remove();
  }
});

it("retries every failed agent of an operation at once", () => {
  const div = document.createElement("div");
  document.body.append(div);
  const root = createRoot(div), retry = vi.fn();
  try {
    act(() => {
      const id = beginOperation("remote", "operations.kind.stop", [{ key: "a", name: "Alpha" }, { key: "b", name: "Beta" }]);
      for (const key of ["a", "b"]) updateOperationItem({ operationId: id, key }, { state: "failed", detail: "x", retry });
      root.render(h(BackgroundOperations));
    });
    act(() => div.querySelector<HTMLButtonElement>("[data-tray-operations]")!.click());
    act(() => buttons(document).find((b) => b.textContent?.includes("operations.retryFailed"))!.click());
    return Promise.resolve().then(() => expect(retry).toHaveBeenCalledTimes(2));
  } finally {
    act(() => root.unmount());
    div.remove();
  }
});

it("portals the list into a desk document and handles Escape there", () => {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const doc = iframe.contentDocument!, div = doc.createElement("div");
  doc.body.append(div);
  const root = createRoot(div);
  try {
    act(() => {
      beginOperation("remote", "operations.kind.restore", [{ key: "a", name: "Alpha" }]);
      root.render(h(OwnerDocumentContext.Provider, { value: doc }, h(BackgroundOperations)));
    });
    act(() => div.querySelector<HTMLButtonElement>("[data-tray-operations]")!.click());
    expect(doc.querySelector("[data-operations-list]")).not.toBeNull();
    expect(document.querySelector("[data-operations-list]")).toBeNull();
    act(() => doc.dispatchEvent(new (iframe.contentWindow as Window & typeof globalThis).KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(doc.querySelector("[data-operations-list]")).toBeNull();
  } finally {
    act(() => root.unmount());
    iframe.remove();
  }
});
