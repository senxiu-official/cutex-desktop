import { describe, expect, it, vi } from "vitest";
import type { CutexClient } from "@cutex-desktop/cutex-client";
import { forkPreview, forkRequestParams, forkResult } from "../src/main/sessionFork";
describe("fork bridge", () => {
 it("keeps a committed fork with null size and structured warnings, ignoring malformed optional entries",()=>{
   const warning = {code:"claude_runtime_restart_failed",message:"Backend English",runtimeState:"failed",restartError:null};
   expect(forkResult({newCutexSessionId:"new",historyBytes:null,warnings:[warning, null, 4, {message:"no code"}]})).toEqual({cutexSessionId:"new",historyBytes:null,warnings:[warning]});
   expect(forkResult({newCutexSessionId:"new",warnings:["old note",{code:"future",extra:"ignored"}]}).warnings).toEqual([{code:"legacy",message:"old note"},{code:"future",message:""}]);
 });
 it("keeps legacy params unchanged and sends only an explicitly chosen profile",()=>{
   expect(forkRequestParams({afterTurnId:"turn"})).toEqual({afterTurnId:"turn"});
   expect(forkRequestParams({profile:"target",name:" New "})).toEqual({afterTurnId:null,name:"New",profile:"target"});
   for(const profile of ["", " target", "bad\nname",42]) expect(()=>forkRequestParams({profile} as never)).toThrow("invalid fork profile");
 });
 it("preserves additive provenance facts and accepts old result shapes",()=>{
   expect(forkResult({newCutexSessionId:"new",historyBytes:2048,coldCache:true,profile:"b",sourceProfile:"a",forkBoundaryNote:"source obligations",warnings:[{code:"fork_history_size_unavailable",message:"note"}]})).toEqual({cutexSessionId:"new",historyBytes:2048,coldCache:true,profile:"b",sourceProfile:"a",forkBoundaryNote:"source obligations",warnings:[{code:"fork_history_size_unavailable",message:"note"}]});
   expect(forkResult({session:{cutexSessionId:"old"}})).toEqual({cutexSessionId:"old"});
   expect(forkResult({cutexSessionId:"old",historyBytes:-1,coldCache:"yes"})).toEqual({cutexSessionId:"old"});
   expect(()=>forkResult({})).toThrow("no session");
 });
 it("previews using a read-only fixed host route, with the selected boundary and profile",async()=>{
   const request=vi.fn(async()=>({contractVersion:2}));
   await forkPreview({request} as unknown as CutexClient,"cutex.id",{afterTurnId:"turn",profile:"target"});
   expect(request).toHaveBeenCalledWith("GET","/v2/sessions/cutex.id/fork-preview",{query:{afterTurnId:"turn",profile:"target"}});
   expect(()=>forkPreview({request} as unknown as CutexClient,"../other",{})).toThrow();
   expect(()=>forkPreview({request} as unknown as CutexClient,"cutex.id",{arbitrary:true} as never)).toThrow();
   expect(()=>forkPreview({request} as unknown as CutexClient,"cutex.id",{profile:"bad\nvalue"})).toThrow();
 });
});
