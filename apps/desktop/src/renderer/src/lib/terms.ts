// Display terms (术语): the words the UI uses for "agent" and "director", configurable per language
// (Settings → 通用 → 术语; owner 2026-10-09: "用户爱叫啥叫啥"). UI text only — nothing the agents or
// the model see changes.
//
// i18n strings write a term as a placeholder, resolved before `{var}` substitution (i18n/index.tsx):
//
//   {{agent}}  {{agents}}          the term as stored (singular / plural)
//   {{Agent}}  {{Agents}}          same, first letter upper-cased (sentence start, titles)
//   {{an agent}}  {{An agent}}     en: with "a" / "an" picked for the word (zh: the bare term)
//   {{director}} … same set for the Director role
//   {{owner}} …    same set for the owner (the human the UI belongs to, as a party: 主人通知,
//                  等待主人, requester = owner); direct address stays 「你」 / "you"
//
// The stored form is the mid-sentence form: en defaults are "agent", "director" and "owner", all
// lower case (owner 2026-10-18: one rule, no capitalised role name; {{Director}} capitalises a sentence
// start). German keeps its capitalised nouns. zh has no plural or case: every form is the one word.
//   {{subagent}} …  a native sub-agent; unless set on its own it is derived from the agent term
//                  (「子」 + agent / "sub-" + agent), so a custom agent word can get a better sub word
//                  (owner 2026-10-12: Maid → not 「子Maid」). Never write 「子{{agent}}」 / "sub-{{agent}}".
//   {{parentagent}} …  the agent a sub-agent works for; its own term, never derived from the
//                  agent word (owner 2026-10-13: Maid → not 「父Maid」). Unset = the language's default.
// Unknown placeholders stay as they are (test/terms.test.ts catches typos).
import { useSyncExternalStore } from "react";
import { APP_LOCALES, type AppLocale } from "../../../shared/locales";

export type TermLocale = AppLocale;
export type TermId = "agent" | "subagent" | "parentagent" | "director" | "owner";
export const TERM_IDS: readonly TermId[] = ["agent", "subagent", "parentagent", "director", "owner"];
export const TERM_LOCALES: readonly TermLocale[] = APP_LOCALES;

/** One term in one language: singular and plural (zh: the same word). */
export interface TermForms {
  one: string;
  many: string;
}
export type TermSet = Record<TermId, TermForms>;

export const DEFAULT_TERMS: Record<TermLocale, TermSet> = {
  "zh-CN": { agent: { one: "智能体", many: "智能体" }, subagent: { one: "子智能体", many: "子智能体" }, parentagent: { one: "父智能体", many: "父智能体" }, director: { one: "主管", many: "主管" }, owner: { one: "主人", many: "主人" } },
  en: { agent: { one: "agent", many: "agents" }, subagent: { one: "subagent", many: "subagents" }, parentagent: { one: "parent agent", many: "parent agents" }, director: { one: "director", many: "directors" }, owner: { one: "owner", many: "owners" } },
  "zh-Hant-CN": { agent: { one: "智能體", many: "智能體" }, subagent: { one: "子智能體", many: "子智能體" }, parentagent: { one: "父智能體", many: "父智能體" }, director: { one: "主管", many: "主管" }, owner: { one: "主人", many: "主人" } },
  "en-AU": { agent: { one: "agent", many: "agents" }, subagent: { one: "subagent", many: "subagents" }, parentagent: { one: "parent agent", many: "parent agents" }, director: { one: "director", many: "directors" }, owner: { one: "owner", many: "owners" } },
  "ru-RU": { agent: { one: "агент", many: "агенты" }, subagent: { one: "субагент", many: "субагенты" }, parentagent: { one: "родительский агент", many: "родительские агенты" }, director: { one: "директор", many: "директоры" }, owner: { one: "владелец", many: "владельцы" } },
  "fr-FR": { agent: { one: "agent", many: "agents" }, subagent: { one: "sous-agent", many: "sous-agents" }, parentagent: { one: "agent parent", many: "agents parents" }, director: { one: "directeur", many: "directeurs" }, owner: { one: "propriétaire", many: "propriétaires" } },
  "es-ES": { agent: { one: "agente", many: "agentes" }, subagent: { one: "subagente", many: "subagentes" }, parentagent: { one: "agente padre", many: "agentes padre" }, director: { one: "director", many: "directores" }, owner: { one: "propietario", many: "propietarios" } },
  "pt-BR": { agent: { one: "agente", many: "agentes" }, subagent: { one: "subagente", many: "subagentes" }, parentagent: { one: "agente pai", many: "agentes pai" }, director: { one: "diretor", many: "diretores" }, owner: { one: "proprietário", many: "proprietários" } },
  "it-IT": { agent: { one: "agente", many: "agenti" }, subagent: { one: "sottoagente", many: "sottoagenti" }, parentagent: { one: "agente padre", many: "agenti padre" }, director: { one: "direttore", many: "direttori" }, owner: { one: "proprietario", many: "proprietari" } },
  "de-DE": { agent: { one: "Agent", many: "Agenten" }, subagent: { one: "Sub-Agent", many: "Sub-Agenten" }, parentagent: { one: "übergeordneter Agent", many: "übergeordnete Agenten" }, director: { one: "Leiter", many: "Leiter" }, owner: { one: "Besitzer", many: "Besitzer" } },
  "ja-JP": { agent: { one: "エージェント", many: "エージェント" }, subagent: { one: "サブエージェント", many: "サブエージェント" }, parentagent: { one: "親エージェント", many: "親エージェント" }, director: { one: "ディレクター", many: "ディレクター" }, owner: { one: "オーナー", many: "オーナー" } },
  "ko-KR": { agent: { one: "에이전트", many: "에이전트" }, subagent: { one: "하위 에이전트", many: "하위 에이전트" }, parentagent: { one: "상위 에이전트", many: "상위 에이전트" }, director: { one: "디렉터", many: "디렉터" }, owner: { one: "소유자", many: "소유자" } },
};

