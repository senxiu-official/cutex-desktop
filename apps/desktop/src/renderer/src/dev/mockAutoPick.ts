// Preview-only stand-in for cutex `profile-auto-pick` (docs/design/041-profile-auto-pick.md): fixed
// quota fixtures, cutex's scoring (hours until the first window runs out at today's spend plus the new
// agent's estimate; a window that resets first counts one more full window; capped at 24 h; under 1 h
// skipped; 10 % ties go to fewer agents, then the name). No network, no credentials.
import type { AutoPickPreview, PickCandidate, PickExcluded, ProfilePick, ProviderPick } from "../../../shared/profileAutoPick";

export interface MockPickProfile {
  name: string;
  family: string;
  familyLabel: string;
  autoPick: boolean;
  approval: boolean;
}

interface Window { label: string; remaining: number; resetHours: number; burn: number }
/** Mock quota (no fixture = no fresh reading: `quota_stale`). Matches the 041 §2 example. */
const QUOTA: Record<string, { windows: Window[]; agents: number }> = {
  claude: { agents: 2, windows: [{ label: "5h", remaining: 62, resetHours: 3, burn: 10 }, { label: "7d", remaining: 40, resetHours: 96, burn: 0.8 }] },
  "claude-work": { agents: 1, windows: [{ label: "5h", remaining: 85, resetHours: 4.5, burn: 5 }, { label: "7d", remaining: 12, resetHours: 48, burn: 0.5 }] },
};

const NOW = () => Math.floor(Date.now() / 1000);

function spend(label: string, model: string | null, effort: string | null): number {
  const base = label === "5h" ? 12 : 1;
  const m = (model ?? "").toLowerCase();
  const modelFactor = m.includes("opus") ? 1 : ["haiku", "mini", "flash", "air", "nano"].some((s) => m.includes(s)) ? 0.25 : 0.6;
  const effortFactor = effort === "low" ? 0.5 : effort === "medium" ? 0.75 : effort === "xhigh" || effort === "max" ? 1.3 : 1;
  return base * modelFactor * effortFactor;
}

function score(name: string, model: string | null, effort: string | null): PickCandidate | null {
  const q = QUOTA[name];
  if (!q) return null;
  let best: { hours: number; w: Window } | null = null;
  for (const w of q.windows) {
    const rate = w.burn + spend(w.label, model, effort);
    const empty = w.remaining / rate;
    const hours = empty >= w.resetHours ? w.resetHours + 100 / rate : empty;
    if (!best || hours < best.hours) best = { hours, w };
  }
  if (!best) return null;
  return { profile: name, profileId: name, hours: Math.round(Math.min(best.hours, 24) * 10) / 10, bindingWindow: best.w.label, remainingPercent: best.w.remaining, resetAt: NOW() + Math.round(best.w.resetHours * 3600), activeAgents: q.agents };
}

function pickFor(family: string, members: MockPickProfile[], model: string | null, effort: string | null): Pick<ProviderPick, "pick" | "refusal"> {
  const excluded: PickExcluded[] = [];
  const candidates: PickCandidate[] = [];
  for (const p of members) {
    if (!p.autoPick) excluded.push({ profile: p.name, reason: "not_opted_in" });
    else if (p.approval) excluded.push({ profile: p.name, reason: "requires_approval" });
    else {
      const scored = score(p.name, model, effort);
      if (scored) candidates.push(scored);
      else excluded.push({ profile: p.name, reason: "quota_stale" });
    }
  }
  candidates.sort((a, b) => b.hours - a.hours || a.profile.localeCompare(b.profile));
  if (!candidates.length) {
    return { pick: null, refusal: { code: "no_auto_pick_candidate", detail: `no '${family}' profile can be picked automatically (${excluded.map((e) => `${e.profile}: ${e.reason}`).join(", ")}); turn on 「参与自动选择」 for one, or pass a profile name` } };
  }
  const eligible = candidates.filter((c) => c.hours >= 1);
  let picked: PickCandidate;
  let rule: string;
  if (candidates.length === 1) [picked, rule] = [candidates[0]!, "only_candidate"];
  else if (!eligible.length) [picked, rule] = [[...candidates].sort((a, b) => (a.resetAt ?? Infinity) - (b.resetAt ?? Infinity))[0]!, "all_near_wall_soonest_reset"];
  else {
    const top = eligible[0]!.hours;
    const tied = eligible.filter((c) => c.hours >= top * 0.9).sort((a, b) => a.activeAgents - b.activeAgents || a.profile.localeCompare(b.profile));
    picked = tied[0]!;
    rule = tied.length === 1 ? "latest_wall" : tied.some((c) => c.activeAgents !== picked.activeAgents) ? "tie_fewer_agents" : "tie_name";
  }
  const pick: ProfilePick = {
    requested: `auto:${family}`, provider: family, picked: picked.profile, pickedId: picked.profileId, rule,
    reason: `${picked.profile}: ${picked.bindingWindow} window ${picked.remainingPercent}% left, about ${picked.hours.toFixed(1)} h to its limit`,
    candidates, excluded,
  };
  return { pick, refusal: null };
}

/** cutex's provider aliases (profile_auto_pick.rs `canonical_provider`). */
export function mockCanonicalProvider(value: string): string {
  const v = value.toLowerCase();
  return v === "claude" ? "anthropic" : v === "chatgpt" || v === "codex" ? "openai-chatgpt" : v === "glm" || v === "zai" || v === "z.ai" ? "zhipu" : v;
}

/** `GET /v2/profile-auto-pick` over the mock's profiles. */
export function mockAutoPickPreview(profiles: MockPickProfile[], query: { provider?: string | null; model?: string | null; effort?: string | null }): AutoPickPreview {
  const provider = query.provider ? mockCanonicalProvider(query.provider) : null;
  const families = [...new Map(profiles.map((p) => [p.family, p.familyLabel])).entries()].filter(([family]) => !provider || family === provider);
  return {
    available: true,
    unavailableReason: null,
    providers: families.map(([family, label]) => {
      const members = profiles.filter((p) => p.family === family);
      return { provider: family, providerLabel: label, profiles: members.length, optedIn: members.filter((p) => p.autoPick).length, ...pickFor(family, members, query.model ?? null, query.effort ?? null) };
    }),
  };
}
