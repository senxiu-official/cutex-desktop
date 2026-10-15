import { describe, expect, it } from 'vitest';
import { createModuleHost, type ModuleContext, type SlotItemBase } from '../src/index.js';
type Slots = { entries: SlotItemBase };
const target = { id:'a',kind:'local' as const,features:new Set<string>() };
const slots = { entries:{unavailable:'hide' as const} };
const tick = async () => { for(let i=0;i<30;i++) await Promise.resolve(); };
describe('published mainline parallel activation contract',()=>{
 it('a pending module holds only its dependents, not independent modules',async()=>{
  let release!:()=>void; const calls:string[]=[];
  const host=createModuleHost<Slots>({host:target,slots,modules:[
   {id:'slow',titleKey:'slow',activate:()=>new Promise<void>(resolve=>{release=resolve;calls.push('slow')})},
   {id:'child',titleKey:'child',requires:{modules:['slow']},activate:()=>{calls.push('child')}},
   {id:'independent',titleKey:'independent',activate:()=>{calls.push('independent')}},
  ]});
  try {await tick();expect(calls).toEqual(['slow','independent']);expect(host.statuses().independent?.state.kind).toBe('active');
   expect(host.statuses().slow?.state.kind).toBe('activating');release();await host.ready;expect(calls).toEqual(['slow','independent','child']);
  }finally{release?.();await host.dispose()}
 });
 it('host switching cancels every concurrently pending activation and fences late contributions',async()=>{
  const old:ModuleContext<Slots>[]=[];const releases:(()=>void)[]=[];
  const host=createModuleHost<Slots>({host:target,slots,modules:['one','two'].map(id=>({id,titleKey:id,activate(ctx){
   if(ctx.host.id==='a'){old.push(ctx);return new Promise<void>(resolve=>releases.push(resolve))}
   ctx.contribute('entries',{id:`${id}.ready`});
  }}))});
  try {await tick();expect(old).toHaveLength(2);await host.setHost({...target,id:'b'});expect(old.every(ctx=>ctx.signal.aborted)).toBe(true);
   for(const ctx of old)expect(()=>ctx.contribute('entries',{id:`${ctx.id}.late`})).toThrow(/stopped/);
   releases.forEach(release=>release());await host.ready;expect(host.snapshot('entries').map(entry=>entry.item.id)).toEqual(['one.ready','two.ready']);
  }finally{releases.forEach(release=>release());await host.dispose()}
 });
});
