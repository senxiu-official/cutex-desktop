// Browser-preview data for Settings → 功能 Profile (`/v2/feature-profiles`, shapes in shared/featureProfiles.ts) and the
// 提示词增强 picker. This machine: two rows (one OpenAI Responses, one Anthropic Messages); another host: its own list.
// `?fp=many` nine rows (the 全部 N sub-page), `?fp=empty` none, `?fp=off` an older cutex without the capability
// (rollback: the page hides, 提示词增强 follows the agent only), `?fp=fail` every save refused like cutex, `?fp=damaged` one unreadable record (list `errors`).
// Keys are never stored here beyond "present"; nothing is ever echoed.
import {
  FEATURE_PROFILE_LIMIT, FEATURE_PROFILE_PROTOCOLS, FEATURE_PROFILE_QUOTA_TYPES, FEATURE_PROFILES_FEATURE,
  parseFeatureProfileList, type FeatureProfile, type FeatureProfileCreate, type FeatureProfilePatch,
} from "../../../../shared/featureProfiles";
import type { ModuleMock } from "../../dev/mockTypes";

const SCENE = new URLSearchParams(typeof location === "undefined" ? "" : location.search).get("fp");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let serial = 0;
const newId = () => `fp-${(Date.now() + serial++).toString(16).padStart(12, "0")}-4c1d-9e2a-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`;

const row = (id: string, name: string, protocol: FeatureProfile["protocol"], baseUrl: string, model: string, quotaType: FeatureProfile["quotaType"]): FeatureProfile =>
  ({ id, name, protocol, baseUrl, model, quotaType, keyPresent: true });

function seed(hostId: string): FeatureProfile[] {
  if (SCENE === "empty") return [];
  if (hostId !== "local") return [row("fp-7f3e0a91-0b2c-4d5e-8f60-112233445566", "工作站小模型", "openaiResponses", "https://relay.example.net/v1", "gpt-6.2-mini", "periodicAllowance")];
  const base = [
    row("fp-1a2b3c4d-5e6f-4a1b-9c2d-0e1f2a3b4c5d", "便宜的小模型", "openaiResponses", "https://api.openai.com/v1", "gpt-6.2-mini", "payAsYouGo"),
    row("fp-9e8d7c6b-5a49-4382-a716-5f4e3d2c1b0a", "Haiku 改写", "anthropicMessages", "https://api.anthropic.com", "claude-haiku-5-5", "balance"),
  ];
  if (SCENE !== "many") return base;
  const extra = ["DeepSeek 兼容", "本机 Ollama", "OpenRouter", "公司网关", "Kimi 兼容", "备用 OpenAI", "测试用"].map((name, i) =>
    row(`fp-00000000-0000-4000-8000-00000000000${i}`, name, i % 2 ? "anthropicMessages" : "openaiResponses", i === 1 ? "http://127.0.0.1:11434/v1" : `https://gw${i}.example.com/v1`, i % 2 ? "claude-haiku-5-5" : "gpt-6.2-mini", FEATURE_PROFILE_QUOTA_TYPES[i % 4]!));
  return [...base, ...extra];
}

const stores = new Map<string, FeatureProfile[]>();
const DAMAGED_ID = "fp-5d4c3b2a-1908-4f7e-8d6c-5b4a39281706";
const deleted = new Set<string>();
const storeOf = (hostId: string) => { let s = stores.get(hostId); if (!s) { s = seed(hostId); stores.set(hostId, s); } return s; };

/** Names by ID on this machine (the mock 提示词增强 answer names the Feature Profile it used). */
export const mockFeatureProfileName = (id: string) => storeOf("local").find((p) => p.id === id)?.name ?? null;

function refuse(code: string, message: string): never {
  throw new Error(`${code === "feature_profile_not_found" ? 404 : code === "feature_profile_limit" ? 409 : 400} ${code}: ${message}`);
}

/** cutex's checks (src/management/v2/feature_profiles.rs clean). */
function check(p: Omit<FeatureProfile, "id" | "keyPresent">, key: string | undefined): void {
  if (SCENE === "fail") refuse("invalid_feature_profile", "invalid feature profile");
  const okUrl = /^https:\/\/[^\s/]+/i.test(p.baseUrl) || /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i.test(p.baseUrl);
  // cutex refuses its own Management / Agent Bus ports (generic invalid code).
  if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]):(24270|24260|25370|25360)(\/|$)/i.test(p.baseUrl)) refuse("invalid_feature_profile", "invalid feature profile");
  if (!p.name.trim() || p.name.length > 64 || !p.model.trim() || /\s/.test(p.model) || !okUrl
    || !(FEATURE_PROFILE_PROTOCOLS as readonly string[]).includes(p.protocol) || !(FEATURE_PROFILE_QUOTA_TYPES as readonly string[]).includes(p.quotaType)
    || (key !== undefined && !key.trim())) refuse("invalid_feature_profile", "invalid feature profile");
}

function api(hostId: string) {
  return {
    async featureProfiles() {
      await wait(250);
      // ?fp=damaged: one record the host can't read (list `errors`).
      const errors = SCENE === "damaged" && !deleted.has(DAMAGED_ID) ? [{ id: DAMAGED_ID, code: "invalid_feature_profile_record" }] : [];
      return parseFeatureProfileList({ contractVersion: 2, profiles: structuredClone(storeOf(hostId)), errors });
    },
    async createFeatureProfile(input: FeatureProfileCreate) {
      await wait(400);
      const s = storeOf(hostId);
      if (s.length >= FEATURE_PROFILE_LIMIT) refuse("feature_profile_limit", "too many feature profiles");
      const { apiKey, ...meta } = input;
      check(meta, apiKey);
      const p: FeatureProfile = { id: newId(), ...meta, keyPresent: true };
      s.push(p);
      console.info("[mock] POST /v2/feature-profiles", { ...meta, apiKey: "(written)" });
      return structuredClone(p);
    },
    async patchFeatureProfile(id: string, patch: FeatureProfilePatch) {
      await wait(400);
      const s = storeOf(hostId);
      const i = s.findIndex((p) => p.id === id);
      if (i < 0) refuse("feature_profile_not_found", "feature profile not found");
      const { apiKey, ...meta } = patch;
      const next = { ...s[i]!, ...meta };
      check(next, apiKey);
      s[i] = { ...next, keyPresent: true };
      console.info("[mock] PATCH /v2/feature-profiles", id, { ...meta, ...(apiKey !== undefined ? { apiKey: "(replaced)" } : {}) });
      return structuredClone(s[i]!);
    },
    async deleteFeatureProfile(id: string) {
      await wait(300);
      const s = storeOf(hostId);
      if (SCENE === "damaged" && id === DAMAGED_ID && !deleted.has(id)) { deleted.add(id); return; }
      const i = s.findIndex((p) => p.id === id);
      if (i < 0) refuse("feature_profile_not_found", "feature profile not found");
      s.splice(i, 1);
    },
  };
}

export const mock: ModuleMock = {
  features: { new: SCENE === "off" ? [] : [FEATURE_PROFILES_FEATURE] },
  api: () => api("local"),
  remote: (hostId) => api(hostId),
};
