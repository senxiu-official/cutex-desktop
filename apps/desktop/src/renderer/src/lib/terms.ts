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
//   {{shelf}} {{shelves}} {{Shelf}} …  the container left / right of the conversations (canvas principles
//                  §6, owner 2026-10-20: "Shelf", untranslated in every language, plural the same word;
//                  renamable like the others; the wording presets leave it as it is — lib/termPresets).
// Unknown placeholders stay as they are (test/terms.test.ts catches typos).
import { useSyncExternalStore } from "react";
import { APP_LOCALES, type AppLocale } from "../../../shared/locales";
import { migrateMaidTerms } from "./termPresetMigration";

export type TermLocale = AppLocale;
export type TermId = "agent" | "subagent" | "parentagent" | "director" | "operator" | "owner" | "shelf";
export const TERM_IDS: readonly TermId[] = ["agent", "subagent", "parentagent", "director", "operator", "owner", "shelf"];

/** The Shelf's word: the same in every language until the owner names it (canvas principles §6). */
const SHELF: TermForms = { one: "Shelf", many: "Shelf" };
export const TERM_LOCALES: readonly TermLocale[] = APP_LOCALES;

/** One term in one language: singular and plural (zh: the same word). */
export interface TermForms {
  one: string;
  many: string;
}
export type TermSet = Record<TermId, TermForms>;

const TW_TERMS: TermSet = {
  agent: { one: "智慧體", many: "智慧體" }, subagent: { one: "子智慧體", many: "子智慧體" },
  parentagent: { one: "父智慧體", many: "父智慧體" }, director: { one: "主管", many: "主管" },
  operator: { one: "副主管", many: "副主管" }, owner: { one: "主人", many: "主人" }, shelf: SHELF,
};
const HK_TERMS: TermSet = { ...TW_TERMS, agent: { one: "智能體", many: "智能體" },
  subagent: { one: "子智能體", many: "子智能體" }, parentagent: { one: "父智能體", many: "父智能體" } };

export const DEFAULT_TERMS: Record<TermLocale, TermSet> = {
  "zh-Hant-TW": TW_TERMS,
  "zh-Hant-HK": HK_TERMS,
  "zh-Hant-MO": { ...HK_TERMS },
  "zh-CN": { agent: { one: "智能体", many: "智能体" }, subagent: { one: "子智能体", many: "子智能体" }, parentagent: { one: "父智能体", many: "父智能体" }, director: { one: "主管", many: "主管" }, operator: { one: "副主管", many: "副主管" }, owner: { one: "主人", many: "主人" }, shelf: SHELF },
  en: { agent: { one: "agent", many: "agents" }, subagent: { one: "subagent", many: "subagents" }, parentagent: { one: "parent agent", many: "parent agents" }, director: { one: "director", many: "directors" }, operator: { one: "operator", many: "operators" }, owner: { one: "owner", many: "owners" }, shelf: SHELF },
  "zh-Hant-CN": { agent: { one: "智能體", many: "智能體" }, subagent: { one: "子智能體", many: "子智能體" }, parentagent: { one: "父智能體", many: "父智能體" }, director: { one: "主管", many: "主管" }, operator: { one: "副主管", many: "副主管" }, owner: { one: "主人", many: "主人" }, shelf: SHELF },
  "en-AU": { agent: { one: "agent", many: "agents" }, subagent: { one: "subagent", many: "subagents" }, parentagent: { one: "parent agent", many: "parent agents" }, director: { one: "director", many: "directors" }, operator: { one: "operator", many: "operators" }, owner: { one: "owner", many: "owners" }, shelf: SHELF },
  "ru-RU": { agent: { one: "агент", many: "агенты" }, subagent: { one: "субагент", many: "субагенты" }, parentagent: { one: "родительский агент", many: "родительские агенты" }, director: { one: "директор", many: "директоры" }, operator: { one: "заместитель директора", many: "заместители директора" }, owner: { one: "владелец", many: "владельцы" }, shelf: SHELF },
  "fr-FR": { agent: { one: "agent", many: "agents" }, subagent: { one: "sous-agent", many: "sous-agents" }, parentagent: { one: "agent parent", many: "agents parents" }, director: { one: "directeur", many: "directeurs" }, operator: { one: "directeur adjoint", many: "directeurs adjoints" }, owner: { one: "propriétaire", many: "propriétaires" }, shelf: SHELF },
  "es-ES": { agent: { one: "agente", many: "agentes" }, subagent: { one: "subagente", many: "subagentes" }, parentagent: { one: "agente padre", many: "agentes padre" }, director: { one: "director", many: "directores" }, operator: { one: "director adjunto", many: "directores adjuntos" }, owner: { one: "propietario", many: "propietarios" }, shelf: SHELF },
  "pt-BR": { agent: { one: "agente", many: "agentes" }, subagent: { one: "subagente", many: "subagentes" }, parentagent: { one: "agente pai", many: "agentes pai" }, director: { one: "diretor", many: "diretores" }, operator: { one: "diretor adjunto", many: "diretores adjuntos" }, owner: { one: "proprietário", many: "proprietários" }, shelf: SHELF },
  "it-IT": { agent: { one: "agente", many: "agenti" }, subagent: { one: "sottoagente", many: "sottoagenti" }, parentagent: { one: "agente padre", many: "agenti padre" }, director: { one: "direttore", many: "direttori" }, operator: { one: "vicedirettore", many: "vicedirettori" }, owner: { one: "proprietario", many: "proprietari" }, shelf: SHELF },
  "de-DE": { agent: { one: "Agent", many: "Agenten" }, subagent: { one: "Sub-Agent", many: "Sub-Agenten" }, parentagent: { one: "übergeordneter Agent", many: "übergeordnete Agenten" }, director: { one: "Leiter", many: "Leiter" }, operator: { one: "stellvertretender Leiter", many: "stellvertretende Leiter" }, owner: { one: "Besitzer", many: "Besitzer" }, shelf: SHELF },
  "ja-JP": { agent: { one: "エージェント", many: "エージェント" }, subagent: { one: "サブエージェント", many: "サブエージェント" }, parentagent: { one: "親エージェント", many: "親エージェント" }, director: { one: "ディレクター", many: "ディレクター" }, operator: { one: "副ディレクター", many: "副ディレクター" }, owner: { one: "オーナー", many: "オーナー" }, shelf: SHELF },
  "ko-KR": { agent: { one: "에이전트", many: "에이전트" }, subagent: { one: "하위 에이전트", many: "하위 에이전트" }, parentagent: { one: "상위 에이전트", many: "상위 에이전트" }, director: { one: "디렉터", many: "디렉터" }, operator: { one: "부디렉터", many: "부디렉터" }, owner: { one: "소유자", many: "소유자" }, shelf: SHELF },
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
const SUB_PREFIX: Record<TermLocale, string> = { "zh-CN": "子", "zh-Hant-CN": "子", "zh-Hant-TW": "子", "zh-Hant-HK": "子", "zh-Hant-MO": "子", en: "sub-", "en-AU": "sub-", "ru-RU": "суб-", "fr-FR": "sous-", "es-ES": "sub", "pt-BR": "sub", "it-IT": "sotto-", "de-DE": "Sub-", "ja-JP": "サブ", "ko-KR": "하위 " };

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
const FORMS: Record<string, [TermId, keyof TermForms]> = { agent: ["agent", "one"], agents: ["agent", "many"], subagent: ["subagent", "one"], subagents: ["subagent", "many"], parentagent: ["parentagent", "one"], parentagents: ["parentagent", "many"], director: ["director", "one"], directors: ["director", "many"], operator: ["operator", "one"], operators: ["operator", "many"], owner: ["owner", "one"], owners: ["owner", "many"], shelf: ["shelf", "one"], shelves: ["shelf", "many"] };

const upperFirst = (s: string) => (s ? s[0]!.toLocaleUpperCase() + s.slice(1) : s);
const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

/** Replaces the `{{…}}` term placeholders of one i18n template. */
/** Han / kana: a Latin term next to one gets a space in Chinese text (owner 2026-10-26: 「是 Chief Maid」, not 「是Chief Maid」). */
const CJK = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff]/;
const LATIN = /[A-Za-z0-9]/;

