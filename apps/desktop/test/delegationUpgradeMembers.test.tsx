// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { UpgradeMembers } from "../src/renderer/src/modules/delegations/UpgradeMembers";
import { zhCN } from "../src/renderer/src/modules/delegations/upgradeMemberMessages";
import { en } from "../src/renderer/src/modules/delegations/upgradeMemberMessages.en";
import type { PermanentRetirementReview, UpgradeMember, UpgradeSectionProps, UpgradePanelSnapshot as UpgradeSnapshot } from "../src/renderer/src/modules/delegations/upgradeTypes";

vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({
  t: (key: keyof typeof zhCN, params: Record<string, string | number> = {}) => zhCN[key].replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? "")),
}) }));

const member = (overrides: Partial<UpgradeMember> = {}): UpgradeMember => ({
  id: "wren", hostId: "eva", name: "Wren", director: false,
  activityStatus: "idle", observedAt: "2026-10-26T02:00:00Z", lastActivityAt: "2026-10-26T00:00:00Z",
  archiveKind: "active", restorable: overrides.archiveKind === "soft",
  allowedActions: overrides.archiveKind === "soft" ? ["restore", "permanentRetire"]
    : overrides.archiveKind === "permanent" || overrides.archiveKind === "unknown" ? [] : ["archive", "permanentRetire", "start", "send"],
  restoreBlockers: [], ...overrides,
});
const snapshot = (members: UpgradeMember[]): UpgradeSnapshot => ({
  projectId: "project", revision: "1", nodes: [], nextCursor: null, coverage: "complete", unresolvedEdges: [],
  parties: [], approvals: [],
    policy: { revision: 1, memberMode: "open", allowedActions: { update: true } },
  runControl: { epoch: 1, phase: "running", pauseId: null, mode: "afterTurn", scope: "members", allowedActions: { pause: true, pauseAll: true, resume: false } },
  members, grants: { items: [], allowedActions: { create: true } }, interruptedDelegations: [],
  caller: { isOwner: true, canManageMembers: true, canOfflineMembers: true },
});
const review = (id = "wren", overrides: Partial<PermanentRetirementReview> = {}): PermanentRetirementReview => ({
  confirmation_token: `token-${id}`, cutex_session_id: id, formal_name: id === "wren" ? "Wren" : "Astra",
  revision: 42, runtime_generation: 7, expires_at_unix: Math.floor(Date.now() / 1000) + 300, ...overrides,
});
const reviewRetirement = vi.fn<NonNullable<UpgradeSectionProps["reviewRetirement"]>>();
let root: Root;
let host: HTMLDivElement;
const mount = (members: UpgradeMember[], onAction = vi.fn().mockResolvedValue(undefined), overrides: Partial<UpgradeSectionProps> = {}) => {
  act(() => root.render(<UpgradeMembers snapshot={snapshot(members)} busy={false} onAction={onAction}
    archiveSupported activitySupported reviewRetirement={reviewRetirement} {...overrides} />));
  return { onAction };
};
const buttons = (name: string, scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>("button")].filter(button => button.textContent === name);
const button = (name: string) => {
  const found = buttons(name)[0];
  if (!found) throw new Error(`Button not found: ${name}`);
  return found;
};
const input = (label: string) => {
  const found = [...document.querySelectorAll<HTMLInputElement>("input")].find(element => element.closest("label")?.textContent === label);
  if (!found) throw new Error(`Input not found: ${label}`);
  return found;
};
const click = (element: HTMLElement) => act(() => element.click());
const flush = async () => { await act(async () => {}); };
const open = () => click(button("归档…"));
const paste = (input: HTMLElement, name: string) => {
  // jsdom has no clipboard default action; emulate the browser input event after an uncancelled paste.
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: () => name } });
  expect(input.dispatchEvent(event)).toBe(true);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, name);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
