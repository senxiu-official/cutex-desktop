// Browser-preview data for 输入优化 (module input-refinement): cutex text-rewrite-v1 (`POST /v2/text-rewrite`,
// shared/textRewrite.ts) and text-rewrite-v2 (templates + `POST /v2/text-rewrite/structured`, shared/textRewriteV2.ts,
// runtime-isolation-study docs/text-rewrite-v2.md). SYNTHETIC answers, no model involved.
//   default            v2 host: built-ins 提示词增强 / 纠错学习 and one owner template; ~0.9 s answers
//   ?ir=v1             an older cutex with text-rewrite-v1 only (提示词增强, this desktop's route)
//   ?ir=off            neither (the module shows nothing in the input box)
//   ?rewrite=fallback  success after the first Profile ran out of quota (fallbackUsed)
//   ?rewrite=fail      every Profile tried fails (quota used up / signed out) → per-Profile reasons
//   ?rewrite=slow      8 s, to try Esc (cancel)
//   ?ir=full           a v2 host already holding 32 owner templates (creating one more is refused: rewrite_template_capacity)
//   ?ir=r298           an global-routing host (text-rewrite-global-route): one built-in 语法纠错 (follows the global order), 提示词增强 and
//                      纠错学习 migrated as owner templates (the first follows, the second has its own route), a global
//                      order (`/v2/text-rewrite/route`) and `routeOverride` on every template; 语法纠错 leaves one reason
//                      empty; ?rewrite=fail reports a timeout with elapsedMs.
// 纠错学习 on 「je pense que je pouvais …」: pouvais → pourrais with a wider 取决于你的意思 (「je pensais que je pouvais」
// replaces the whole clause and leaves out the change inside it) and droppedCorrections 1 (one change cutex left out).
// Every structured answer carries a fresh `protection` blob (cutex r297); a 重新整理 must send back one this mock issued
// (an unknown one, or none at all, is refused as invalid_rewrite_request: this mock is a host that issues protection).
// The agent's own Profile is the mock's default Profile (omega). Template checks follow the contract (built-ins
// accept only a route PATCH, null restoring the default — both built-ins default to following the agent —, kind fixed at creation, at most four distinct candidates).
import { TEXT_REWRITE_FEATURE, utf8Bytes, type TextRewriteRequest, type TextRewriteResult, type TextRewriteUsed } from "../../../../shared/textRewrite";
import {
  BUILTIN_CORRECTION_TEMPLATE, BUILTIN_ENHANCE_TEMPLATE, BUILTIN_GRAMMAR_TEMPLATE, REWRITE_TEMPLATE_MAX_CUSTOM, TEXT_REWRITE_GLOBAL_ROUTE_FEATURE, rewriteGlobalRouteBody, REWRITE_TEMPLATE_NAME_MAX, REWRITE_TEMPLATE_PROMPT_MAX_BYTES, TEXT_REWRITE_V2_FEATURE,
  rewriteTemplateCreateBody, rewriteTemplatePatchBody,
  type RewriteCorrection, type RewriteTemplate, type RewriteTemplateCreate, type RewriteTemplatePatch, type RewriteTemplateRoute,
  type StructuredRewriteRequest, type StructuredRewriteResult,
} from "../../../../shared/textRewriteV2";
import type { ModuleMock } from "../../dev/mockTypes";

const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
const HOST = params.get("ir") ?? "";
/** r298: templates keep `routeOverride`; `route` is that or the global order. */
const R298 = HOST === "r298";
const scenario = () => params.get("rewrite") ?? "";
const OWN_PROFILE = "omega";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const pending = new Map<string, () => void>();

// ── Templates (per host) ─────────────────────────────────────────────────────────────────────────

const AGENT: RewriteTemplateRoute = { mode: "agent", model: null, fallback: [] };
const ENHANCE_PROMPT = "Rewrite the user's draft as a clearer, more complete prompt for a coding agent. Keep every fact and intent. Then list what the draft could still say.";
const CORRECTION_PROMPT = "Correct grammar, spelling and word choice in non-Chinese text. Explain each change in one line in the UI language. Leave Chinese, code, links, paths and mentions unchanged.";

const GRAMMAR_PROMPT = "Fix grammar, spelling, typos, punctuation and clearly wrong wording in the original language of each passage. Change as little as possible. Keep code, links, paths and mentions.";