/** Saved overrides only (an absent or empty form = the default). */
export type TermOverrides = Partial<Record<TermLocale, Partial<Record<TermId, Partial<TermForms>>>>>;

/** Longest accepted term (a label, not a sentence). */
export const TERM_MAX = 24;

/** en plural of a custom singular when no plural is given (the plural field overrides it). */
export function autoPlural(one: string): string {
  if (/[^aeiou]y$/i.test(one)) return `${one.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(one)) return `${one}es`;
  return `${one}s`;
}

const isZhLocale = (locale: TermLocale) => locale === "zh-CN" || locale === "zh-Hant-CN";
const isEnLocale = (locale: TermLocale) => locale === "en" || locale === "en-AU";

/** The effective terms for a locale: overrides over defaults; en plural derived from a custom singular. */
export function resolveTerms(overrides: TermOverrides, locale: TermLocale): TermSet {
  const out = {} as TermSet;
  for (const id of TERM_IDS) {
    // TERM_IDS lists agent before subagent, so the derived sub word sees the resolved agent.
    const base = id === "subagent" ? subagentDefault(out.agent, locale) : DEFAULT_TERMS[locale][id];
    const o = overrides[locale]?.[id] ?? {};
    const one = clean(o.one) ?? base.one;
    // zh / ja have no plural; en derives one; the other languages reuse a custom singular as the
    // plural unless the plural field is set too (each default carries its own real plural).
    const many = clean(o.many) ?? (isEnLocale(locale) ? (clean(o.one) ? autoPlural(one) : base.many) : isZhLocale(locale) ? one : clean(o.one) ?? base.many);
    out[id] = { one, many };
  }
  return out;
}

/** The sub-agent prefix per language: 「子」智能体 / "sub-" agent / sous-agent / サブエージェント … */
const SUB_PREFIX: Record<TermLocale, string> = { "zh-CN": "子", "zh-Hant-CN": "子", en: "sub-", "en-AU": "sub-", "ru-RU": "суб-", "fr-FR": "sous-", "es-ES": "sub", "pt-BR": "sub", "it-IT": "sotto-", "de-DE": "Sub-", "ja-JP": "サブ", "ko-KR": "하위 " };

/**
 * The sub-agent word derived from the agent word: 「子」 + agent / "sub-" + agent / … The default agent
 * word gets the language's own default (en "subagent", owner 2026-10-18: no hyphen); a custom word
 * keeps the prefix so it stays readable ("sub-maid").
 */
export function subagentDefault(agent: TermForms, locale: TermLocale): TermForms {
  if (agent.one === DEFAULT_TERMS[locale].agent.one) return DEFAULT_TERMS[locale].subagent;
  const p = SUB_PREFIX[locale];
  return { one: `${p}${agent.one}`, many: `${p}${agent.many}` };
}

function clean(v: string | undefined): string | null {
  const s = v?.trim().slice(0, TERM_MAX);
  return s ? s : null;
}

const TOKEN = /\{\{(an? |An? )?([A-Za-z]+)\}\}/g;
const FORMS: Record<string, [TermId, keyof TermForms]> = { agent: ["agent", "one"], agents: ["agent", "many"], subagent: ["subagent", "one"], subagents: ["subagent", "many"], parentagent: ["parentagent", "one"], parentagents: ["parentagent", "many"], director: ["director", "one"], directors: ["director", "many"], owner: ["owner", "one"], owners: ["owner", "many"] };

const upperFirst = (s: string) => (s ? s[0]!.toLocaleUpperCase() + s.slice(1) : s);
const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

/** Replaces the `{{…}}` term placeholders of one i18n template. */
export function applyTerms(template: string, terms: TermSet, locale: TermLocale): string {
  if (!template.includes("{{")) return template;
  return template.replace(TOKEN, (whole, art: string | undefined, name: string) => {
    const form = FORMS[name.toLowerCase()];
    if (!form) return whole;
    const raw = terms[form[0]][form[1]];
    const word = name[0] === name[0]!.toUpperCase() ? upperFirst(raw) : raw;
    if (!art || !isEnLocale(locale)) return word;
    const a = article(word);
    return `${art[0] === "A" ? upperFirst(a) : a} ${word}`;
  });
}

/**
 * applyTerms in pieces: the words a placeholder became carry their term id, so a preview can mark them
 * (通用 → 术语). Joining the texts gives applyTerms' result.
 */
export function splitTerms(template: string, terms: TermSet, locale: TermLocale): (string | { id: TermId; text: string })[] {
  const out: (string | { id: TermId; text: string })[] = [];
  let last = 0;
  for (const m of template.matchAll(TOKEN)) {
    const form = FORMS[m[2]!.toLowerCase()];
    if (!form) continue;
    if (m.index > last) out.push(template.slice(last, m.index));
    out.push({ id: form[0], text: applyTerms(m[0], terms, locale) });
    last = m.index + m[0].length;
  }
  if (last < template.length) out.push(template.slice(last));
  return out;
}

/** Daemon-supplied Chinese text (cutex writes the default words: 智能体 / 子智能体 / 主管 / 主人) in
 *  the owner's terms. Other languages and default terms come back unchanged. */
export function retermDaemonText(text: string, terms: TermSet, locale: TermLocale): string {
  if (!isZhLocale(locale) || !text) return text;
  const defaults = DEFAULT_TERMS["zh-CN"];
  const ids: TermId[] = ["subagent", "agent", "director", "owner"];
  const swaps = ids.filter((id) => terms[id].one !== defaults[id].one);
  if (!swaps.length) return text;
  const pattern = new RegExp(ids.map((id) => defaults[id].one).join("|"), "g");
  return text.replace(pattern, (word) => {
    const id = ids.find((i) => defaults[i].one === word)!;
    return terms[id].one;
  });
}

/** Placeholder names a template uses that are not terms (for tests). */
export function unknownTermTokens(template: string): string[] {
  return [...template.matchAll(/\{\{([^}]*)\}\}/g)].map((m) => m[1]!).filter((body) => {
    const m = /^(an? |An? )?([A-Za-z]+)$/.exec(body);
    return !m || !FORMS[m[2]!.toLowerCase()];
  });
}

// ---- store (localStorage; desktop-local like the other UI prefs) ----

const KEY = "cutex-desktop.terms";
const listeners = new Set<() => void>();
let current: TermOverrides = load();

function load(): TermOverrides {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    return parseOverrides(raw);
  } catch {
    return {};
  }
}

/** Keeps only known locales / terms / forms with string values. */
export function parseOverrides(raw: unknown): TermOverrides {
  const out: TermOverrides = {};
  if (!raw || typeof raw !== "object") return out;
  for (const locale of TERM_LOCALES) {
    const byTerm = (raw as Record<string, unknown>)[locale];
    if (!byTerm || typeof byTerm !== "object") continue;
    for (const id of TERM_IDS) {
      const forms = (byTerm as Record<string, unknown>)[id];
      if (!forms || typeof forms !== "object") continue;
      for (const f of ["one", "many"] as const) {
        const v = (forms as Record<string, unknown>)[f];
        if (typeof v === "string" && v.trim()) ((out[locale] ??= {})[id] ??= {})[f] = v.trim().slice(0, TERM_MAX);
      }
    }
  }
  return out;
}

function save(next: TermOverrides): void {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // not persisted
  }
  for (const l of listeners) l();
}

/** Sets one form ("" = back to the default). */
export function setTerm(locale: TermLocale, id: TermId, form: keyof TermForms, value: string): void {
  const v = value.trim().slice(0, TERM_MAX);
  const forms: Partial<TermForms> = { ...current[locale]?.[id] };
  if (v) forms[form] = v;
  else delete forms[form];
  const byTerm = { ...current[locale], [id]: forms };
  if (!forms.one && !forms.many) delete byTerm[id];
  save({ ...current, [locale]: byTerm });
}

/** Clears both forms of a term in one language. */
export function resetTerm(locale: TermLocale, id: TermId): void {
  const byTerm = { ...current[locale] };
  delete byTerm[id];
  save({ ...current, [locale]: byTerm });
}

export function getTermOverrides(): TermOverrides {
  return current;
}

export function useTermOverrides(): TermOverrides {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    // Server snapshot (static rendering in tests): the same overrides.
    () => current,
  );
}
