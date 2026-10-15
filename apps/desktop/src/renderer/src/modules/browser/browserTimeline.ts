// Pure projections of browser history. Never stringify arguments/results into the UI:
// fill values, page bodies, raw errors, URLs and request authority are not summaries.
import type { RawItem } from "../../lib/timeline";
import type { BrowserTurnShot } from "../../../../shared/browser";

export const BROWSER_TIMELINE_TOOLS = ["browser_list", "browser_read", "browser_find", "browser_act", "browser_navigate",
  "browser_screenshot", "browser_release", "browser_open", "browser_claim"] as const;
export type BrowserTimelineTool = typeof BROWSER_TIMELINE_TOOLS[number];
export const BROWSER_IMAGE_BASE64_LIMIT = 6 * 1024 * 1024;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const tool = (value: unknown): value is BrowserTimelineTool => typeof value === "string" && BROWSER_TIMELINE_TOOLS.some(name => name === value);

export const browserTimelineZhCN = {
  "browser.timeline.list": "列出已授予的标签", "browser.timeline.read": "读取网页结构", "browser.timeline.find": "查找网页元素",
  "browser.timeline.act": "网页操作", "browser.timeline.navigate": "导航网页", "browser.timeline.screenshot": "网页截图",
  "browser.timeline.release": "交回网页控制", "browser.timeline.open": "打开网页", "browser.timeline.claim": "申请网页控制",
  "browser.timeline.click": "点击元素", "browser.timeline.fill": "填写字段（内容不展示）", "browser.timeline.press": "按键",
  "browser.timeline.scroll": "滚动网页", "browser.timeline.scrollIntoView": "显示目标元素", "browser.timeline.select": "选择选项",
  "browser.timeline.check": "勾选", "browser.timeline.uncheck": "取消勾选", "browser.timeline.hover": "悬停元素",
  "browser.timeline.wait": "等待网页状态", "browser.timeline.back": "网页后退", "browser.timeline.forward": "网页前进",
  "browser.timeline.reload": "重新加载网页", "browser.timeline.dialog": "设置下一次网页对话框响应",
  "browser.timeline.loadImage": "加载完整截图", "browser.timeline.loading": "正在读取截图…",
  "browser.timeline.imageUnavailable": "截图不可用或已超出读取限额", "browser.timeline.failed": "浏览器操作未完成",
  "browser.timeline.running": "浏览器操作进行中", "browser.timeline.done": "浏览器操作已返回",
  "browser.timeline.turnShots": "本轮结束时的网页截图", "browser.timeline.ownerOnly": "仅供你查看，不会发送给模型",
  "browser.timeline.showShot": "查看轮末截图", "browser.timeline.hideShot": "收起截图",
  "browser.timeline.refused.external": "被拦下：外部网页已关闭（设置 → 浏览器 →「允许浏览外部网页」），或这是局域网 / 私有地址；{{agent}}的浏览器现在只能打开本机地址（localhost / 127.0.0.1）或 cutex:service/ 链接。想给你看的页面或图片，可以作为成果发布。",
  "browser.timeline.refused.serviceProxy": "被拦下：这台主机不是你这台电脑，它的 127.0.0.1 在这里打不开。只能用 cutex:service/<服务名>/ 链接（先登记服务）。",
  "browser.timeline.refused.disabled": "被拦下：这台设备的内嵌浏览器没开，或这个 Profile 没开浏览器工具。",
} as const;
export const browserTimelineEn: Record<keyof typeof browserTimelineZhCN, string> = {
  "browser.timeline.list": "List granted tabs", "browser.timeline.read": "Read page structure", "browser.timeline.find": "Find page elements",
  "browser.timeline.act": "Page action", "browser.timeline.navigate": "Navigate page", "browser.timeline.screenshot": "Page screenshot",
  "browser.timeline.release": "Release page control", "browser.timeline.open": "Open page", "browser.timeline.claim": "Request page control",
  "browser.timeline.click": "Click element", "browser.timeline.fill": "Fill field (value hidden)", "browser.timeline.press": "Press key",
  "browser.timeline.scroll": "Scroll page", "browser.timeline.scrollIntoView": "Show target element", "browser.timeline.select": "Select option",
  "browser.timeline.check": "Check", "browser.timeline.uncheck": "Uncheck", "browser.timeline.hover": "Hover element",
  "browser.timeline.wait": "Wait for page state", "browser.timeline.back": "Go back", "browser.timeline.forward": "Go forward",
  "browser.timeline.reload": "Reload page", "browser.timeline.dialog": "Set next page-dialog response",
  "browser.timeline.loadImage": "Load full screenshot", "browser.timeline.loading": "Reading screenshot…",
  "browser.timeline.imageUnavailable": "Screenshot unavailable or beyond the read limit", "browser.timeline.failed": "Browser operation did not complete",
  "browser.timeline.running": "Browser operation in progress", "browser.timeline.done": "Browser operation returned",
  "browser.timeline.turnShots": "Page screenshots at the end of this turn", "browser.timeline.ownerOnly": "For you only; not sent to the model",
  "browser.timeline.showShot": "View end-of-turn screenshot", "browser.timeline.hideShot": "Hide screenshot",
  "browser.timeline.refused.external": "Refused: websites are turned off (Settings → Browser → Allow websites), or this is a LAN / private address; the {{agent}}'s browser can only open local addresses (localhost / 127.0.0.1) or cutex:service/ links right now. A page or picture meant for you can be published as an artifact.",
  "browser.timeline.refused.serviceProxy": "Refused: this host is not your computer, so its 127.0.0.1 cannot be opened here. Only cutex:service/<service name>/ links work (register the service first).",
  "browser.timeline.refused.disabled": "Refused: the in-app browser is off on this device, or this Profile has browser tools off.",
};
export type BrowserTimelineKey = keyof typeof browserTimelineZhCN;