function seed(): RewriteTemplate[] {
  if (R298) {
    return [
      { id: BUILTIN_GRAMMAR_TEMPLATE, builtIn: true, kind: "correction", name: "语法纠错", prompt: GRAMMAR_PROMPT, route: AGENT, routeOverride: null },
      { id: BUILTIN_ENHANCE_TEMPLATE, builtIn: false, kind: "enhance", name: "提示词增强", prompt: ENHANCE_PROMPT, route: AGENT, routeOverride: null },
      { id: BUILTIN_CORRECTION_TEMPLATE, builtIn: false, kind: "correction", name: "纠错学习", prompt: CORRECTION_PROMPT, route: AGENT, routeOverride: { mode: "profiles", candidates: [{ kind: "featureProfile", profileId: "fp-9e8d7c6b-5a49-4382-a716-5f4e3d2c1b0a" }] } },
      { id: "tpl-0b1c2d3e", builtIn: false, kind: "enhance", name: "英文邮件（我改的）", prompt: "Rewrite the user's draft as a clear, polite English email. Keep every fact. Do not add commitments the user did not make. Then list what the email could still say.", route: AGENT, routeOverride: { mode: "profiles", candidates: [{ kind: "featureProfile", profileId: "fp-1a2b3c4d-5e6f-4a1b-9c2d-0e1f2a3b4c5d", model: "gpt-6.2-mini" }] } },
    ];
  }
  return [
    { id: BUILTIN_ENHANCE_TEMPLATE, builtIn: true, kind: "enhance", name: "提示词增强", prompt: ENHANCE_PROMPT, route: AGENT },
    { id: BUILTIN_CORRECTION_TEMPLATE, builtIn: true, kind: "correction", name: "纠错学习", prompt: CORRECTION_PROMPT, route: { mode: "profiles", candidates: [{ kind: "featureProfile", profileId: "fp-9e8d7c6b-5a49-4382-a716-5f4e3d2c1b0a" }] } },
    { id: "tpl-0b1c2d3e", builtIn: false, kind: "enhance", name: "英文邮件（我改的）", prompt: "Rewrite the user's draft as a clear, polite English email. Keep every fact. Do not add commitments the user did not make. Then list what the email could still say.", route: { mode: "profiles", candidates: [{ kind: "featureProfile", profileId: "fp-1a2b3c4d-5e6f-4a1b-9c2d-0e1f2a3b4c5d", model: "gpt-6.2-mini" }] } },
  ];
}
const stores = new Map<string, RewriteTemplate[]>();
/** r298: the global order per host (starts at follow the agent, no backups). */
const globals = new Map<string, RewriteTemplateRoute>();
const globalOf = (hostId: string) => globals.get(hostId) ?? AGENT;
/** What the host returns: r298 fills in the effective route; older hosts have no routeOverride. */
const view = (hostId: string, t: RewriteTemplate): RewriteTemplate => structuredClone(R298 ? { ...t, route: t.routeOverride ?? globalOf(hostId) } : t);
/** r298: the two migrated templates have their own slots (not counted against the 32). */
const counted = (t: RewriteTemplate) => !t.builtIn && !(R298 && (t.id === BUILTIN_ENHANCE_TEMPLATE || t.id === BUILTIN_CORRECTION_TEMPLATE));
const storeOf = (hostId: string) => {
  let s = stores.get(hostId);
  if (!s) {
    s = seed();
    if (HOST === "full") for (let i = s.filter((t) => !t.builtIn).length; i < REWRITE_TEMPLATE_MAX_CUSTOM; i++) s.push({ ...s[2]!, id: `tpl-fill-${i}`, name: `旧模板 ${i}` });
    stores.set(hostId, s);
  }
  return s;
};
let serial = 0;

function refuse(status: number, code: string): never {
  throw new Error(`${status} ${code}: ${code.replace(/_/g, " ")}`);
}

/** cutex r297: a supplied name ≤ 64 characters, a prompt ≤ 16 KiB of UTF-8, each refused with its own code. */
function limits(input: { name?: unknown; prompt?: unknown }) {
  if (typeof input.name === "string" && [...input.name].length > REWRITE_TEMPLATE_NAME_MAX) refuse(400, "rewrite_template_name_too_long");
  if (typeof input.prompt === "string" && utf8Bytes(input.prompt) > REWRITE_TEMPLATE_PROMPT_MAX_BYTES) refuse(400, "rewrite_template_prompt_too_long");
}

