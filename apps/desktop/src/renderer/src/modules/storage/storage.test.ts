import { describe, expect, it, vi } from "vitest";
import { CutexApiError, type CutexClient } from "@cutex-desktop/cutex-client";
import { storageApi } from "../../../../main/storage";
import type { StorageApi, StorageItemsPage, StorageOverview } from "../../../../shared/storage";
import { StorageController } from "./controller";
import { zhCN } from "./i18n";
import { en } from "./i18n.en";
import { zhHantCN } from "./i18n.locales";
import { storageFixture as mockStorageView } from "./testFixtures";
import { formatBytes, measuredAgo, needsRefresh, retentionText } from "./model";

const t = (key: string, vars: Record<string, string | number> = {}) => (en as Record<string,string>)[key]!.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? `{${key}}`));
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes,no) => { resolve=yes; reject=no; }); return { promise, resolve, reject }; }
function api(overrides: Partial<StorageApi> = {}): StorageApi { return { storage: vi.fn(async () => mockStorageView()), storageRefresh: vi.fn(async () => ({ state: "running" as const, startedAt: new Date().toISOString() })), storageItems: vi.fn(async (store) => ({ store, items: [], nextCursor: null })), ...overrides }; }

describe("storage presentation", () => {
  it("formats zero, binary units and missing sizes", () => {
    expect(formatBytes(0)).toBe("0 B"); expect(formatBytes(1024)).toBe("1 KiB"); expect(formatBytes(1.5 * 1024 ** 3)).toBe("1.5 GiB");
    expect(formatBytes(NaN)).toBe("—"); expect(formatBytes(-1)).toBe("—");
  });
  it("states measurement age, including future or absent timestamps", () => {
    const now=Date.parse("2026-10-24T10:00:00Z");
    expect(measuredAgo(null,now,t)).toBe("Not measured yet"); expect(measuredAgo("bad",now,t)).toBe("Not measured yet");
    expect(measuredAgo("2026-10-24T08:00:00Z",now,t)).toBe("Measured 2 h ago");
    expect(measuredAgo("2026-10-24T10:01:00Z",now,t)).toBe("Measured just now");
  });
  it("uses the oldest walked store for the six-hour refresh rule", () => {
    const view=mockStorageView(); expect(needsRefresh(view)).toBe(false);
    view.stores[0]!.measuredAt=new Date(Date.now()-7*3600_000).toISOString(); expect(needsRefresh(view)).toBe(true);
    view.walk.state="running"; expect(needsRefresh(view)).toBe(false);
    view.walk.state="idle"; view.stores[0]!.measuredAt=null; expect(needsRefresh(view)).toBe(true);
  });
  it("describes permanent references, archival and code-provided limits without editing controls", () => {
    const base=mockStorageView().stores[0]!.retention;
    expect(retentionText({...base,rule:"forever",keepReferenced:true},t)).toBe("Referenced data is kept forever");
    expect(retentionText({...base,rule:"archive",days:30},t)).toBe("Archived 30 days after closing");
    expect(retentionText({...base,rule:"rotate",minHours:24},t)).toContain("24 hours");
    expect(retentionText({...base,rule:"size",maxBytes:1024},t)).toContain("1 KiB");
    expect(retentionText({...base,rule:"future"},t)).toBe("Retention rule not recognized");
  });
  it("ships complete English and Traditional Chinese keys", () => { expect(Object.keys(en)).toEqual(Object.keys(zhCN)); expect(Object.keys(zhHantCN)).toEqual(Object.keys(zhCN)); });
});

