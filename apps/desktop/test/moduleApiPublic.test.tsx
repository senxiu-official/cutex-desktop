// The public additions an author asked for (docs/module-authoring.md): text on a tray button, the code block button, a toast
// on any screen, an inline fallback and the developer row's sample reply.
// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, apiFor: () => ({}), onEvent: () => () => {}, cleanIpcMessage: (message: string) => message }));

const { CodeBlockButton, TrayButton } = await import("../src/renderer/src/moduleApi/ui");
const { services } = await import("../src/renderer/src/modules/app");
const { useShelfToast, dismissShelfToast } = await import("../src/renderer/src/lib/shelves");
const { startAppModules } = await import("../src/renderer/src/modules/app");
const { useModulePref } = await import("../src/renderer/src/moduleApi/stable");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLElement;
function draw(node: ReactNode): void {
  if (!root) {
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
  }
  act(() => root!.render(node));
}
const button = (name: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
});

describe("TrayButton", () => {
  it("draws only the icon without text, and widens for text", () => {
    draw(<TrayButton label="Start"><i data-icon="" /></TrayButton>);
    expect(button("Start").hasAttribute("data-tray-text")).toBe(false);
    draw(<TrayButton label="Running" text="24:59"><i data-icon="" /></TrayButton>);
    expect(button("Running").hasAttribute("data-tray-text")).toBe(true);
    expect(container.querySelector(".tray-item-text")?.textContent).toBe("24:59");
    expect(container.querySelector("[data-icon]")).toBeTruthy();
  });
});

describe("CodeBlockButton", () => {
  it("has its label and can be disabled", () => {
    const click = vi.fn();
    draw(<CodeBlockButton label="Save" onClick={click}><i /></CodeBlockButton>);
    act(() => button("Save").click());
    expect(click).toHaveBeenCalledOnce();
    draw(<CodeBlockButton label="Save" disabled onClick={click}><i /></CodeBlockButton>);
    expect(button("Save").disabled).toBe(true);
  });
});

describe("services.ui.toast", () => {
  it("shows in the toast the whole window draws", () => {
    services.ui.toast("Time is up");
    expect(useShelfToast.getState().toast?.text).toBe("Time is up");
    dismissShelfToast();
  });
});

describe("useModulePref", () => {
  it("takes an inline array fallback of an interface without rendering forever, and saves", () => {
    startAppModules([]);
    interface Note { id: string; pinned?: boolean }
    let renders = 0;
    let write: (value: Note[]) => void = () => {};
    function Notes() {
      renders += 1;
      const [notes, set] = useModulePref<Note[]>("pref-test", "notes", []);
      write = set;
      return <span data-count="">{notes.length}</span>;
    }
    draw(<Notes />);
    expect(container.querySelector("[data-count]")?.textContent).toBe("0");
    expect(renders).toBeLessThan(4);
    act(() => write([{ id: "a" }]));
    expect(container.querySelector("[data-count]")?.textContent).toBe("1");
    act(() => (write as unknown as (update: (previous: Note[]) => Note[]) => void)((previous) => [...previous, { id: "b" }]));
    expect(container.querySelector("[data-count]")?.textContent).toBe("2");
  });
});
