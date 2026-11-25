// Finding a delegation by id in the sidebar search (lib/delegationIdSearch, owner 2026-11-25 「#47c47e」): what reads as a
// delegation id, how stored ids match, one request per host (a full id by GET, an abbreviation by one list read), a
// changed text dropping the search (nothing more sent, late replies ignored, also after returning to the same text), its
// own host gate (not session search's), the kept list read, failures and a cut list.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AskDetail, AskFilter, AskIdLookup, AskSummary } from "../src/shared/ipc";

type Api = { asks: (f: AskFilter) => Promise<AskSummary[] | null>; ask: (id: string) => Promise<AskDetail | null>; askIdLookup?: (p: string, limit?: number) => Promise<AskIdLookup | null> };
const apis = new Map<string, Api>();
const calls: { hostId: string; method: string; arg: unknown }[] = [];
const hostEvents: ((e: { hostId: string; envelope: { cutex?: { method?: string } } }) => void)[] = [];
vi.mock("../src/renderer/src/bridge", () => {
  const api = new Proxy({}, { get: (_t, m) => (m === "then" ? undefined : () => Promise.resolve(null)) });
  const apiFor = (hostId: string) => ({
    asks: (f: AskFilter) => (calls.push({ hostId, method: "asks", arg: f }), apis.get(hostId)!.asks(f)),
    ask: (id: string) => (calls.push({ hostId, method: "ask", arg: id }), apis.get(hostId)!.ask(id)),
    askIdLookup: (p: string, limit?: number) => (calls.push({ hostId, method: "askIdLookup", arg: [p, limit] }), apis.get(hostId)!.askIdLookup!(p, limit)),
  });
  return { api, apiFor, bridge: { api, apiFor, on: (_ch: string, fn: (typeof hostEvents)[number]) => (hostEvents.push(fn), () => {}) }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m };
});

import { askIdMatches, delegationIdQuery, dropDelegationIdSearch, HITS_MAX, LIST_LIMIT, LIST_TTL_MS, resetIdLookupLists, searchDelegationId, setIdLookupHosts, useDelegationIdSearch } from "../src/renderer/src/lib/delegationIdSearch";
import { resetSearchLanes, setSearchHosts } from "../src/renderer/src/lib/sessionSearchStore";
import { useDelegations } from "../src/renderer/src/lib/delegationStore";
import { hostKey } from "../src/renderer/src/lib/hostKeys";

const ID = "ask-47c47e1b9d204f3e8a65c0d2f7b1e9a4";
const row = (askId: string, over: Partial<AskSummary> = {}): AskSummary => ({
  askId, title: `t-${askId}`, requester: { kind: "owner" }, target: "a", execution: "running", attempts: 1,
  createdAt: "2026-11-25T01:00:00Z", updatedAt: "2026-11-25T01:00:00Z", revision: 1, ...over,
}) as AskSummary;
const tick = () => new Promise((r) => setTimeout(r, 0));
const drain = async () => { for (let i = 0; i < 8; i++) await tick(); };

beforeEach(() => {
  apis.clear();
  calls.length = 0;
  resetSearchLanes();
  setSearchHosts(null);
  setIdLookupHosts(null);
  resetIdLookupLists();
  dropDelegationIdSearch(null);
  vi.restoreAllMocks();
});

describe("what reads as a delegation id", () => {
  it("#hex, bare hex, ask-… and delegation-… of at least 6 hex digits; # / ask- / delegation- are explicit", () => {
    expect(delegationIdQuery("#47c47e")).toMatchObject({ ref: { kind: null, hex: "47c47e", mode: "either" }, explicit: true, text: "47c47e" });
    expect(delegationIdQuery(" 47C47E ")).toMatchObject({ ref: { hex: "47c47e" }, explicit: false });
    expect(delegationIdQuery("delegation-47c47e1b")).toMatchObject({ ref: { kind: "ask", hex: "47c47e1b" }, explicit: true });
    expect(delegationIdQuery(ID)).toMatchObject({ ref: { kind: "ask", mode: "full" }, explicit: true });
    expect(delegationIdQuery("…f7b1e9a4")).toMatchObject({ ref: { mode: "suffix", hex: "f7b1e9a4" } });
    // A hex word is an id only when written as one.
    expect(delegationIdQuery("#facade")).toMatchObject({ ref: { hex: "facade" }, explicit: true });
    expect(delegationIdQuery("…decade")).toMatchObject({ ref: { mode: "suffix", hex: "decade" } });
  });

  it("names, short hex, session / other ids and phrases are not", () => {
    for (const text of ["", "#", "#47c4", "Alden", "cafe", "facade", "decade", "deface", "Facade", "cutex.…3f9a1c", "q-47c47e", "art-47c47e", "47c47e and more", "#47c47g"]) expect(delegationIdQuery(text)).toBeNull();
  });

  it("an abbreviation matches a stored id as a prefix or a suffix; …x as a suffix only; a full id exactly", () => {
    const either = delegationIdQuery("47c47e")!.ref;
    expect(askIdMatches(either, ID)).toBe(true);
    expect(askIdMatches(delegationIdQuery("f7b1e9a4")!.ref, ID)).toBe(true);
    expect(askIdMatches(delegationIdQuery("…47c47e")!.ref, ID)).toBe(false);
    expect(askIdMatches(delegationIdQuery(ID)!.ref, ID)).toBe(true);
    expect(askIdMatches(delegationIdQuery(ID)!.ref, "ask-47c47e1b9d204f3e8a65c0d2f7b1e9a5")).toBe(false);
    // Mock / legacy ids that are not hex never match.
    expect(askIdMatches(either, "ask-run")).toBe(false);
  });
});