// ── Answers ──────────────────────────────────────────────────────────────────────────────────────

function enhanced(text: string): string {
  return `目标：${text.trim()}\n\n要求：\n- 先列出要改的文件和改动范围，再动手\n- 不改无关代码；保留现有行为\n- 完成后运行相关测试，汇报通过与失败的数量`;
}

/** 纠错学习 on a French sample: pouvais → pourrais (mood, depends on the meaning), vite → rapidement (word choice). */
function corrections(text: string): RewriteCorrection[] {
  const out: RewriteCorrection[] = [];
  const add = (word: string, replacement: string, c: Omit<RewriteCorrection, "start" | "end" | "original" | "replacement">) => {
    const at = text.search(new RegExp(`\\b${word}\\b`));
    if (at >= 0) out.push({ start: at, end: at + word.length, original: word, replacement, ...c });
  };
  const clause = text.search(/\bje pense que je pouvais\b/);
  add("pouvais", "pourrais", {
    category: "mood", explanation: "说「以后能做到」时用条件式 pourrais；pouvais 是未完成过去时，说的是「过去能」。", language: "fr",
    alternatives: [
      { replacement: "pouvais", when: "如果指过去具备的能力" },
      ...(clause >= 0 ? [{ replacement: "je pensais que je pouvais", when: "如果连当时的想法也发生在过去", span: { start: clause, end: clause + 23, original: "je pense que je pouvais" } }] : []),
    ],
  });
  add("vite", "rapidement", { category: "wordChoice", explanation: "两个都对；书面语里 rapidement 更自然，口语用 vite 也可以。", language: "fr", alternatives: [] });
  add("recieve", "receive", { category: "spelling", explanation: "i 在 e 前面，c 后面例外：receive。", language: "en", alternatives: [] });
  add("informations", "information", { category: "agreement", explanation: "information 在英语里不可数，没有复数。", language: "en", alternatives: [] });
  return out.sort((a, b) => a.start - b.start);
}

function applied(text: string, cs: readonly RewriteCorrection[]): string {
  let out = "";
  let at = 0;
  for (const c of cs) { out += text.slice(at, c.start) + c.replacement; at = c.end; }
  return out + text.slice(at);
}

function candidatesOf(route: RewriteTemplateRoute): string[] {
  return route.mode === "profiles" ? route.candidates.map((c) => c.profileId) : [OWN_PROFILE, ...route.fallback.map((c) => c.profileId)];
}

function used(tried: string[], fallback: boolean, model?: string | null): TextRewriteUsed {
  const profileId = fallback ? tried[1]! : tried[0]!;
  const claude = /claude|9e8d/i.test(profileId);
  const m = model ?? (claude ? "claude-haiku-5-5" : "gpt-6.2");
  return { profileId, provider: claude ? "anthropic" : "openai", model: m, requestedModel: m, fallbackUsed: fallback };
}

function later<T extends { ok: boolean }>(requestId: string, answer: () => T, cancelled: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pending.delete(requestId); resolve(answer()); }, scenario() === "slow" ? 8000 : 900);
    pending.set(requestId, () => { clearTimeout(timer); pending.delete(requestId); resolve(cancelled); });
  });
}

function v1Rewrite(request: TextRewriteRequest): Promise<TextRewriteResult> {
  const r = request.route;
  const tried = r.mode === "profile" ? r.profileIds : r.mode === "featureProfiles" ? r.featureProfileIds : [OWN_PROFILE, ...(r.fallbackFeatureProfileIds ?? r.fallbackProfileIds ?? [])];
  return later(request.requestId, (): TextRewriteResult => {
    if (scenario() === "fail") return { ok: false, code: "rewrite_failed", attempts: tried.slice(0, 2).map((profileId, i) => ({ profileId, category: i === 0 ? "quota_exhausted" : "authentication" })) };
    return { ok: true, rewrittenText: enhanced(request.text), missingDetails: ["要改的是哪个模块或页面？", "完成的标准：只要测试通过，还是也要截图？"], used: used(tried, scenario() === "fallback" && tried.length > 1) };
  }, { ok: false, code: "cancelled", attempts: [] });
}