describe("host-bound request lifecycle", () => {
  it("drops an old host's response after stop and does not notify listeners", async () => {
    const late=deferred<StorageOverview|null>(); const controller=new StorageController(api({storage:()=>late.promise}));
    controller.start(); const waiting=controller.load(); controller.stop(); const snapshot=controller.getSnapshot(); const listener=vi.fn(); controller.subscribe(listener);
    late.resolve(mockStorageView("old-host")); await waiting;
    expect(controller.getSnapshot()).toBe(snapshot); expect(listener).not.toHaveBeenCalled();
  });
  it("keeps a newer read when an earlier read completes last", async () => {
    const first=deferred<StorageOverview|null>(), second=deferred<StorageOverview|null>();
    const read=vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const controller=new StorageController(api({storage:read})); controller.start(); const a=controller.load(), b=controller.load();
    second.resolve(mockStorageView("new")); await b; first.resolve(mockStorageView("old")); await a;
    expect(controller.getSnapshot().view?.host).toBe("new");
  });
  it("invalidates an in-flight detail when it is closed or another store is opened", async () => {
    const late=deferred<StorageItemsPage>(); const controller=new StorageController(api({storageItems:()=>late.promise})); controller.start();
    const waiting=controller.openDetails("light-homes"); controller.closeDetails(); late.resolve({store:"light-homes",items:[],nextCursor:null}); await waiting;
    expect(controller.getSnapshot().detail).toBeNull();
  });
  it("appends cursor pages, deduplicates overlapping items and keeps errors visible", async () => {
    const request=vi.fn().mockResolvedValueOnce({store:"a",items:[{id:"one"}],nextCursor:"1"}).mockResolvedValueOnce({store:"a",items:[{id:"one"},{id:"two"}],nextCursor:null});
    const controller=new StorageController(api({storageItems:request})); controller.start(); await controller.openDetails("a"); await controller.openDetails("a",true);
    expect(request.mock.calls[1]?.[1]).toMatchObject({cursor:"1",limit:50}); expect(controller.getSnapshot().detail?.items.map((i)=>i.id)).toEqual(["one","two"]);
    request.mockRejectedValueOnce(new Error("owner_required")); await controller.openDetails("a"); expect(controller.getSnapshot().detail?.error).toBe("owner_required");
  });
  it("attempts automatic refresh once and resets a pending mutation on reconnect", async () => {
    const view=mockStorageView(); view.stores[0]!.measuredAt=null;
    const write=deferred<{state:"running";startedAt:string}>(); const refresh=vi.fn(()=>write.promise);
    const controller=new StorageController(api({storage:async()=>view,storageRefresh:refresh})); controller.start(); const waiting=controller.load(true);
    await Promise.resolve(); expect(controller.getSnapshot().refreshing).toBe(true);
    controller.stop(); controller.start(); expect(controller.getSnapshot().refreshing).toBe(false);
    write.resolve({state:"running",startedAt:"now"}); await waiting; expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("reports unsupported hosts and preserves refresh errors", async () => {
    const controller=new StorageController(api({storage:async()=>null,storageRefresh:async()=>{throw new Error("offline");}})); controller.start(); await controller.load(); expect(controller.getSnapshot().unsupported).toBe(true);
    await controller.refresh(); expect(controller.getSnapshot().error).toBe("offline");
  });
});

describe("main storage transport", () => {
  function client() { const request=vi.fn().mockResolvedValue({}); return {request, facade:storageApi({request} as unknown as Pick<CutexClient,"request">)}; }
  it("uses only fixed storage routes and forwards selective ids / opaque cursors", async () => {
    const {request,facade}=client(); await facade.storage(); await facade.storageRefresh(["light-homes","light-homes"]); await facade.storageItems("light-homes",{limit:50,cursor:"50"});
    expect(request.mock.calls).toEqual([["GET","/v2/storage"],["POST","/v2/storage/refresh",{body:{stores:["light-homes"]}}],["GET","/v2/storage/stores/light-homes/items",{query:{sort:"bytes",limit:50,cursor:"50"}}]]);
  });
  it("rejects traversal, arbitrary query keys, invalid cursor and oversized pages before transport", () => {
    const {request,facade}=client();
    for (const id of ["../config","a/b","%2e%2e","a?x=1"]) expect(()=>facade.storageItems(id)).toThrow();
    for (const query of [{limit:501},{limit:0},{cursor:"-1"},{cursor:"1e9"},{cursor:"9999999999999999"},{path:"/secret"}]) expect(()=>facade.storageItems("light-homes",query as never)).toThrow();
    expect(()=>facade.storageRefresh([])).toThrow(); expect(()=>facade.storageRefresh(["../config"])).toThrow(); expect(request).not.toHaveBeenCalled();
  });
  it("maps missing overview routes to unsupported and preserves permission / network failures", async () => {
    const {request,facade}=client(); request.mockRejectedValueOnce(new CutexApiError(404,"not_found","old host")); expect(await facade.storage()).toBeNull();
    request.mockRejectedValueOnce(new CutexApiError(403,"owner_required","owner only")); await expect(facade.storage()).rejects.toThrow("owner_required");
    request.mockRejectedValueOnce(new Error("offline")); await expect(facade.storage()).rejects.toThrow("offline");
  });
});
