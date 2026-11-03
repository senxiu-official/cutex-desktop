// @vitest-environment jsdom
import {act,createElement as h} from "react";
import {createRoot} from "react-dom/client";
import {expect,it,vi} from "vitest";
vi.mock("../src/renderer/src/i18n",async original=>{
  const actual=await original<object>();const {zhCN}=await import("../src/renderer/src/i18n/zh-CN");
  return {...actual,useI18n:()=>({t:(key:string)=>(zhCN as Record<string,string>)[key],locale:"zh-CN"})};
});
import {HostBusyActions} from "../src/renderer/src/components/HostBusyActions";
import {useHostBusyActions} from "../src/renderer/src/lib/hostBusyActions";
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it("shows host busy while retrying and retains a real retry button after exhaustion",()=>{
  const div=document.createElement("div");document.body.append(div);const root=createRoot(div),retry=vi.fn();
  const row={key:"one",hostId:"local",sessionId:"a1",name:"Alpha",kind:"runtimeStart" as const,state:"retrying" as const,retry};
  try{
    act(()=>{useHostBusyActions.setState({rows:[row]});root.render(h(HostBusyActions));});
    expect(div.textContent).toContain("主机正忙，正在重试");expect(div.textContent).not.toMatch(/正在启动|已暂停|运行时拒绝/);
    expect(div.querySelector("button")).toBeNull();
    act(()=>useHostBusyActions.setState({rows:[{...row,state:"exhausted"}]}));
    expect(div.textContent).toContain("主机一直忙，稍后再试");
    const button=[...div.querySelectorAll("button")].find(b=>b.textContent==="重试")!;
    act(()=>button.click());expect(retry).toHaveBeenCalledOnce();
    act(()=>useHostBusyActions.setState({rows:[{...row,state:"cancelled"}]}));
    expect(div.textContent).toContain("操作未执行");expect([...div.querySelectorAll("button")].some(b=>b.textContent==="重试")).toBe(false);
    act(()=>useHostBusyActions.setState({rows:[{...row,state:"uncertain",detail:"request_outcome_unknown"}]}));
    expect(div.textContent).toContain("无法确认操作结果");expect(div.textContent).not.toContain("操作未执行");
    expect([...div.querySelectorAll("button")].some(b=>b.textContent==="重试")).toBe(false);
  }finally{act(()=>root.unmount());div.remove();useHostBusyActions.setState({rows:[]});}
});