/** `word` as it sits between `before` and `after` in Chinese text: a space wherever a Latin edge meets Han. */
export function spacedTerm(word: string, before: string | undefined, after: string | undefined, locale: TermLocale): string {
  if (!locale.startsWith("zh") || !word) return word;
  const lead = before !== undefined && CJK.test(before) && LATIN.test(word[0]!) ? " " : "";
  const tail = after !== undefined && CJK.test(after) && LATIN.test(word[word.length - 1]!) ? " " : "";
  return lead + word + tail;
}

export function applyTerms(template: string, terms: TermSet, locale: TermLocale): string {
  if (!template.includes("{{")) return template;
  return template.replace(TOKEN, (whole, art: string | undefined, name: string, at: number) => {
    const form = FORMS[name.toLowerCase()];
    if (!form) return whole;
    const raw = terms[form[0]][form[1]];
    const word = name[0] === name[0]!.toUpperCase() ? upperFirst(raw) : raw;
    if (!art || !isEnLocale(locale)) return spacedTerm(word, template[at - 1], template[at + whole.length], locale);
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
    // The neighbours decide the spacing (applyTerms on the token alone has none).
    out.push({ id: form[0], text: applyTerms(template.slice(Math.max(0, m.index - 1), m.index + m[0].length + 1), terms, locale).slice(m.index > 0 ? 1 : 0, m.index + m[0].length < template.length ? -1 : undefined) });
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
  const ids: TermId[] = ["subagent", "agent", "operator", "director", "owner"];
  const swaps = ids.filter((id) => terms[id].one !== defaults[id].one);
  if (!swaps.length) return text;
  const pattern = new RegExp(ids.map((id) => defaults[id].one).join("|"), "g");
  return text.replace(pattern, (word, at: number) => {
    const id = ids.find((i) => defaults[i].one === word)!;
    return spacedTerm(terms[id].one, text[at - 1], text[at + word.length], locale);
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
    const parsed = parseOverrides(raw);
    const migrated = migrateMaidTerms(parsed);
    if (migrated !== parsed) {
      try { localStorage.setItem(KEY, JSON.stringify(migrated)); } catch { /* Memory still uses the migrated terms. */ }
    }
    return migrated;
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
