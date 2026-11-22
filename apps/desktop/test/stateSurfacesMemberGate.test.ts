// Cross-review P2-1 (state surfaces, c1596d287): the r289 owner routes are the owner's only. A member's connection keeps
// today's session commands for stop / accept / abandon, and never sees 结束跟进 (not even greyed as an "old host").
import { describe, expect, it } from "vitest";
import { ownerDispositionSupport } from "../src/shared/ownerDispositions";
import { hostFeatureSet, RESTRICTED_FEATURE } from "../src/shared/users";

const NEW = ["owner-ask-disposition-v1", "owner-notify-direct-v1", "agent-bus-owner-end-followup-v1", "ask-stop-settlement-v1", "stop-answer-admission-v1", "users-p2-access"];
const member = { featureList: NEW, user: { id: "m", name: "M", isOwner: false, pending: false, grant: { send: true, read: true } } };
const owner = { featureList: NEW, user: { id: "o", name: "O", isOwner: true, pending: false } };

describe("owner dispositions by connection", () => {
  it("main never picks an owner route for a member; display-only fields stay", () => {
    expect(ownerDispositionSupport(member as never)).toEqual({ askDisposition: false, ownerNotifyDirect: false, messageEndFollowUp: false, askStopSettlement: true, stopAnswerAdmission: true });
    expect(ownerDispositionSupport(owner as never)).toMatchObject({ askDisposition: true, ownerNotifyDirect: true, messageEndFollowUp: true });
  });
  it("the renderer's feature set hides the owner routes from a member, so 结束跟进 is not offered", async () => {
    const features = hostFeatureSet(member as never);
    expect(features.has(RESTRICTED_FEATURE)).toBe(true);
    for (const f of ["owner-ask-disposition-v1", "owner-notify-direct-v1", "agent-bus-owner-end-followup-v1"]) expect(features.has(f)).toBe(false);
    expect(features.has("stop-answer-admission-v1")).toBe(true);
  });
});
