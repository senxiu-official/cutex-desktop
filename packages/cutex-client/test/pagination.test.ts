import { describe, expect, expectTypeOf, it } from "vitest";
import { CutexApiError, CutexClient, CutexUnreachableError, type ApprovalsPage, type OwnerNotificationList, type PageQuery, type SafetyChecksPage } from "../src/index";

const apiError = (code: string) => ({ contractVersion: 2, error: { source: "cutex", code, message: code, retryable: false } });
function mock(reply: unknown, status = 200) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const client = new CutexClient({ baseUrl: "http://mock.invalid", token: "test" }, {
    fetch: (async (input, init) => {
      calls.push({ url: new URL(String(input)), init });
      return new Response(JSON.stringify(reply), { status });
    }) as typeof fetch,
  });
  return { client, calls };
}

const routes = [
  { path: "/v2/approvals", field: "approvals", defaults: { state: "pending" }, call: (c: CutexClient, q: PageQuery = {}) => c.approvalsPage("pending", q) },
  { path: "/v2/owner-notifications", field: "notifications", defaults: { filter: "all" }, call: (c: CutexClient, q: PageQuery = {}) => c.ownerNotificationsPage(q) },
  { path: "/v2/safety-checks", field: "blocks", defaults: { state: "open" }, call: (c: CutexClient, q: PageQuery = {}) => c.safetyChecksPage(q) },
];

for (const route of routes) describe(route.path, () => {
  it("requests one explicit default-bounded page without probing capability", async () => {
    const body = { [route.field]: [] };
    const { client, calls } = mock(body);
    expect(await route.call(client)).toEqual(body);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.pathname).toBe(route.path);
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({ ...route.defaults, limit: "100" });
    expect(calls[0]!.init?.method).toBe("GET");
  });

  it.each([[0, 1], [-2, 1], [1.9, 1], [500, 500], [501, 500], [Number.NaN, 100], [Infinity, 100], [-Infinity, 100]])("bounds limit %s to %s", async (input, expected) => {
    const { client, calls } = mock({ [route.field]: [] });
    await route.call(client, { limit: input });
    expect(calls[0]!.url.searchParams.get("limit")).toBe(String(expected));
  });

  it.each([{ rows: [] }, { rows: [{ id: "large-record", text: "x".repeat(240 * 1024) }] }, { rows: [{ id: "oversized-record", text: "x".repeat(300 * 1024) }] }])("preserves the opaque continuation on empty/byte-bounded short pages (case %#)", async ({ rows }) => {
    const cursor = "opaque%2F%25+a/b?x=1&unicode=中文#";
    const { client, calls } = mock({ [route.field]: rows, nextCursor: cursor });
    const page = await route.call(client, { limit: 100 });
    expect(page).toEqual({ [route.field]: rows, nextCursor: cursor });
    await route.call(client, { cursor: page!.nextCursor });
    expect(calls[1]!.url.searchParams.get("cursor")).toBe(cursor);
    expect(calls[1]!.url.searchParams.get("limit")).toBe("100");
    expect(calls[1]!.url.search).toContain("%252F%2525%2B");
  });

  it("leaves nextCursor absent at EOF", async () => {
    const { client } = mock({ [route.field]: [] });
    expect(await route.call(client)).not.toHaveProperty("nextCursor");
  });

  it.each([[404, "not_found"], [405, "method_not_allowed"], [404, "notification_not_found"]])("returns null for missing route %s", async (status, code) => {
    const { client, calls } = mock(apiError(code), status);
    expect(await route.call(client)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it.each([[400, "invalid_cursor"], [409, "resync_required"], [403, "forbidden"], [500, "store_failure"]])("propagates %s %s with no full-list fallback", async (status, code) => {
    const { client, calls } = mock(apiError(code), status);
    await expect(route.call(client, { cursor: "stale%cursor" })).rejects.toMatchObject({ status, code });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.searchParams.get("limit")).toBe("100");
    expect(calls[0]!.url.searchParams.get("cursor")).toBe("stale%cursor");
  });

  it("propagates network errors", async () => {
    const client = new CutexClient({ baseUrl: "http://mock.invalid", token: null }, {
      fetch: (async () => { throw new Error("offline"); }) as typeof fetch,
    });
    await expect(route.call(client)).rejects.toBeInstanceOf(CutexUnreachableError);
  });
});

it("exports typed page responses through the browser-safe public entry", () => {
  const { client } = mock({});
  expectTypeOf(client.approvalsPage<{ approvalId: string }>()).toEqualTypeOf<Promise<ApprovalsPage<{ approvalId: string }> | null>>();
  expectTypeOf(client.ownerNotificationsPage()).toEqualTypeOf<Promise<OwnerNotificationList | null>>();
  expectTypeOf(client.safetyChecksPage()).toEqualTypeOf<Promise<SafetyChecksPage | null>>();
  expectTypeOf(client.approvals<{ approvalId: string }>()).toEqualTypeOf<Promise<{ approvalId: string }[] | null>>();
});

it("uses explicit filters and agent ids without encoding them as path segments", async () => {
  const { client, calls } = mock({ approvals: [], notifications: [], blocks: [] });
  await client.approvalsPage("all", { limit: 23, cursor: "next" });
  await client.ownerNotificationsPage({ filter: "alerting", agentId: "agent/中文 +%", limit: 12 });
  await client.ownerNotificationsPage({ filter: "pending" });
  await client.safetyChecksPage({ state: "all", agentId: "agent/中文 +%", limit: 7 });
  expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({ state: "all", limit: "23", cursor: "next" });
  expect(Object.fromEntries(calls[1]!.url.searchParams)).toEqual({ filter: "alerting", agentId: "agent/中文 +%", limit: "12" });
  expect(calls[2]!.url.searchParams.get("filter")).toBe("pending");
  expect(Object.fromEntries(calls[3]!.url.searchParams)).toEqual({ state: "all", agentId: "agent/中文 +%", limit: "7" });
});

it("normalizes backend approvals null cursor while retaining extra response metadata", async () => {
  const { client } = mock({ approvals: [], hostId: "mock", nextCursor: null });
  expect(await client.approvalsPage()).toEqual({ approvals: [], hostId: "mock" });
});

it("keeps legacy approvals array/null, unbounded request and omitted-list behavior unchanged", async () => {
  const { client, calls } = mock({ approvals: [{ approvalId: "apr-1" }], nextCursor: "unused" });
  expect(await client.approvals()).toEqual([{ approvalId: "apr-1" }]);
  await client.approvals("all");
  expect(calls.map(c => c.url.toString())).toEqual([
    "http://mock.invalid/v2/approvals?state=pending", "http://mock.invalid/v2/approvals?state=all",
  ]);
  expect(await mock({}).client.approvals()).toEqual([]);
  expect(await mock(apiError("not_found"), 404).client.approvals()).toBeNull();
  expect(await mock("", 405).client.approvals()).toBeNull();
  await expect(mock(apiError("boom"), 500).client.approvals()).rejects.toBeInstanceOf(CutexApiError);
});
