import { expect, it } from "vitest";
import { CutexApiError, CutexClient, SESSION_DELTAS_FEATURE, SESSION_DELTAS_HOST_FEATURE } from "../src/index";

it("encodes bounded owner catalog/change queries without interpreting opaque cursors", async () => {
  const calls: URL[] = [];
  const client = new CutexClient({ baseUrl: "http://fixture.invalid", token: "owner" }, { fetch: async input => {
    calls.push(new URL(String(input)));
    return Response.json({ resyncRequired: true, reason: "WrongInstance" });
  } });
  expect(SESSION_DELTAS_FEATURE).toBe("session-deltas-v1");
  expect(SESSION_DELTAS_HOST_FEATURE).toBe("session-deltas-host-v1");
  expect(await client.sessionPage({ lifecycle: "retired", cursor: "opaque+/=?", limit: 200, maxBytes: 262144 })).toEqual({ resyncRequired: true, reason: "WrongInstance" });
  await client.sessionChanges("opaque+/=?", { limit: 1000, maxBytes: 65536 });
  expect(calls[0]!.pathname).toBe("/v2/sessions/page");
  expect(Object.fromEntries(calls[0]!.searchParams)).toEqual({ lifecycle: "retired", cursor: "opaque+/=?", limit: "200", maxBytes: "262144" });
  expect(calls[1]!.pathname).toBe("/v2/sessions/changes");
  expect(Object.fromEntries(calls[1]!.searchParams)).toEqual({ cursor: "opaque+/=?", limit: "1000", maxBytes: "65536" });
  client.dispose();
});

it("reads an exact host ID through its bounded 0/1-row envelope without substring search or list fallback", async () => {
  const calls: string[] = []; let exists = true;
  const client = new CutexClient({ baseUrl: "http://fixture.invalid", token: "owner" }, { fetch: async input => {
    calls.push(String(input));
    return Response.json({ schema: "cutex/host-sessions/v1", data: exists ? [{ id: "id ?", name: "target" }] : [], nextCursor: null });
  } });
  expect(await client.hostSession("id ?")).toEqual({ id: "id ?", name: "target" });
  exists = false; expect(await client.hostSession("id ?")).toBeNull();
  expect(calls).toEqual(["http://fixture.invalid/v2/host/sessions/id%20%3F", "http://fixture.invalid/v2/host/sessions/id%20%3F"]);
  client.dispose();
});

it("leaves existing list/session callers compatible and never silently falls back from advertised deltas", async () => {
  const calls: string[] = [];
  const client = new CutexClient({ baseUrl: "http://fixture.invalid", token: "owner" }, { fetch: async input => {
    const url = new URL(String(input)); calls.push(url.pathname + url.search);
    return url.pathname === "/v2/sessions/changes"
      ? Response.json({ error: { code: "not_found", message: "missing" } }, { status: 404 }) : Response.json({ sessions: [] });
  } });
  await client.sessions(); await client.session("id /?", "retired");
  await expect(client.sessionChanges("head")).rejects.toBeInstanceOf(CutexApiError);
  expect(calls).toEqual(["/v2/sessions?lifecycle=active", "/v2/sessions/id%20%2F%3F?lifecycle=retired", "/v2/sessions/changes?cursor=head"]);
  client.dispose();
});
