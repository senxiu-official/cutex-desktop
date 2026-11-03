// @vitest-environment jsdom
// Images in steers (cutex image-input-steering, r264): the capability / feature helpers, steer delivery with
// the session's declaration, receipts only from cutex's imageDelivery, the host setting row (only with the
// feature, PATCH {imageInput: {busyBehavior}}), and the wording audit (no 「不支持插话」 / 「不能插话」).
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const target = vi.hoisted(() => ({
  features: new Set<string>(),
  settings: null as Record<string, unknown> | null,
  patches: [] as unknown[],
}));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/lib/targetHost", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/renderer/src/lib/targetHost")>()),
  useTargetFeatures: () => target.features,
  useTargetApi: () => ({
    getSettings: async () => target.settings,
    patchSettings: async (patch: Record<string, unknown>) => {
      target.patches.push(patch);
      target.settings = { ...target.settings, ...patch };
      return target.settings;
    },
  }),
}));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => {
  const { zhCN } = await import("../src/renderer/src/i18n/zh-CN");
  const t = (key: string) => (zhCN as Record<string, string>)[key]?.replace(/\{\{agents?\}\}/g, "智能体") ?? key;
  return { ...(await importOriginal<object>()), useI18n: () => ({ t, locale: "zh-CN" }) };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { draftSteerPlan, hasImageInput, IMAGE_INPUT_STEERING_FEATURE, imageBusyPatch, imageDeliveryOf, imageSteeringOf, imageSteerMode, readImageBusyBehavior, refusesImageSteer } from "../src/renderer/src/lib/imageSteer";
import { steerDelivery } from "../src/renderer/src/lib/legacyDelivery/pendingSteers";
import { queueInsertLabel, type QueueInsertFeedback } from "../src/renderer/src/lib/queueInsertFeedback";
import { insertRefusal } from "../src/renderer/src/lib/legacyDelivery/admissionOrder";
import { SteerDeliveryNote } from "../src/renderer/src/components/AdmissionRows";
import { ImageBusyRow, ImageBusySection } from "../src/renderer/src/components/settings/AppSettings";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";
import { panelGuidesZhCN as panelGuideMessages } from "../src/renderer/src/modules/onboarding/panelGuideMessages";

const session = (steering: unknown) => ({ native: { schema: { capabilities: { features: { imageInput: true, imageInputSteering: { busyBehaviorDefault: "queue", steering, requiresTargetHostPath: steering === "pathText" } } } } } });
const WITH = new Set([IMAGE_INPUT_STEERING_FEATURE]);
const WITHOUT = new Set<string>();

afterEach(() => {
  target.features = new Set();
  target.settings = null;
  target.patches.length = 0;
  document.body.innerHTML = "";
});

describe("capability / feature helpers (lib/imageSteer)", () => {
  it("reads the session's declared image steering; anything else is unknown", () => {
    expect(imageSteeringOf(session("pathText"))).toBe("pathText");
    expect(imageSteeringOf(session("nativeImage"))).toBe("nativeImage");
    expect(imageSteeringOf(session("unsupported"))).toBe("unsupported");
    expect(imageSteeringOf(session("later"))).toBeNull();
    expect(imageSteeringOf({ native: { schema: null } })).toBeNull();
    expect(imageSteeringOf(null)).toBeNull();
  });

  it("only capabilities.features.imageInputSteering counts: not the draft's capabilities.imageInput, not the old boolean", () => {
    const caps = (capabilities: unknown) => ({ native: { schema: { capabilities } } });
    expect(imageSteeringOf(caps({ imageInput: { steering: "pathText" } }))).toBeNull();
    expect(imageSteeringOf(caps({ features: { imageInput: true } }))).toBeNull();
    expect(imageSteeringOf(caps({ features: { imageInput: false, imageInputSteering: "nativeImage" } }))).toBe("nativeImage");
  });

  it("without the host feature nothing is declared (older cutex keeps today's behaviour)", () => {
    expect(imageSteerMode(WITH, session("pathText"))).toBe("pathText");
    expect(imageSteerMode(WITHOUT, session("pathText"))).toBeNull();
    expect(imageSteerMode(WITHOUT, session("unsupported"))).toBeNull();
  });

  it("images are image / localImage input items", () => {
    expect(hasImageInput([{ type: "text", text: "x" }, { type: "localImage", path: "/a.png" }])).toBe(true);
    expect(hasImageInput([{ type: "image", url: "data:image/png;base64,AA==" }])).toBe(true);
    expect(hasImageInput([{ type: "text", text: "x" }, { type: "skill", name: "s", path: "/s" }])).toBe(false);
    expect(hasImageInput(undefined)).toBe(false);
  });

  it("the composer's explicit 插话 of a draft: plain unless feature + busy + images; unsupported refuses (stays queued)", () => {
    const base = { feature: true, busy: true, images: true };
    expect(draftSteerPlan({ ...base, mode: "pathText" })).toBe("queueThenSteer");
    expect(draftSteerPlan({ ...base, mode: "nativeImage" })).toBe("queueThenSteer");
    // Not declared: cutex decides (its refusal is shown).
    expect(draftSteerPlan({ ...base, mode: null })).toBe("queueThenSteer");
    expect(draftSteerPlan({ ...base, mode: "unsupported" })).toBe("refuse");
    expect(draftSteerPlan({ ...base, feature: false, mode: "unsupported" })).toBe("plain");
    expect(draftSteerPlan({ ...base, busy: false, mode: "unsupported" })).toBe("plain");
    expect(draftSteerPlan({ ...base, images: false, mode: "unsupported" })).toBe("plain");
    expect(refusesImageSteer("unsupported", [{ type: "localImage", path: "/a" }])).toBe(true);
    expect(refusesImageSteer("unsupported", [{ type: "text", text: "a" }])).toBe(false);
    expect(refusesImageSteer(null, [{ type: "localImage", path: "/a" }])).toBe(false);
  });

  it("imageDelivery only as cutex sent it", () => {
    expect(imageDeliveryOf({ disposition: "steered", imageDelivery: "pathText" })).toBe("pathText");
    expect(imageDeliveryOf({ imageDelivery: "nativeImage" })).toBe("nativeImage");
    expect(imageDeliveryOf({ imageDelivery: "seen" })).toBeUndefined();
    expect(imageDeliveryOf({ disposition: "steered" })).toBeUndefined();
    expect(imageDeliveryOf(null)).toBeUndefined();
  });

  it("dragging an image message onto the turn of a runtime that cannot insert images is refused (others not)", () => {
    expect(insertRefusal({ kind: "owner" }, true, true)).toBe("noImages");
    expect(insertRefusal({ kind: "owner" }, true, false)).toBeNull();
    expect(insertRefusal({ kind: "owner" }, false, true)).toBe("noSteer");
    expect(insertRefusal({ kind: "ask", askId: "a" }, true, true)).toBe("askTurn");
  });
});

describe("steerDelivery with the session's image steering", () => {
  const image = { imageCount: 1 };
  it("a Claude image steer rides the tool boundary with pathText (declared or receipted); unsupported / absent stays nextTurn", () => {
    expect(steerDelivery(image, "claude", "pathText")).toBe("toolBoundary");
    expect(steerDelivery(image, "claude", "nativeImage")).toBe("toolBoundary");
    expect(steerDelivery(image, "claude", "unsupported")).toBe("nextTurn");
    expect(steerDelivery(image, "claude", null)).toBe("nextTurn");
    expect(steerDelivery(image, "claude")).toBe("nextTurn");
    expect(steerDelivery({ ...image, imageDelivery: "pathText" }, "claude")).toBe("toolBoundary");
    // Text steers and Codex as before.
    expect(steerDelivery({ imageCount: 0 }, "claude", "unsupported")).toBe("toolBoundary");
    expect(steerDelivery(image, "codex", "unsupported")).toBe("toolBoundary");
    expect(steerDelivery(image, "dsh", "pathText")).toBe("nextTurn");
  });

  it("the steer row: 已以文件路径插入 / 已直接插入图片 only from a receipt; plain 已插入 without one; never 已插入 for nextTurn", () => {
    const html = (steer: Parameters<typeof SteerDeliveryNote>[0]["steer"], imageSteering?: "pathText" | "unsupported") => renderToStaticMarkup(h(SteerDeliveryNote, { steer, runtime: "claude", imageSteering }));
    expect(html({ imageCount: 1, imageDelivery: "pathText" })).toContain("已以文件路径插入 · 等下一个工具边界");
    expect(html({ imageCount: 1, imageDelivery: "nativeImage" })).toContain("已直接插入图片 · 等下一个工具边界");
    expect(html({ imageCount: 1 }, "pathText")).toContain(">已插入 · 等下一个工具边界<");
    const unsupported = html({ imageCount: 1 }, "unsupported");
    expect(unsupported).toContain("下一回合发送");
    expect(unsupported).not.toContain("已插入");
  });
});

describe("the insert receipt (lib/queueInsertFeedback)", () => {
  const f = (over: Partial<QueueInsertFeedback>): QueueInsertFeedback => ({ token: {}, item: {} as never, state: "inserted", ...over });
  it("an inserted steer says how its images went in when cutex said so; otherwise nothing about the mode", () => {
    expect(queueInsertLabel(f({ imageDelivery: "pathText" }))).toBe("queue.insert.pathText");
    expect(queueInsertLabel(f({ imageDelivery: "nativeImage" }))).toBe("queue.insert.nativeImage");
    expect(queueInsertLabel(f({}))).toBe("queue.insertedToast");
    // Delivered / started keep their own words.
    expect(queueInsertLabel(f({ state: "delivered", imageDelivery: "pathText" }))).toBe("queue.insert.delivered");
    expect(queueInsertLabel(f({ state: "started", imageDelivery: "nativeImage" }))).toBe("queue.insert.started");
    expect(zhCN["queue.insert.pathText"]).toBe("已以文件路径插入");
    expect(zhCN["queue.insert.nativeImage"]).toBe("已直接插入图片");
  });
});

describe("the host setting 运行中的图片消息 (imageInput.busyBehavior)", () => {
  async function mount(node: ReturnType<typeof h>) {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(node));
    await act(async () => { await Promise.resolve(); });
    return { el, root };
  }

  it("reads the setting (absent = unknown) and builds the PATCH body", () => {
    expect(readImageBusyBehavior({ imageInput: { busyBehavior: "steer" } })).toBe("steer");
    expect(readImageBusyBehavior({ imageInput: { busyBehavior: "queue" } })).toBe("queue");
    expect(readImageBusyBehavior({})).toBeUndefined();
    expect(readImageBusyBehavior(null)).toBeUndefined();
    expect(imageBusyPatch("steer")).toEqual({ imageInput: { busyBehavior: "steer" } });
  });

  it("a host row with its effect declaration; disabled until the value is known", () => {
    const html = renderToStaticMarkup(h(ImageBusyRow, { value: undefined, onChange: () => {} }));
    expect(html).toContain("带图片的消息");
    expect(html).toMatch(/aria-disabled="true"/);
    const steer = renderToStaticMarkup(h(ImageBusyRow, { value: "steer", onChange: () => {} }));
    expect(steer).toContain(zhCN["queue.imageBusy.steerHint"]);
  });

  it("only with the feature; choosing 插入当前回合 PATCHes {imageInput: {busyBehavior: steer}}", async () => {
    target.settings = { imageInput: { busyBehavior: "queue" } };
    const hidden = await mount(h(ImageBusySection));
    expect(hidden.el.innerHTML).toBe("");
    await act(async () => hidden.root.unmount());

    target.features = new Set([IMAGE_INPUT_STEERING_FEATURE]);
    const { el, root } = await mount(h(ImageBusySection));
    expect(el.textContent).toContain("运行中的图片消息");
    const steer = [...el.querySelectorAll("button")].find((b) => b.textContent === "插入当前回合")!;
    expect(steer).toBeTruthy();
    await act(async () => steer.click());
    await act(async () => { await Promise.resolve(); });
    expect(target.patches).toEqual([{ imageInput: { busyBehavior: "steer" } }]);
    expect(el.textContent).toContain(zhCN["queue.imageBusy.steerHint"]);
    await act(async () => root.unmount());
  });
});

describe("wording audit: 「不支持插话」 / 「不能插话」 are gone", () => {
  it("no zh-CN value (host catalog and the onboarding guide) says them; en no longer says the runtime does not support steering", () => {
    const zhValues = [...Object.values(zhCN), ...Object.values(panelGuideMessages)];
    expect(zhValues.filter((v) => v.includes("不支持插话") || v.includes("不能插话"))).toEqual([]);
    expect(Object.values(en).filter((v) => /does not support steering|can't insert into a running turn|can't insert now/i.test(v))).toEqual([]);
    // What happens instead is said.
    expect(zhCN["queue.steer.runtimeNoSteer"]).toContain("本回合结束后发送");
    expect(zhCN["queue.turn.refuseNoSteer"]).toContain("本回合结束后发送");
    // Images are named only by the image-specific keys.
    expect(zhCN["queue.steer.imageUnsupported"]).toContain("不能把图片插入正在进行的回合");
  });
});