beforeEach(() => {
  reviewRetirement.mockReset().mockImplementation(async request => review(request.cutex_session_id));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.open = true; }) });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.open = false; }) });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("delegation upgrade members", () => {
  it("keeps English keys complete", () => { expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort()); });

  it.each(["busy", "unknown", "offline"] as const)("never marks %s as clearly idle despite old activity", activityStatus => {
    mount([member({ activityStatus })]);
    const badge = document.querySelector("[data-idle]")!;
    expect(badge.getAttribute("data-idle")).toBe("false");
    expect(badge.classList.contains("bg-surface-2")).toBe(false);
    expect(buttons("下线")).toHaveLength(0);
  });

  it.each([
    ["2026-10-26T00:00:00Z", true],
    ["2026-10-25T23:59:59Z", true],
    ["2026-10-26T00:00:01Z", false],
    [null, false], ["invalid", false], ["2026-10-26T03:00:00Z", false],
  ])("uses the observed timestamp for the inclusive two-hour boundary: %s", (lastActivityAt, idle) => {
    mount([member({ lastActivityAt })]);
    expect(document.querySelector("[data-idle]")!.getAttribute("data-idle")).toBe(String(idle));
    expect(buttons("下线").length > 0).toBe(idle);
  });

  it("requires offline permission even for clearly idle members", () => {
    const value = member();
    mount([value], undefined, { snapshot: { ...snapshot([value]), caller: { isOwner: true, canManageMembers: true, canOfflineMembers: false } } });
    expect(document.querySelector("[data-idle]")!.getAttribute("data-idle")).toBe("false");
    expect(buttons("下线")).toHaveLength(0);
  });

  it("takes an eligible idle member offline", async () => {
    const { onAction } = mount([member()]);
    click(button("下线")); await flush();
    expect(onAction).toHaveBeenCalledWith({ kind: "offline", memberId: "wren" });
  });

  it("does not infer idle from an invalid observation time", () => {
    mount([member({ observedAt: "invalid" })]);
    expect(document.querySelector("[data-idle]")!.getAttribute("data-idle")).toBe("false");
    expect(buttons("下线")).toHaveLength(0);
  });

  it("groups archives and restores only unblocked soft archives with permission", async () => {
    const { onAction } = mount([
      member({ id: "soft", archiveKind: "soft" }),
      member({ id: "permanent", archiveKind: "permanent", restorable: true, allowedActions: ["restore"] }),
      member({ id: "unknown", archiveKind: "unknown", restorable: true, allowedActions: ["restore"] }),
      member({ id: "blocked", archiveKind: "soft", restoreBlockers: ["preview_runtime_unavailable", "unrecognized_backend_code"] }),
      member({ id: "denied", archiveKind: "soft", allowedActions: [] }),
      member({ id: "not-restorable", archiveKind: "soft", restorable: false }),
    ]);
    expect(buttons("恢复", document.querySelector('section[aria-label="永久退休 · 不能恢复"]')!)).toHaveLength(0);
    expect(buttons("恢复", document.querySelector('section[aria-label="归档类型未知 · 恢复能力未确认"]')!)).toHaveLength(0);
    expect(buttons("恢复")).toHaveLength(1);
    expect(host.textContent).toContain("恢复受阻：运行环境暂不可用，请检查后刷新 · 恢复条件尚未满足，请刷新核对或查看主机诊断");
    expect(host.textContent).not.toContain("preview_runtime_unavailable");
    expect(host.textContent).not.toContain("unrecognized_backend_code");
    click(button("恢复")); await flush();
    expect(onAction).toHaveBeenCalledWith({ kind: "restore", memberId: "soft" });
  });

  it("defaults to recoverable archive and accepts pasted exact names for permanent retirement", async () => {
    const { onAction } = mount([member()]); open();
    expect(document.querySelector("dialog")!.open).toBe(true);
    expect(input("软归档（默认，可恢复）").checked).toBe(true);
    expect(document.querySelectorAll('dialog input:not([type="radio"])')).toHaveLength(0);
    click(input("永久退休（不能恢复）"));
    await flush();
    const submit = button("确认永久退休");
    const nameInput = input("确认名字：Wren（eva）");
    paste(nameInput, " Wren"); expect(submit.disabled).toBe(true);
    paste(nameInput, "wren"); expect(submit.disabled).toBe(true);
    paste(nameInput, "Wren"); expect(submit.disabled).toBe(false);
    click(submit); await flush();
    expect(reviewRetirement).toHaveBeenCalledWith({ cutex_session_id: "wren" });
    expect(onAction).toHaveBeenCalledWith({ kind: "retire", payload: {
      cutex_session_id: "wren", confirmed_name: "Wren", confirmation_token: "token-wren", expected_revision: 42,
    } });
  });

  it("never offers permanent retirement without retire permission", () => {
    const value = member({ allowedActions: ["archive"] });
    mount([value]); open();
    expect(input("永久退休（不能恢复）").disabled).toBe(true);
  });

  it("submits a soft archive batch without name entry after review", async () => {
    const { onAction } = mount([member(), member({ id: "second", name: "Astra" })]);
    for (const checkbox of document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) click(checkbox);
    click(button("归档所选成员（2）…"));
    const submit = button("确认软归档");
    expect(document.querySelectorAll('dialog input:not([type="radio"])')).toHaveLength(0);
    expect(document.querySelector("dialog")!.textContent).toContain("Wren · eva");
    expect(document.querySelector("dialog")!.textContent).toContain("Astra · eva");
    expect(submit.disabled).toBe(false);
    click(submit); await flush();
    expect(onAction).toHaveBeenCalledTimes(2);
    expect(onAction.mock.calls.map(call => call[0])).toEqual([{ kind: "archive", memberId: "wren" }, { kind: "archive", memberId: "second" }]);
  });

  it("invalidates a name confirmation when member information changes", async () => {
    const { onAction } = mount([member()]); open();
    click(input("永久退休（不能恢复）"));
    await flush();
    paste(input("确认名字：Wren（eva）"), "Wren");
    mount([member({ name: "Renamed" })], onAction);
    expect(button("确认永久退休").disabled).toBe(true);
    expect(document.querySelector('[role="status"]')!.textContent).toContain("成员信息或权限已变化");
  });

  it("requires every name for batch retirement and sends each exact confirmation", async () => {
    const { onAction } = mount([member(), member({ id: "second", name: "Astra" })]);
    for (const checkbox of document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) click(checkbox);
    click(button("归档所选成员（2）…"));
    click(input("永久退休（不能恢复）"));
    await flush();
    paste(input("确认名字：Wren（eva）"), "Wren");
    expect(button("确认永久退休").disabled).toBe(true);
    paste(input("确认名字：Astra（eva）"), "Astra");
    click(button("确认永久退休")); await flush();
    expect(onAction.mock.calls.map(call => call[0])).toEqual([
      { kind: "retire", payload: { cutex_session_id: "wren", confirmed_name: "Wren", confirmation_token: "token-wren", expected_revision: 42 } },
      { kind: "retire", payload: { cutex_session_id: "second", confirmed_name: "Astra", confirmation_token: "token-second", expected_revision: 42 } },
    ]);
  });

  it("rechecks permission between batch requests and stops after a revocation", async () => {
    let finish: () => void = () => {};
    const onAction = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const first = member(); const second = member({ id: "second", name: "Astra" });
    mount([first, second], onAction);
    for (const checkbox of document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) click(checkbox);
    click(button("归档所选成员（2）…"));
    click(button("确认软归档"));
    mount([first, { ...second, allowedActions: second.allowedActions!.filter(action => action !== "archive") }], onAction);
    await act(async () => finish());
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="alert"]')!.textContent).toContain("成员信息或权限已变化");
  });

  it("stops a batch on failure and excludes completed members from retry", async () => {
    const onAction = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("blocked")).mockResolvedValue(undefined);
    mount([member(), member({ id: "second", name: "Astra" })], onAction);
    for (const checkbox of document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) click(checkbox);
    click(button("归档所选成员（2）…"));
    click(button("确认软归档")); await flush();
    expect(document.querySelector('[role="alert"]')!.textContent).toContain("请刷新并核对成员的当前状态");
    expect(document.querySelector('[role="alert"]')!.textContent).not.toContain("blocked");
    expect(document.querySelectorAll("dialog ul li")).toHaveLength(1);
    click(button("确认软归档")); await flush();
    expect(onAction).toHaveBeenCalledTimes(3);
    expect(onAction.mock.calls[2]![0]).toEqual({ kind: "archive", memberId: "second" });
  });

  it("stops at the first rejected unknown or partial result and keeps the dialog open", async () => {
    const onAction = vi.fn().mockRejectedValue(new Error("effect_state_partial_backend_code"));
    mount([member(), member({ id: "second", name: "Astra" })], onAction);
    for (const checkbox of document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) click(checkbox);
    click(button("归档所选成员（2）…"));
    click(button("确认软归档")); await flush();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(document.querySelector("dialog")!.open).toBe(true);
    expect(document.querySelectorAll("dialog ul li")).toHaveLength(2);
    expect(document.querySelector('[role="alert"]')!.textContent).toContain("操作未能确认完成");
    expect(document.body.textContent).not.toContain("effect_state_partial_backend_code");
  });

  it("shows a plain refresh hint for failed restore without leaking backend errors", async () => {
    const onAction = vi.fn().mockRejectedValue(new Error("restore_refused_backend_code"));
    mount([member({ archiveKind: "soft" })], onAction);
    click(button("恢复")); await flush();
    expect(document.querySelector('[role="alert"]')!.textContent).toContain("请刷新并核对成员的当前状态");
    expect(document.body.textContent).not.toContain("restore_refused_backend_code");
  });

  it.each([undefined, false])("requires explicit archive capability (%s)", archiveSupported => {
    mount([member(), member({ id: "soft", archiveKind: "soft" })], undefined, { archiveSupported });
    expect(buttons("归档…")).toHaveLength(0);
    expect(buttons("恢复")).toHaveLength(0);
    expect(button("归档所选成员（0）…").disabled).toBe(true);
    expect(reviewRetirement).not.toHaveBeenCalled();
    // The independent activity capability still permits this action.
    expect(buttons("下线")).toHaveLength(1);
  });

  it.each([undefined, false])("requires explicit activity capability (%s)", activitySupported => {
    mount([member()], undefined, { activitySupported });
    expect(document.querySelector("[data-idle]")).toBeNull();
    expect(buttons("下线")).toHaveLength(0);
    expect(buttons("归档…")).toHaveLength(1);
  });

  it("does not treat lifecycle candidates or owner identity as member-management permission", () => {
    const members = [member({ allowedActions: ["archive"] }), member({ id: "soft", archiveKind: "soft", allowedActions: ["restore"] })];
    mount(members, undefined, { snapshot: { ...snapshot(members), caller: { isOwner: true, canManageMembers: false, canOfflineMembers: true } } });
    expect(buttons("归档…")).toHaveLength(0);
    expect(buttons("恢复")).toHaveLength(0);
  });

  it("hides retirement for nonowners even when lifecycle permits permanentRetire", () => {
    const members = [member({ allowedActions: ["permanentRetire"] })];
    const caller = { isOwner: false, canManageMembers: true, canOfflineMembers: true };
    mount(members, undefined, { snapshot: { ...snapshot(members), caller } });
    expect(buttons("归档…")).toHaveLength(0);
    const archivable = [member()];
    mount(archivable, undefined, { snapshot: { ...snapshot(archivable), caller } }); open();
    expect([...document.querySelectorAll("label")].some(label => label.textContent === "永久退休（不能恢复）")).toBe(false);
    expect(reviewRetirement).not.toHaveBeenCalled();
  });

  it("requires the supplied review callback before allowing retirement", () => {
    mount([member()], undefined, { reviewRetirement: undefined }); open();
    expect(input("永久退休（不能恢复）").disabled).toBe(true);
    expect(reviewRetirement).not.toHaveBeenCalled();
  });

  it.each([
    ["agent_name_taken", "原来的名字已被占用，请先处理重名"],
    ["restore_project_first", "请先恢复所属项目"],
    ["archive_state_unavailable", "暂时无法确认归档状态，请刷新核对"],
    ["permanently_closed", "成员已永久关闭，不能恢复"],
    ["runtime_not_offline", "运行环境尚未下线，请先核对运行状态"],
    ["not_archived", "成员尚未归档，无需恢复"],
    ["future_unknown_reason", "恢复条件尚未满足，请刷新核对或查看主机诊断"],
  ])("keeps soft archives blocked by %s and translates the reason", (code, message) => {
    mount([member({ archiveKind: "soft", restorable: true, allowedActions: ["restore"], restoreBlockers: [code] })]);
    expect(buttons("恢复")).toHaveLength(0);
    expect(host.textContent).toContain(message);
    expect(host.textContent).not.toContain(code);
  });

  it("uses the server formal name, preserves whitespace and keeps the token out of storage and markup", async () => {
    const persist = vi.spyOn(Storage.prototype, "setItem");
    reviewRetirement.mockResolvedValue(review("wren", { formal_name: " Wren 正式名 " }));
    const { onAction } = mount([member()]); open();
    expect(reviewRetirement).not.toHaveBeenCalled();
    click(input("永久退休（不能恢复）")); await flush();
    const nameInput = input("确认名字： Wren 正式名 （eva）");
    paste(nameInput, "Wren"); expect(button("确认永久退休").disabled).toBe(true);
    paste(nameInput, "Wren 正式名"); expect(button("确认永久退休").disabled).toBe(true);
    paste(nameInput, " Wren 正式名 "); expect(button("确认永久退休").disabled).toBe(false);
    expect(document.body.innerHTML).not.toContain("token-wren");
    expect(persist).not.toHaveBeenCalled();
    click(button("确认永久退休")); await flush();
    expect(onAction).toHaveBeenCalledWith({ kind: "retire", payload: {
      cutex_session_id: "wren", confirmed_name: " Wren 正式名 ", confirmation_token: "token-wren", expected_revision: 42,
    } });
  });

  it("cannot submit while review is pending", async () => {
    let finish: (value: PermanentRetirementReview) => void = () => {};
    reviewRetirement.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { onAction } = mount([member()]); open();
    click(input("永久退休（不能恢复）"));
    expect(button("确认永久退休").disabled).toBe(true);
    click(button("确认永久退休"));
    expect(onAction).not.toHaveBeenCalled();
    await act(async () => finish(review()));
    expect(input("确认名字：Wren（eva）").disabled).toBe(false);
  });

  it.each([
    { confirmation_token: "" }, { cutex_session_id: "different-target" }, { formal_name: "" },
    { revision: -1 }, { revision: 1.5 }, { runtime_generation: -1 }, { expires_at_unix: 0 },
  ])("rejects an unusable review response: %j", async fields => {
    reviewRetirement.mockResolvedValue(review("wren", fields));
    const { onAction } = mount([member()]); open();
    click(input("永久退休（不能恢复）")); await flush();
    expect(button("确认永久退休").disabled).toBe(true);
    expect(document.querySelector('[role="alert"]')!.textContent).toContain("重新复核");
    expect(onAction).not.toHaveBeenCalled();
  });

  it("expires a review after 300 seconds and asks for a new review", async () => {
    vi.useFakeTimers();
    const { onAction } = mount([member()]); open();
    click(input("永久退休（不能恢复）")); await flush();
    paste(input("确认名字：Wren（eva）"), "Wren");
    expect(button("确认永久退休").disabled).toBe(false);
    await act(async () => { vi.advanceTimersByTime(300_000); });
    expect(button("确认永久退休").disabled).toBe(true);
    expect(document.querySelector('[role="alert"]')!.textContent).toContain("重新复核");
    click(button("确认永久退休")); expect(onAction).not.toHaveBeenCalled();
  });

  it.each(["archive_confirmation_expired", "archive_confirmation_stale", "archive_confirmation_occurrence_changed"])("discards a rejected token (%s) and reviews again only after reopening", async code => {
    const onAction = vi.fn().mockRejectedValue(Object.assign(new Error("request refused"), { code }));
    mount([member()], onAction); open();
    click(input("永久退休（不能恢复）")); await flush();
    paste(input("确认名字：Wren（eva）"), "Wren");
    click(button("确认永久退休")); await flush();
    expect(button("确认永久退休").disabled).toBe(true);
    expect(document.querySelector('[role="alert"]')!.textContent).toContain("重新复核");
    expect(document.body.textContent).not.toContain(code);
    expect(reviewRetirement).toHaveBeenCalledTimes(1);
    click(button("取消")); open();
    click(input("永久退休（不能恢复）")); await flush();
    expect(reviewRetirement).toHaveBeenCalledTimes(2);
    expect(input("确认名字：Wren（eva）").value).toBe("");
  });

  it("asks to check the original receipt when review rejects a pending retirement", async () => {
    reviewRetirement.mockRejectedValue(new Error("permanent_retirement_pending"));
    const { onAction } = mount([member()]); open();
    click(input("永久退休（不能恢复）")); await flush();
    expect(document.querySelector('[role="alert"]')!.textContent).toBe("退休结果尚未确认。请先核对原操作回执，不要重新发起退休。");
    expect(button("确认永久退休").disabled).toBe(true);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("reviews batch members individually and stops at the first failed review", async () => {
    reviewRetirement.mockRejectedValue(new Error("archive_confirmation_capacity"));
    const { onAction } = mount([member(), member({ id: "second", name: "Astra" })]);
    for (const checkbox of document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) click(checkbox);
    click(button("归档所选成员（2）…"));
    click(input("永久退休（不能恢复）")); await flush();
    expect(reviewRetirement).toHaveBeenCalledTimes(1);
    expect(button("确认永久退休").disabled).toBe(true);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("stops batch retirement on an uncertain first execution without reusing the tokens", async () => {
    const onAction = vi.fn().mockRejectedValue(new Error("partial_result"));
    mount([member(), member({ id: "second", name: "Astra" })], onAction);
    for (const checkbox of document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) click(checkbox);
    click(button("归档所选成员（2）…"));
    click(input("永久退休（不能恢复）")); await flush();
    expect(reviewRetirement.mock.calls).toEqual([[{ cutex_session_id: "wren" }], [{ cutex_session_id: "second" }]]);
    paste(input("确认名字：Wren（eva）"), "Wren");
    paste(input("确认名字：Astra（eva）"), "Astra");
    click(button("确认永久退休")); await flush();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(button("确认永久退休").disabled).toBe(true);
    expect(document.querySelector('[role="alert"]')!.textContent).toBe("退休结果尚未确认。请先核对原操作回执，不要重新发起退休。");
  });

  it("rechecks owner permission if it changes while reviewing", async () => {
    let finish: (value: PermanentRetirementReview) => void = () => {};
    reviewRetirement.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const members = [member()]; const { onAction } = mount(members); open();
    click(input("永久退休（不能恢复）"));
    mount(members, onAction, { snapshot: { ...snapshot(members), caller: { isOwner: false, canManageMembers: true, canOfflineMembers: true } } });
    await act(async () => finish(review()));
    expect(button("确认永久退休").disabled).toBe(true);
    expect(onAction).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')!.textContent).toContain("重新复核");
  });
});


it("shows activity-only evidence and offline control without lifecycle fields", () => {
  const activity = { id: "worker", hostId: "eva", name: "Worker", director: false, activityStatus: "idle" as const, observedAt: "2026-10-27T03:00:00Z", lastActivityAt: "2026-10-27T00:00:00Z" };
  mount([activity], undefined, { archiveSupported: false, reviewRetirement: undefined, activitySupported: true });
  expect(document.querySelector('[data-idle="true"]')).not.toBeNull();
  expect(buttons("下线")).toHaveLength(1);
  expect(buttons("归档…")).toHaveLength(0);
});
it("shows lifecycle-only controls without inventing activity evidence", () => {
  const lifecycle = { id: "worker", hostId: "eva", name: "Worker", director: false, archiveKind: "active" as const, restorable: false, allowedActions: ["archive" as const], restoreBlockers: [] };
  mount([lifecycle], undefined, { activitySupported: false });
  expect(document.querySelector("[data-idle]")).toBeNull();
  expect(buttons("下线")).toHaveLength(0);
  expect(buttons("归档…")).toHaveLength(1);
});
