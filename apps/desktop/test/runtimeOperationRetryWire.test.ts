import { expect, it, vi } from "vitest";
vi.mock("electron", () => ({BrowserWindow:{getFocusedWindow:()=>null,getAllWindows:()=>[]},dialog:{},shell:{}}));
import { CutexClient } from "@cutex-desktop/cutex-client";
import { DaemonService } from "../src/main/daemon";
it("uses the existing cutex subset routes for retry and never widens a failed-agent retry to all",async()=>{
  const client=new CutexClient({baseUrl:"http://127.0.0.1:1",token:"fixture"} as never);
  const request=vi.spyOn(client,"request").mockResolvedValue({run:{runId:"rpu-fixture"}} as never);
  const daemon=new DaemonService(()=>{});Object.assign(daemon,{client});
  await daemon.startRuntimePackageRun(["cutex.failed"]);
  expect(request).toHaveBeenLastCalledWith("POST","/v2/runtime-packages/runs",{body:{agentIds:["cutex.failed"]}});
  await daemon.revertRuntimePackageRun("rpu-original",["cutex.failed"]);
  expect(request).toHaveBeenLastCalledWith("POST","/v2/runtime-packages/runs/rpu-original/revert",{body:{agentIds:["cutex.failed"]}});
  const calls=request.mock.calls.length;
  await expect(daemon.startRuntimePackageRun([])).rejects.toThrow("bad agent ids");
  await expect(daemon.startRuntimePackageRun(["../other"])).rejects.toThrow("bad agent id");
  expect(request).toHaveBeenCalledTimes(calls);
  await daemon.startRuntimePackageRun();
  expect(request).toHaveBeenLastCalledWith("POST","/v2/runtime-packages/runs",{body:{all:true}});
});