/** Protection blobs this mock handed out (by their serialised form): a follow-up must bring one of them back. */
const issued = new Set<string>();
function protection(request: StructuredRewriteRequest) {
  const p = { literals: [`mock-literal-${++serial}`, ...(request.text.match(/https?:\/\/\S+/g) ?? [])], retained: [0] };
  issued.add(JSON.stringify(p));
  return p;
}

function structured(hostId: string, request: StructuredRewriteRequest): Promise<StructuredRewriteResult> {
  const template = storeOf(hostId).find((t) => t.id === request.templateId);
  if (!template) return Promise.resolve({ ok: false, code: "rewrite_template_not_found", attempts: [] });
  if (request.protection && !(request.followUp && issued.has(JSON.stringify(request.protection)))) {
    console.warn("[mock] structured: protection that this mock never issued (or without a follow-up)");
    return Promise.resolve({ ok: false, code: "invalid_rewrite_request", attempts: [] });
  }
  if (request.followUp && !request.protection) {
    console.warn("[mock] structured: follow-up without protection on a host that issues it");
    return Promise.resolve({ ok: false, code: "invalid_rewrite_request", attempts: [] });
  }
  const tried = candidatesOf(view(hostId, template).route);
  const first = template.route.mode === "profiles" ? template.route.candidates[0]?.model : null;
  return later(request.requestId, (): StructuredRewriteResult => {
    if (scenario() === "fail") {
      return { ok: false, code: "rewrite_failed", attempts: R298
        ? [{ profileId: tried[0]!, category: "timeout", elapsedMs: 24_000 }, ...tried.slice(1, 2).map((profileId) => ({ profileId, category: "quota_exhausted" as const }))]
        : tried.slice(0, 2).map((profileId, i) => ({ profileId, category: i === 0 ? "quota_exhausted" : "authentication" })) };
    }
    const u = used(tried, scenario() === "fallback" && tried.length > 1, first);
    if (template.kind === "correction") {
      // 语法纠错 (r298): minimal fixes; a reason may come back empty.
      const cs = corrections(request.text).map((c) => (template.id === BUILTIN_GRAMMAR_TEMPLATE && c.category === "wordChoice" ? { ...c, explanation: "", alternatives: [] } : c));
      return { ok: true, text: applied(request.text, cs), suggestions: [], corrections: cs, used: u, ...(cs.length ? { droppedCorrections: 1 } : {}), protection: protection(request) };
    }
    if (request.followUp) {
      // 重新整理: the previous text with the answers worked in (a fresh result with its own suggestion IDs).
      const byId = new Map(request.followUp.previous.suggestions.map((s) => [s.id, s.text]));
      const lines = request.followUp.answers.map((a) => (a.text ? `- ${byId.get(a.id)}：${a.text}` : `- ${byId.get(a.id)}`));
      return { ok: true, text: `${request.followUp.previous.text}\n\n已确认：\n${lines.join("\n")}`, suggestions: [{ id: `s${++serial}`, text: "要不要在完成后附上改动的文件列表？", needsInput: false }], corrections: [], used: u, protection: protection(request) };
    }
    return {
      ok: true,
      text: enhanced(request.text),
      suggestions: [
        { id: `s${++serial}`, text: "说明 bug 出现在哪个页面或命令", needsInput: false },
        { id: `s${++serial}`, text: "报错信息或复现步骤", needsInput: true },
        { id: `s${++serial}`, text: "修完是否需要跑全量测试", needsInput: true },
      ],
      corrections: [],
      used: u,
      protection: protection(request),
    };
  }, { ok: false, code: "cancelled", attempts: [] });
}

