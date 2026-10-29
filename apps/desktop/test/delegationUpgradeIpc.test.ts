import {expect,it,vi} from "vitest";
import {readFileSync} from "node:fs";
vi.mock("electron",()=>({BrowserWindow:{getFocusedWindow:()=>null,getAllWindows:()=>[]},dialog:{},shell:{}}));
import {CutexClient} from "@cutex-desktop/cutex-client";
import {DaemonService} from "../src/main/daemon";
function fixture(featureList:string[]=[]){const fetch=vi.fn(async(input:RequestInfo|URL)=>String(input).endsWith("/v2/capabilities")?Response.json({hostId:"canonical",featureList}):Response.json({schema:"cutex.delegation-operation.v1",actionId:"stable",status:"notFound",outcomeUnknown:true,result:null}));const daemon=new DaemonService(()=>{});(daemon as any).client=new CutexClient({baseUrl:"http://fixture.invalid",token:"synthetic"},{fetch});return {daemon,fetch}}
it("aggregate IPC method uses real client discovery on an old host without new route",async()=>{const {daemon,fetch}=fixture();expect(await daemon.delegationUpgradeSnapshot("project")).not.toHaveProperty("revision");expect(fetch).toHaveBeenCalledTimes(1)});
it("IPC lookup remains a read-only canonical route",async()=>{const {daemon,fetch}=fixture(["delegation-routing-v1"]);expect(await daemon.delegationUpgradeOperation("stable")).toMatchObject({status:"notFound",outcomeUnknown:true,result:null});expect(String(fetch.mock.calls[1]![0])).toBe("http://fixture.invalid/v2/delegation-operations/stable")});
it("aggregate and raw methods are explicit in both narrow IPC allowlists",()=>{for(const file of ["../src/main/index.ts","../src/preload/index.ts"]){const source=readFileSync(new URL(file,import.meta.url),"utf8");for(const name of ["delegationUpgradeSnapshot","delegationUpgradeAction","delegationUpgradeApproval","delegationUpgradeOperation","delegationRetirementReview"]){expect(source).toContain(`"${name}",`)}}});

it("raw client methods are absent from renderer bridge and daemon facade",()=>{
 const raw=["delegationTree","delegationAttempts","delegationPolicy","delegationGrants","delegationApprovals","delegationApproval","projectRunControl","delegationOperation","delegationControl","permanentRetirementReview","permanentRetirement"];
 for(const file of ["../src/main/index.ts","../src/preload/index.ts"]){const source=readFileSync(new URL(file,import.meta.url),"utf8");for(const name of raw)expect(source).not.toContain(`"${name}",`)}
 const ipc=readFileSync(new URL("../src/shared/ipc.ts",import.meta.url),"utf8");for(const name of raw){expect(ipc).not.toContain(`  ${name}(`);expect(name in DaemonService.prototype).toBe(false)}
});

it("routing inbox reads only the pending approvals of its explicit project", async () => {
 const fetch = vi.fn(async (_input: RequestInfo | URL) => Response.json({ routingApprovals: [] }));
 const daemon = new DaemonService(() => {});
 (daemon as any).client = new CutexClient({ baseUrl: "http://fixture.invalid", token: "synthetic" }, { fetch });
 expect(await daemon.delegationRoutingApprovals("project-a")).toEqual([]);
 expect(String(fetch.mock.calls[0]![0])).toBe("http://fixture.invalid/v2/projects/project-a/delegation-approvals?state=pending");
 await expect(daemon.delegationRoutingApprovals("../other")).rejects.toThrow("bad project identifier");
 expect(fetch).toHaveBeenCalledTimes(1);
 for (const file of ["../src/main/index.ts", "../src/preload/index.ts"]) expect(readFileSync(new URL(file, import.meta.url), "utf8")).toContain('"delegationRoutingApprovals",');
});