describe("looking it up", () => {
  it("one list read per host for an abbreviation; matches from every host, newest first", async () => {
    apis.set("local", { asks: async () => [row(ID, { createdAt: "2026-11-25T01:00:00Z" }), row("ask-00000000000000000000000000000001")], ask: async () => null });
    apis.set("ws", { asks: async () => [row("ask-47c47e00000000000000000000000002", { createdAt: "2026-11-25T03:00:00Z" })], ask: async () => null });
    searchDelegationId(delegationIdQuery("#47c47e")!, ["local", "ws"], "k1");
    await drain();
    expect(calls).toEqual([{ hostId: "local", method: "asks", arg: { limit: LIST_LIMIT, background: true } }, { hostId: "ws", method: "asks", arg: { limit: LIST_LIMIT, background: true } }]);
    const s = useDelegationIdSearch.getState();
    expect(s.hits.map((h) => [h.hostId, h.d.askId])).toEqual([["ws", "ask-47c47e00000000000000000000000002"], ["local", ID]]);
    expect(s.run).toMatchObject({ pending: [], failed: [], truncated: false });
  });

  it("a full id is read by id; not found is no match, not a failure", async () => {
    apis.set("local", { asks: async () => [], ask: async (id) => ({ askId: id, title: "x", requester: { kind: "owner" }, targetCutexSessionId: "a", execution: "running", createdAt: "2026-11-25T01:00:00Z", updatedAt: "2026-11-25T01:00:00Z", revision: 2 }) as AskDetail });
    apis.set("ws", { asks: async () => [], ask: async () => { throw new Error("ask_not_found: no ask has this id"); } });
    searchDelegationId(delegationIdQuery(ID)!, ["local", "ws"], "k1");
    await drain();
    expect(calls.map((c) => [c.hostId, c.method, c.arg])).toEqual([["local", "ask", ID], ["ws", "ask", ID]]);
    expect(useDelegationIdSearch.getState().hits.map((h) => [h.hostId, h.d.askId, h.d.target])).toEqual([["local", ID, "a"]]);
    expect(useDelegationIdSearch.getState().run?.failed).toEqual([]);
  });

  it("a changed text drops the search: queued requests are not sent and a late reply is ignored", async () => {
    let release!: (rows: AskSummary[]) => void;
    apis.set("local", { asks: () => new Promise((r) => (release = r)), ask: async () => null });
    searchDelegationId(delegationIdQuery("47c47e")!, ["local"], "k1");
    await tick();
    expect(calls).toHaveLength(1);
    dropDelegationIdSearch("k2");
    expect(useDelegationIdSearch.getState().run).toBeNull();
    release([row(ID)]);
    await drain();
    expect(useDelegationIdSearch.getState().hits).toEqual([]);
    // A host that left the view (or lost delegations) before its turn is not asked.
    apis.set("ws", { asks: async () => [row(ID)], ask: async () => null });
    setIdLookupHosts(["local"]);
    searchDelegationId(delegationIdQuery("47c47e")!, ["ws"], "k3");
    await drain();
    expect(calls.filter((c) => c.hostId === "ws")).toEqual([]);
    expect(useDelegationIdSearch.getState().run?.pending).toEqual([]);
  });

  it("session search's host list does not gate it: a host with delegations but no session search is asked", async () => {
    apis.set("ws", { asks: async () => [row(ID)], ask: async () => null });
    setSearchHosts([]);
    setIdLookupHosts(["ws"]);
    searchDelegationId(delegationIdQuery("#47c47e")!, ["ws"], "k1");
    await drain();
    expect(calls.map((c) => c.hostId)).toEqual(["ws"]);
    expect(useDelegationIdSearch.getState().hits).toHaveLength(1);
  });

  it("returning to the same text is a new search: the abandoned one's late reply is not taken (A → B → A)", async () => {
    const replies: ((d: AskDetail) => void)[] = [];
    apis.set("local", { asks: async () => [], ask: () => new Promise((r) => replies.push(r)) });
    const detail = (title: string) => ({ askId: ID, title, requester: { kind: "owner" }, targetCutexSessionId: "a", execution: "running", createdAt: "2026-11-25T01:00:00Z", updatedAt: "2026-11-25T01:00:00Z", revision: 1 }) as AskDetail;
    const B = "ask-abcdef1b9d204f3e8a65c0d2f7b1e9a4";
    searchDelegationId(delegationIdQuery(ID)!, ["local"], "A");
    await tick();
    dropDelegationIdSearch("B");
    searchDelegationId(delegationIdQuery(B)!, ["local"], "B");
    dropDelegationIdSearch("A");
    searchDelegationId(delegationIdQuery(ID)!, ["local"], "A");
    replies.shift()!(detail("old result"));
    await drain();
    // B was dropped before its turn (not sent); the second A is sent now and still pending.
    expect(calls.map((c) => c.arg)).toEqual([ID, ID]);
    expect(useDelegationIdSearch.getState().run?.pending).toEqual(["local"]);
    expect(useDelegationIdSearch.getState().hits).toEqual([]);
    replies.shift()!(detail("new result"));
    await drain();
    expect(useDelegationIdSearch.getState().hits.map((h) => h.d.title)).toEqual(["new result"]);
  });

  it("a delegation is shown once per host", async () => {
    apis.set("local", { asks: async () => [row(ID), row(ID)], ask: async () => null });
    apis.set("ws", { asks: async () => [row(ID)], ask: async () => null });
    searchDelegationId(delegationIdQuery("47c47e")!, ["local", "ws"], "k1");
    await drain();
    expect(useDelegationIdSearch.getState().hits.map((h) => h.hostId)).toEqual(["local", "ws"]);
  });

  it("one list read answers abbreviations for a minute on the same connection; a delegation event or reconnection reads again", async () => {
    apis.set("local", { asks: async () => [row(ID)], ask: async () => null });
    const reads = () => calls.filter((c) => c.method === "asks").length;
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const search = async (text: string, key: string, epoch = "e1") => {
      dropDelegationIdSearch(key);
      searchDelegationId(delegationIdQuery(text)!, ["local"], key, { local: epoch });
      await drain();
    };
    await search("47c47e", "k1");
    await search("47c47e1", "k2");
    await search("…f7b1e9a4", "k3");
    expect(reads()).toBe(1);
    expect(useDelegationIdSearch.getState().hits).toHaveLength(1);
    await search("47c47e", "k4", "e2");
    expect(reads()).toBe(2);
    hostEvents.forEach((fn) => fn({ hostId: "local", envelope: { cutex: { method: "cutex/ask/created" } } }));
    await search("47c47e1", "k5", "e2");
    expect(reads()).toBe(3);
    // Another host's event, or a session event, keeps it.
    hostEvents.forEach((fn) => fn({ hostId: "ws", envelope: { cutex: { method: "cutex/ask/created" } } }));
    hostEvents.forEach((fn) => fn({ hostId: "local", envelope: { cutex: { method: "cutex/session/updated" } } }));
    await search("47c47e", "k6", "e2");
    expect(reads()).toBe(3);
    now += LIST_TTL_MS;
    await search("47c47e1", "k7", "e2");
    expect(reads()).toBe(4);
  });

  it("the same search is not sent twice; a failing host is named; a full list says older ones may be missed", async () => {
    apis.set("local", { asks: async () => Array.from({ length: LIST_LIMIT }, (_, i) => row(i === 0 ? ID : `ask-${String(i).padStart(32, "0")}`)), ask: async () => null });
    apis.set("ws", { asks: async () => { throw new Error("unreachable"); }, ask: async () => null });
    searchDelegationId(delegationIdQuery("47c47e")!, ["local", "ws"], "k1");
    searchDelegationId(delegationIdQuery("47c47e")!, ["local", "ws"], "k1");
    await drain();
    expect(calls).toHaveLength(2);
    expect(useDelegationIdSearch.getState().run).toMatchObject({ failed: ["ws"], truncated: true, pending: [] });
    expect(useDelegationIdSearch.getState().hits).toHaveLength(1);
  });

  it("shows at most HITS_MAX matches", async () => {
    apis.set("local", { asks: async () => Array.from({ length: HITS_MAX + 5 }, (_, i) => row(`ask-47c47e${String(i).padStart(26, "0")}`)), ask: async () => null });
    searchDelegationId(delegationIdQuery("47c47e")!, ["local"], "k1");
    await drain();
    expect(useDelegationIdSearch.getState().hits).toHaveLength(HITS_MAX);
  });
});

