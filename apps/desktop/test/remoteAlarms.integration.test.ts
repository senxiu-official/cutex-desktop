// Real isolated debug daemons only. Set CUTEX_PRIVATE_ALARMS_IT to an inventory of two
// marked private homes, management ports and session IDs. No Electron process is launched.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, openSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("electron",()=>({shell:{openExternal:async()=>{}}}));
const {DaemonService}=await import("../src/main/daemon");
const inventory=process.env.CUTEX_PRIVATE_ALARMS_IT;
describe.skipIf(!inventory)("private dual-daemon alarm recovery",()=>{
 let local:InstanceType<typeof DaemonService>,remote:InstanceType<typeof DaemonService>;
 let records:any[],proxy:ReturnType<typeof createServer>;let upgraded=false;
 const events:Array<{event:string;payload:any}>=[];const streams=new Set<any>();
 beforeAll(async()=>{
  records=JSON.parse(readFileSync(inventory!,"utf8").replace(/^\uFEFF/,""));expect(records).toHaveLength(2);
  for(const r of records){expect(existsSync(join(r.home,".cutex-test-private-home"))).toBe(true);expect(r.management).toBeGreaterThan(24700);expect(r.management).toBeLessThan(25000);r.token=JSON.parse(readFileSync(join(r.home,".cutex/config.json"),"utf8").replace(/^\uFEFF/,"")).management_api_token;}
  proxy=createServer(async(req,res)=>{
   const controller=new AbortController();res.on("close",()=>controller.abort());streams.add(res);res.on("close",()=>streams.delete(res));
   try{
    const reply=await fetch(`http://127.0.0.1:${records[1].management}${req.url}`,{headers:{authorization:`Bearer ${records[1].token}`},signal:controller.signal});
    if(req.url?.startsWith("/v2/capabilities")){
     const caps:any=await reply.json();if(upgraded)caps.featureList=[...caps.featureList,"alarm-reconnect-probe-v1"];
     res.writeHead(reply.status,{"content-type":"application/json"});res.end(JSON.stringify(caps));
    }else{const headers=Object.fromEntries([...reply.headers].filter(([key])=>!["content-length","content-encoding","transfer-encoding"].includes(key)));res.writeHead(reply.status,headers);if(reply.body)Readable.fromWeb(reply.body as any).on("error",()=>res.destroy()).pipe(res);else res.end();}
   }catch{res.destroy();}
  });
  await new Promise<void>(r=>proxy.listen(0,"127.0.0.1",r));const port=(proxy.address() as any).port;
  local=new DaemonService(()=>{});remote=new DaemonService((event,payload)=>events.push({event,payload}));
  local.useEndpoint({baseUrl:`http://127.0.0.1:${records[0].management}`,token:records[0].token,configPath:join(records[0].home,".cutex/config.json")},{remote:false});
  remote.useEndpoint({baseUrl:`http://127.0.0.1:${port}`,token:records[1].token,configPath:join(records[1].home,".cutex/config.json")},{remote:true});
  await vi.waitFor(()=>{expect(local.currentState.kind).toBe("connected");expect(remote.currentState.kind).toBe("connected");expect(events.some(e=>e.event==="hostResync")).toBe(true);},{timeout:20000,interval:100});
 },30000);
 afterAll(async()=>{local?.stop();remote?.stop();for(const stream of streams)stream.destroy();if(proxy)await new Promise<void>(r=>proxy.close(()=>r()));});
 it("retains both real alarms, then refreshes capabilities across a fast remote daemon restart",async()=>{
  expect((await local.alarms({sessionId:records[0].sessionId,state:"all",limit:100}))?.alarms.filter(a=>a.state==="scheduled")).toHaveLength(1);
  expect((await remote.alarms({sessionId:records[1].sessionId,state:"all",limit:100}))?.alarms.filter(a=>a.state==="scheduled")).toHaveLength(1);
  expect((await remote.capabilities())?.featureList).not.toContain("alarm-reconnect-probe-v1");
  const before=events.filter(e=>e.event==="hostResync").length;events.length=0;
  upgraded=true;for(const stream of streams)stream.destroy();
  const previousPid=JSON.parse(readFileSync(inventory!,"utf8").replace(/^\uFEFF/,""))[1].managementPid;
  const launcher=spawn(process.env.CUTEX_PRIVATE_ALARMS_PWSH??"pwsh",["-NoProfile","-File",resolve(import.meta.dirname,"../../../scripts/qa-remote-alarm-restart.ps1"),"-InventoryPath",inventory!,"-Name","b"],{windowsHide:true,stdio:["ignore",openSync(join(dirname(inventory!),"restart.out"),"a"),openSync(join(dirname(inventory!),"restart.err"),"a")]});
  writeFileSync(join(dirname(inventory!),"restart-launcher.pid"),String(launcher.pid));launcher.on("error",error=>writeFileSync(join(dirname(inventory!),"restart-spawn-error.txt"),String(error)));launcher.on("exit",code=>writeFileSync(join(dirname(inventory!),"restart-spawn-exit.txt"),String(code)));launcher.unref();
  await vi.waitFor(()=>expect(JSON.parse(readFileSync(inventory!,"utf8").replace(/^\uFEFF/,""))[1].managementPid).not.toBe(previousPid),{timeout:10000,interval:100});
  await vi.waitFor(()=>expect(events.filter(e=>e.event==="hostResync").length).toBeGreaterThanOrEqual(1),{timeout:30000,interval:100});
  expect(before).toBeGreaterThanOrEqual(1);
  await vi.waitFor(async()=>expect((await remote.capabilities())?.featureList).toContain("alarm-reconnect-probe-v1"),{timeout:15000,interval:100});
  expect((await local.capabilities())?.featureList).not.toContain("alarm-reconnect-probe-v1");
  expect((await remote.alarms({sessionId:records[1].sessionId,state:"all",limit:100}))?.alarms.filter(a=>a.state==="scheduled")).toHaveLength(1);
  expect(events.filter(e=>e.event==="daemonState"&&e.payload.kind!=="connected")).toEqual([]);
 },40000);
});