/**
 * Owner-facing text for an agent's refused browser call: why, and what works there (the agent gets
 * cutex's code only; its hint needs cutex). null = the generic browser error text.
 */
export function browserTimelineRefusalKey(code: string | null): BrowserTimelineKey | null {
  switch (code) {
    case "external_pages_unavailable": return "browser.timeline.refused.external";
    case "service_proxy_required": return "browser.timeline.refused.serviceProxy";
    case "browser_disabled": return "browser.timeline.refused.disabled";
    default: return null;
  }
}

export function browserToolName(item: RawItem): BrowserTimelineTool | null {
  if (!tool(item.tool)) return null;
  if (item.type === "mcpToolCall" && item.server === "cutex") return item.tool;
  // The API runtime emits dynamic tools with namespace=claude; subscription emits MCP.
  if (item.type === "dynamicToolCall" && (item.namespace === "claude" || item.namespace === "cutex")) return item.tool;
  return null;
}
export const isBrowserTool = (item: RawItem): boolean => browserToolName(item) !== null;

function argumentsOf(item: RawItem): Record<string, unknown> {
  if (object(item.arguments)) return item.arguments;
  if (typeof item.arguments === "string" && item.arguments.length <= 256 * 1024) {
    try { const parsed: unknown = JSON.parse(item.arguments); if (object(parsed)) return parsed; } catch { /* no raw fallback */ }
  }
  return {};
}

/** Only bounded PNG/JPEG bytes; never request an image URL in the privileged app session. */
export function browserTimelineImage(mime: unknown, data: unknown): string | null {
  if ((mime !== "image/png" && mime !== "image/jpeg") || typeof data !== "string"
    || data.length === 0 || data.length > BROWSER_IMAGE_BASE64_LIMIT || data.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return null;
  // Complete decode is main/daemon's job. These framing checks also reject old compact prefixes.
  if (mime === "image/png" ? !data.startsWith("iVBORw0KGgo") : !data.startsWith("/9j/")) return null;
  return `data:${mime};base64,${data}`;
}
export function browserTimelineDataImage(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > BROWSER_IMAGE_BASE64_LIMIT + 32) return null;
  const comma = raw.indexOf(";base64,");
  if (!raw.startsWith("data:") || comma < 0) return null;
  return browserTimelineImage(raw.slice(5, comma), raw.slice(comma + 8));
}

const ACTIONS = new Set(["click", "fill", "press", "scroll", "scrollIntoView", "select", "check", "uncheck", "hover", "wait", "back", "forward", "reload", "dialog"]);
const ERRORS = new Set(["invalid_request", "unsupported_operation", "permission_denied", "browser_disabled", "browser_unavailable",
  "target_closed", "target_hidden", "owner_paused", "lease_revoked", "lease_ended_desktop_restarted", "stale_connection", "stale_request", "stale_ref", "deadline_exceeded",
  "cancelled", "outcome_unknown", "request_conflict", "request_result_not_retained", "approval_required", "approval_denied", "lease_limit",
  "lease_conflict", "busy", "idempotency_capacity_exceeded", "scope_unsupported", "scope_invalid", "external_pages_unavailable", "service_proxy_required", "message_too_large", "invalid_result",
  "unsupported_provider", "navigation_failed", "service_unavailable", "service_auth_failed", "browser_identity_unavailable"]);