describe("r296 short-id lookup (asks-short-id-lookup-v1)", () => {
  const SHORT = new Set(["local"]);
  const ARCH = "ask-47c47e99999999999999999999999999";
  beforeEach(() => useDelegations.setState({ byKey: {} }));
  it("a host with the feature is asked by idPrefix, not the list; its hits merge with held rows, one per ask id", async () => {
    const held = row(ID, { title: "held", requester: { kind: "agent", cutexSessionId: "lead", name: "Lead" } });
    const heldOnly = row("ask-0000000000000000000000000047c47e", { title: "held only" });
    useDelegations.setState({ byKey: { [hostKey("local", ID)]: held, [hostKey("local", heldOnly.askId)]: heldOnly } });
    apis.set("local", { asks: async () => { throw new Error("no list read"); }, ask: async () => null,
      askIdLookup: async () => ({ hostId: "local", hasMore: false, asks: [{ askId: ID, title: "from host" }, { askId: ARCH, title: "archived", target: "b", targetName: "B", execution: "answered", closed: "accepted", updatedAt: "2026-10-01T00:00:00Z" }] }) });
    searchDelegationId(delegationIdQuery("#47c47e")!, ["local"], "s1", {}, SHORT);
    await drain();
    expect(calls).toEqual([{ hostId: "local", method: "askIdLookup", arg: ["47c47e", HITS_MAX] }]);
    const hits = useDelegationIdSearch.getState().hits;
    expect(hits.map((h) => h.d.askId).sort()).toEqual([ARCH, ID, heldOnly.askId].sort());
    // The held row wins (it has the requester); an unheld hit keeps the host's fields.
    expect(hits.find((h) => h.d.askId === ID)!.d.title).toBe("held");
    expect(hits.find((h) => h.d.askId === ARCH)!.d).toMatchObject({ title: "archived", targetName: "B", closed: "accepted" });
    expect(useDelegationIdSearch.getState().run).toMatchObject({ hasMore: false, truncated: false, failed: [] });
  });
  it("…suffix is sent as a suffix; hasMore is kept for the hint", async () => {
    apis.set("local", { asks: async () => [], ask: async () => null, askIdLookup: async () => ({ hostId: "local", hasMore: true, asks: [] }) });
    searchDelegationId(delegationIdQuery("…f7b1e9a4")!, ["local"], "s2", {}, SHORT);
    await drain();
    expect(calls[0]).toEqual({ hostId: "local", method: "askIdLookup", arg: ["…f7b1e9a4", HITS_MAX] });
    expect(useDelegationIdSearch.getState().run).toMatchObject({ hasMore: true });
  });
  it("a host without the feature keeps the list read; a missing route falls back to it too", async () => {
    apis.set("local", { asks: async () => [row(ID)], ask: async () => null, askIdLookup: async () => null });
    apis.set("ws", { asks: async () => [], ask: async () => null });
    searchDelegationId(delegationIdQuery("#47c47e")!, ["local", "ws"], "s3", {}, SHORT);
    await drain();
    expect(calls.map((c) => [c.hostId, c.method])).toEqual(expect.arrayContaining([["local", "askIdLookup"], ["ws", "asks"], ["local", "asks"]]));
    expect(calls.length).toBe(3);
    expect(calls.some((c) => c.hostId === "ws" && c.method === "askIdLookup")).toBe(false);
    expect(useDelegationIdSearch.getState().hits.map((h) => h.d.askId)).toEqual([ID]);
  });
  it("a full id is still read by id (GET /v2/asks/{id})", async () => {
    apis.set("local", { asks: async () => [], ask: async () => null, askIdLookup: async () => ({ hostId: "local", hasMore: false, asks: [] }) });
    searchDelegationId(delegationIdQuery(ID)!, ["local"], "s4", {}, SHORT);
    await drain();
    expect(calls.map((c) => c.method)).toEqual(["ask"]);
  });
  it("a changed text drops a lookup in flight: its late reply is ignored", async () => {
    let release: (v: AskIdLookup) => void = () => {};
    apis.set("local", { asks: async () => [], ask: async () => null, askIdLookup: () => new Promise((r) => { release = r; }) });
    searchDelegationId(delegationIdQuery("#47c47e")!, ["local"], "s5", {}, SHORT);
    await drain();
    dropDelegationIdSearch("other");
    release({ hostId: "local", hasMore: true, asks: [{ askId: ID }] });
    await drain();
    expect(useDelegationIdSearch.getState()).toMatchObject({ run: null, hits: [] });
  });
});
