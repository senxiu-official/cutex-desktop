// r289 owner dispositions (plan .claude/agent-artifacts/state-surfaces-fix-plan.md WP-D0): the new owner routes name
// the stored record and work for archived / deleted agents; each call prefers its route when the host advertises it and
// keeps today's session path on older hosts. What an older host cannot do is refused before any write.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, shell: {} }));
import { CutexClient } from "@cutex-desktop/cutex-client";
import { DaemonService } from "../src/main/daemon";
import { jobCanCloseFollowUp, ownerDispositionFeatureList, ownerDispositionSupport } from "../src/shared/ownerDispositions";

const NOTE = { notificationId: "n1", agentId: "gone", agentName: "Gone", origin: "agent", text: "hi", level: "attention", requestedLevel: "attention", downgraded: null, muted: false, channels: [], needsReply: false, delegation: null, job: null, turnId: null, state: "dismissed", createdAt: "2026-11-17T00:00:00Z", acknowledgedAt: null, reply: null, closedAt: "2026-11-17T00:01:00Z" };
const SETTLEMENT = { state: "closed", outcome: "unconfirmed", by: "owner", canClose: false, evidence: null, evidenceToken: "", closure: { actor: "owner", closedAt: "2026-11-17T00:00:00Z", reason: "r", requestId: "act-1" } };
const ERR = (status: number, code: string) => Response.json({ contractVersion: 2, error: { source: "cutex", code, message: code, retryable: false } }, { status });

type Call = { method: string; path: string; body: unknown };
/** A daemon whose host advertises `caps`; `route(call)` answers everything else (default: a plausible success). */
function fixture(caps: Record<string, unknown>, route: (call: Call) => Response | undefined = () => undefined, jobCaps: unknown = { humanOperations: ["list", "cancel"] }) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const call = { method: init?.method ?? "GET", path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : null };
    if (url.pathname === "/v2/capabilities") return Response.json({ hostId: "h", ...caps });
    calls.push(call);
    const own = route(call);
    if (own) return own;
    if (url.pathname === "/v2/job-service/capabilities") return Response.json(jobCaps);
    if (url.pathname.startsWith("/v2/asks/")) return Response.json({ ask: { askId: "a1", closed: "stopped" }, receipt: { actionId: "act-1" }, stopping: false });
    if (url.pathname.startsWith("/v2/owner-notifications/")) return Response.json({ notification: NOTE, changed: true });
    if (url.pathname === "/v2/agent-bus/stuck-messages/end-follow-up") return Response.json({ messageId: "m1", changed: true, settlement: SETTLEMENT });
    if (url.pathname === "/v2/job-service/close-follow-up") return Response.json({ jobId: "j1", state: "unconfirmed", terminalReason: "followUpEnded", revision: 4 });
    if (url.pathname.endsWith("/cutex/requests")) return Response.json({ cutex: { result: { notification: NOTE } } });
    return Response.json({});
  });
  const daemon = new DaemonService(() => {});
  (daemon as unknown as { client: CutexClient }).client = new CutexClient({ baseUrl: "http://fixture.invalid", token: "synthetic" }, { fetch });
  return { daemon, calls };
}
const NEW = { featureList: ["owner-ask-disposition-v1", "owner-notify-direct-v1", "agent-bus-owner-end-followup-v1"] };
const OLD = { featureList: ["services"] };


it('REVIEW: existing delegated Stop on a send-granted non-owner must keep the session route', async () => {
  const member = { ...NEW, featureList:[...NEW.featureList,'users-p2-access'],user:{id:'member',name:'Member',isOwner:false,pending:false,grant:{send:true,read:true}} };
  const f = fixture(member, call => call.path === '/v2/asks/a1/close' ? ERR(403,'owner_required') : undefined);
  const result = await f.daemon.askDispose('target', 'a1', 'stop', 'member-stop');
  console.log('REVIEW_MEMBER_STOP', JSON.stringify({result,calls:f.calls}));
  expect(result).toMatchObject({ok:true,route:'session'});
});
