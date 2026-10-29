import { describe, expect, it } from "vitest";
import type { SessionForkPreview, SessionForkTarget } from "../src/shared/sessionFork";
import type { AutoPickPreview } from "../src/shared/profileAutoPick";
import { forkErrorKey, forkHistorySize, forkTargets, forkQuota, isForkSignatureRejection } from "../src/renderer/src/lib/forkProfile";
import { turnErrorText } from "../src/renderer/src/lib/timeline";
const target = (name: string, eligible = true) => ({id:name,name,cliKind:"claude",providerFamily:"anthropic",eligible,reason:null}) as SessionForkTarget;
describe("fork profile facts", () => {
  it("uses the daemon's eligible targets rather than inferring frozen Claude account families", () => {
    const preview = {sourceProfile:"source",targets:[target("source"),target("compatible"),target("wrong-account",false),target("disabled",false)]} as SessionForkPreview;
    expect(forkTargets(preview).map(p=>p.name)).toEqual(["compatible"]);
    expect(forkTargets(null)).toEqual([]);
  });
  it("uses a cached 041 candidate percentage only when present", () => {
    expect(forkQuota(null, "target")).toBeNull();
    const preview = {providers:[{pick:{candidates:[{profile:"target",remainingPercent:42}]}}]} as AutoPickPreview;
    expect(forkQuota(preview,"target")).toBe(42); expect(forkQuota(preview,"other")).toBeNull();
  });
  it("formats actual bytes without guessing missing history", () => {
    expect(forkHistorySize(undefined)).toBeNull(); expect(forkHistorySize(-1)).toBeNull(); expect(forkHistorySize(0)).toBe("0 B"); expect(forkHistorySize(2048)).toBe("2 KiB");
  });
});
describe("fork failure copy", () => {
  it.each([
    ["provider_family_mismatch","fork.error.family"],["profile_switch_cli_mismatch","fork.error.family"],["profile_fork_disallowed","fork.error.disallowed"],
    ["profile_not_found","fork.error.profileMissing"],["session_not_found","fork.error.sourceMissing"],["fork_history_signature_rejected","fork.error.signature"],
    ["cross-profile fork requires forkProfileDefaults","fork.error.runtimeUpgrade"],
  ])("maps %s to plain copy",(message,key)=>expect(forkErrorKey(new Error(message))).toBe(key));
  it("shows preserved-history diagnosis on async native failure without claiming unrelated failures are forks", () => {
    const message = "The target account rejected encrypted reasoning or a thinking signature in this fork's copied history. The fork and source are preserved; no history was stripped or deleted.";
    expect(isForkSignatureRejection(message)).toBe(true); expect(isForkSignatureRejection("invalid signature")).toBe(false);
    expect(turnErrorText({message})).toContain("没有删除"); expect(turnErrorText({message:"ordinary error"})).toBe("ordinary error");
  });
});
