// @vitest-environment jsdom
// Owner Q16 ②: an older cutex forgets the host / Profile manual URL once switched to 不使用 (it answers
// `url: null`); the form keeps the last URL so switching back to 手动 shows it again (ProxyEditor).
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { ProxyEditor } = await import("../src/renderer/src/components/settings/ProxyEditor");

it("keeps the manual URL in the form after a switch to none that clears it", async () => {
  const div = document.createElement("div");
  document.body.append(div);
  const root = createRoot(div);
  const onSave = vi.fn(async () => {});
  const modes = [{ value: "system", label: "system" }, { value: "none", label: "none" }, { value: "manual", label: "manual" }] as const;
  const render = (mode: "system" | "none" | "manual", url: string | null) =>
    act(() => root.render(h(ProxyEditor<"system" | "none" | "manual">, { label: "mode", modes, mode, manual: "manual", url, hasCredentials: false, noProxy: url ? "corp.example" : null, onSave })));
  const radio = (label: string) => [...div.querySelectorAll<HTMLButtonElement>("[role=radio]")].find((b) => b.textContent === label)!;
  render("manual", "http://10.0.0.2:3128");
  await act(async () => radio("none").click());
  expect(onSave).toHaveBeenLastCalledWith({ mode: "none" });
  render("none", null); // what cutex answers
  await act(async () => radio("manual").click());
  const inputs = [...div.querySelectorAll("input")].map((i) => i.value);
  expect(inputs).toEqual(["http://10.0.0.2:3128", "corp.example"]);
  act(() => root.unmount());
});

it("restores a remembered (redacted) URL with a bare manual save so its login survives", async () => {
  const div = document.createElement("div");
  document.body.append(div);
  const root = createRoot(div);
  const onSave = vi.fn(async () => {});
  const modes = [{ value: "none", label: "none" }, { value: "manual", label: "manual" }] as const;
  // cutex with the Q16 ② fix: mode none still returns the stored URL, credentials redacted.
  act(() => root.render(h(ProxyEditor<"none" | "manual">, { label: "mode", modes, mode: "none", manual: "manual", url: "http://10.0.0.2:3128/", hasCredentials: true, noProxy: "corp.example", onSave })));
  const radio = (label: string) => [...div.querySelectorAll<HTMLButtonElement>("[role=radio]")].find((b) => b.textContent === label)!;
  await act(async () => radio("manual").click());
  const save = [...div.querySelectorAll<HTMLButtonElement>("button")].find((b) => !b.getAttribute("role") && !b.disabled)!;
  await act(async () => save.click());
  expect(onSave).toHaveBeenLastCalledWith({ mode: "manual", noProxy: "corp.example" });
  act(() => root.unmount());
});

it("r243 5.3: a remount after 继承主机 (cutex stores nothing) still shows the last manual address and sends it", async () => {
  const { resetRememberedProxyAddresses } = await import("../src/renderer/src/components/settings/ProxyEditor");
  resetRememberedProxyAddresses();
  const modes = [{ value: "inherit", label: "inherit" }, { value: "none", label: "none" }, { value: "manual", label: "manual" }] as const;
  const onSave = vi.fn(async () => {});
  const mount = (mode: "inherit" | "none" | "manual", url: string | null, memoryKey = "profile:local:p1") => {
    const div = document.createElement("div");
    document.body.append(div);
    const root = createRoot(div);
    act(() => root.render(h(ProxyEditor<"inherit" | "none" | "manual">, { label: "mode", modes, mode, manual: "manual", url, hasCredentials: false, noProxy: null, memoryKey, onSave })));
    return { div, root };
  };
  const first = mount("manual", "http://127.0.0.1:18080/");
  act(() => first.root.unmount());
  // manual → 继承主机 → 不使用代理: cutex answers url null; the editor was remounted (overview page and back).
  const second = mount("none", null);
  const radio = (label: string) => [...second.div.querySelectorAll<HTMLButtonElement>("[role=radio]")].find((b) => b.textContent === label)!;
  await act(async () => radio("manual").click());
  expect(second.div.querySelector("input")!.value).toBe("http://127.0.0.1:18080/");
  const save = [...second.div.querySelectorAll<HTMLButtonElement>("button")].find((b) => !b.getAttribute("role"))!;
  expect(save.disabled).toBe(false);
  await act(async () => save.click());
  expect(onSave).toHaveBeenLastCalledWith({ mode: "manual", url: "http://127.0.0.1:18080/", noProxy: null });
  act(() => second.root.unmount());
  // Another setting has its own memory.
  const other = mount("none", null, "profile:local:p2");
  const otherRadio = [...other.div.querySelectorAll<HTMLButtonElement>("[role=radio]")].find((b) => b.textContent === "manual")!;
  await act(async () => otherRadio.click());
  expect(other.div.querySelector("input")!.value).toBe("");
  act(() => other.root.unmount());
});