export interface BrowserToolView {
  tool: BrowserTimelineTool; title: string; summary: BrowserTimelineKey; state: "running" | "done" | "failed";
  errorCode: string | null; image: string | null; imageState: "none" | "ready" | "not-loaded" | "invalid";
}

export function browserToolView(item: RawItem): BrowserToolView | null {
  const name = browserToolName(item); if (!name) return null;
  const args = argumentsOf(item), action = object(args.action) ? args.action : {};
  let title = typeof args.title === "string" ? args.title.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim() : "";
  // Even an accidentally repeated fill value in the title is not a safe action summary.
  if (name === "browser_act" && action.kind === "fill" && typeof action.text === "string" && action.text) title = title.split(action.text).join("…");
  title = [...title].slice(0, 200).join("");
  const suffix = name === "browser_act" && typeof action.kind === "string" && ACTIONS.has(action.kind) ? action.kind : name.slice("browser_".length);
  const summary = `browser.timeline.${suffix}` as BrowserTimelineKey;
  const result = object(item.result) ? item.result : {};
  const blocks = item.type === "mcpToolCall" ? result.content : item.contentItems;
  let image: string | null = null, imageState: BrowserToolView["imageState"] = "none", errorCode: string | null = null;
  let imageCount = 0;
  if (Array.isArray(blocks) && blocks.length <= 8) for (const block of blocks) {
    if (!object(block)) continue;
    if (block.type === "imageNotLoaded" && block.fullItemRequired === true) { imageState = "not-loaded"; imageCount++; }
    else if (block.type === "image" || block.type === "inputImage") {
      image = block.type === "image" ? browserTimelineImage(block.mimeType, block.data) : browserTimelineDataImage(block.imageUrl);
      imageState = image ? "ready" : "invalid"; imageCount++;
    } else if ((block.type === "text" || block.type === "inputText") && typeof block.text === "string" && block.text.length <= 65536) {
      try {
        const value: unknown = JSON.parse(block.text);
        const error = object(value) && object(value.error) ? value.error : null;
        if (typeof error?.code === "string" && ERRORS.has(error.code)) errorCode = error.code;
      } catch { /* Page text is not diagnostic output. */ }
    }
  }
  if (imageCount > 1 || (Array.isArray(blocks) && blocks.length > 8)) { image = null; imageState = "invalid"; }
  // Never render a base64 prefix carrying the generic compact marker.
  if (item.truncated === true && imageState === "ready") { image = null; imageState = "not-loaded"; }
  const running = item.status === "inProgress" || item.status === "running";
  const failed = item.success === false || result.isError === true || item.error != null || ["failed", "errored", "declined"].includes(String(item.status)) || errorCode !== null;
  return { tool: name, title, summary, state: running ? "running" : failed ? "failed" : "done", errorCode, image, imageState };
}

/** A late full-item response must never replace another item's row. */
export function browserLoadedToolItem(value: unknown, original: RawItem): RawItem | null {
  if (!object(value) || !object(value.item)) return null;
  const item = value.item;
  if (item.id !== original.id || typeof item.id !== "string" || item.type !== original.type || typeof item.type !== "string") return null;
  const candidate: RawItem = { ...item, id: item.id, type: item.type };
  const view = browserToolView(candidate);
  return view && view.tool === browserToolName(original) && view.imageState === "ready" ? candidate : null;
}

/** B10 metadata is scoped to this exact turn; a malformed batch is never partially displayed. */
export function browserTurnShots(value: unknown, turnId: string): BrowserTurnShot[] | null {
  if (!Array.isArray(value) || value.length > 256) return null;
  const ids = new Set<string>(), result: BrowserTurnShot[] = [];
  for (const shot of value) {
    if (!object(shot) || shot.turnId !== turnId || typeof shot.id !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(shot.id)
      || ids.has(shot.id) || (shot.mimeType !== "image/png" && shot.mimeType !== "image/jpeg")
      || typeof shot.createdAt !== "string" || shot.createdAt.length > 64 || !Number.isFinite(Date.parse(shot.createdAt))
      || typeof shot.width !== "number" || typeof shot.height !== "number" || !Number.isSafeInteger(shot.width) || !Number.isSafeInteger(shot.height)
      || shot.width < 1 || shot.height < 1 || shot.width > 1600 || shot.height > 1600) return null;
    ids.add(shot.id);
    result.push({ id: shot.id, turnId, createdAt: shot.createdAt, width: shot.width, height: shot.height, mimeType: shot.mimeType });
  }
  return result;
}