function api(hostId: string) {
  const v1 = HOST !== "off";
  const v2 = HOST === "" || HOST === "full" || R298;
  return {
    async textRewrite(request: TextRewriteRequest) {
      if (!v1) refuse(404, "route_not_found");
      return v1Rewrite(request);
    },
    cancelTextRewrite(requestId: string) {
      pending.get(requestId)?.();
    },
    async structuredTextRewrite(request: StructuredRewriteRequest) {
      if (!v2) return { ok: false, code: "unsupported", attempts: [] } satisfies StructuredRewriteResult;
      return structured(hostId, request);
    },
    async textRewriteTemplates() {
      if (!v2) refuse(404, "route_not_found");
      await wait(200);
      return storeOf(hostId).map((t) => view(hostId, t));
    },
    async textRewriteRoute() {
      if (!R298) refuse(404, "route_not_found");
      await wait(150);
      return structuredClone(globalOf(hostId));
    },
    async patchTextRewriteRoute(route: RewriteTemplateRoute) {
      if (!R298) refuse(404, "route_not_found");
      await wait(300);
      let body: { route: RewriteTemplateRoute };
      try { body = rewriteGlobalRouteBody(route); } catch { refuse(422, "invalid_rewrite_route"); }
      globals.set(hostId, body.route);
      console.info("[mock] PATCH /v2/text-rewrite/route", body.route.mode);
      return structuredClone(body.route);
    },
    async createTextRewriteTemplate(input: RewriteTemplateCreate) {
      await wait(300);
      limits(input);
      if (storeOf(hostId).filter(counted).length >= REWRITE_TEMPLATE_MAX_CUSTOM) refuse(409, "rewrite_template_capacity");
      let body: RewriteTemplateCreate;
      try { body = rewriteTemplateCreateBody(input); } catch { refuse(400, "invalid_rewrite_request"); }
      const route = body.route ?? null;
      if (!route && !R298) refuse(400, "invalid_rewrite_request"); // r297 hosts need a route
      const t: RewriteTemplate = { id: `tpl-${Date.now().toString(16)}${++serial}`, builtIn: false, kind: body.kind, name: body.name, prompt: body.prompt, route: route ?? AGENT, ...(R298 ? { routeOverride: route } : {}) };
      storeOf(hostId).push(t);
      console.info("[mock] POST /v2/text-rewrite/templates", t.id, t.kind);
      return view(hostId, t);
    },
    async patchTextRewriteTemplate(id: string, patch: RewriteTemplatePatch) {
      await wait(300);
      const s = storeOf(hostId);
      const i = s.findIndex((t) => t.id === id);
      if (i < 0) refuse(404, "rewrite_template_not_found");
      limits(patch);
      let body: RewriteTemplatePatch;
      try { body = rewriteTemplatePatchBody(patch); } catch { refuse(400, "invalid_rewrite_request"); }
      const cur = s[i]!;
      if (cur.builtIn && (body.name !== undefined || body.prompt !== undefined)) refuse(409, "rewrite_template_read_only");
      const named = { ...(body.name !== undefined ? { name: body.name } : {}), ...(body.prompt !== undefined ? { prompt: body.prompt } : {}) };
      if (R298) {
        // null = follow the global order; omitted = keep the current override.
        const routeOverride = body.route === undefined ? (cur.routeOverride ?? null) : body.route;
        s[i] = { ...cur, ...named, routeOverride, route: routeOverride ?? AGENT };
      } else {
        const route = body.route === null ? (cur.builtIn ? AGENT : refuse(400, "invalid_rewrite_request")) : body.route ?? cur.route;
        s[i] = { ...cur, ...named, route };
      }
      console.info("[mock] PATCH /v2/text-rewrite/templates", id, Object.keys(body));
      return view(hostId, s[i]!);
    },
    async deleteTextRewriteTemplate(id: string) {
      await wait(300);
      const s = storeOf(hostId);
      const i = s.findIndex((t) => t.id === id);
      if (i < 0) refuse(404, "rewrite_template_not_found");
      if (s[i]!.builtIn) refuse(409, "rewrite_template_read_only");
      s.splice(i, 1);
    },
  };
}

export const mock: ModuleMock = {
  // cutex r297: a v1 host reports text-rewrite-v1 only; a v2 host reports both.
  features: { new: HOST === "off" ? [] : HOST === "v1" ? [TEXT_REWRITE_FEATURE] : R298 ? [TEXT_REWRITE_FEATURE, TEXT_REWRITE_V2_FEATURE, TEXT_REWRITE_GLOBAL_ROUTE_FEATURE] : [TEXT_REWRITE_FEATURE, TEXT_REWRITE_V2_FEATURE] },
  api: () => api("local"),
  remote: (hostId) => api(hostId),
};
