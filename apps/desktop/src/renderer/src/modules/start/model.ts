// 开始使用 (onboarding v3): which of the three steps is open, from what the app knows — the focus host's connection,
// its Profiles — and what the owner picked on the card. Pure (test/startModel.test.ts).
import type { DaemonState, ProfileItem } from "../../../../shared/ipc";
import { orderProfiles, profileProblems } from "../../lib/profileCards";

/** The focus host as step 1 sees it. */
export type HostStage =
  /** No host configured at all (macOS without a local cutex). */
  | "noHost"
  /** This computer: cutex not installed / installed but not running (daemon `setup`). */
  | "notInstalled"
  | "notRunning"
  | "connecting"
  /** Not reachable for another reason (a remote host down, a token refused). */
  | "unreachable"
  | "connected";

export function hostStage(daemon: DaemonState, noHost: boolean): HostStage {
  if (noHost) return "noHost";
  if (daemon.kind === "connected") return "connected";
  if (daemon.kind === "connecting") return "connecting";
  if (daemon.kind === "unreachable" && daemon.setup) return daemon.setup;
  return "unreachable";
}

/** Step 2 from the host's Profile list (null = not read yet). */
export type ProfileStage =
  | { kind: "unknown" }
  | { kind: "none" }
  /** Profiles that can run (default first), and those that still need a login / key. */
  | { kind: "some"; ready: ProfileItem[]; unready: { profile: ProfileItem; needs: "login" | "key" }[] };

type ProfileList = { defaultProfile: string | null; profiles: ProfileItem[] };

export function profileStage(list: ProfileList | null): ProfileStage {
  if (!list) return { kind: "unknown" };
  const ordered = orderProfiles(list);
  if (!ordered.length) return { kind: "none" };
  const ready: ProfileItem[] = [];
  const unready: { profile: ProfileItem; needs: "login" | "key" }[] = [];
  for (const p of ordered) {
    const problems = profileProblems(p, undefined);
    if (problems.includes("notLoggedIn")) unready.push({ profile: p, needs: "login" });
    else if (problems.includes("keyMissing")) unready.push({ profile: p, needs: "key" });
    else ready.push(p);
  }
  return { kind: "some", ready, unready };
}

/** The Profile step 3 uses: the one picked on the card while it still can run, else the first that can. */
export function chosenProfile(stage: ProfileStage, picked: string | null): ProfileItem | null {
  if (stage.kind !== "some") return null;
  return stage.ready.find((p) => p.name === picked) ?? stage.ready[0] ?? null;
}

export type StartStep = "host" | "profile" | "message";

/**
 * The open step. `confirmed`: the owner chose a Profile on the card (or it was the only one ready when the card
 * opened, see `profileSettled`); a host with several ready Profiles asks which one first.
 */
export function startStep(host: HostStage, profiles: ProfileStage, confirmed: boolean): StartStep {
  if (host !== "connected") return "host";
  if (profiles.kind !== "some" || !profiles.ready.length) return "profile";
  return confirmed ? "message" : "profile";
}

/** Exactly one Profile can run and none is waiting: nothing to choose, step 2 counts as done (the fast path). */
export function profileSettled(profiles: ProfileStage): boolean {
  return profiles.kind === "some" && profiles.ready.length === 1 && profiles.unready.length === 0;
}

/** The new agent's name: the Profile's (its provider is what the owner recognises), else 「Cutex」. */
export function firstAgentName(profile: Pick<ProfileItem, "name"> | null): string {
  const name = profile?.name.trim();
  return name ? name.slice(0, 40) : "Cutex";
}

/** The first message must not be blank; the folder is needed unless the host gives a scratch workspace. */
export function canSend(text: string, folder: string, scratchOk: boolean): "ok" | "text" | "folder" {
  if (!text.trim()) return "text";
  if (!folder.trim() && !scratchOk) return "folder";
  return "ok";
}
