// @vitest-environment jsdom
import {it,expect,vi} from 'vitest';
vi.mock('../src/renderer/src/bridge',()=>({
  api:{}, apiFor:()=>({}), onEvent:()=>()=>{}, cleanIpcMessage:(x:string)=>x,
  bridge:{on:()=>()=>{}}
}));
import {inputSegments,hasReferenceToken} from '../src/shared/inputPreview';
import {queueItemText} from '../src/renderer/src/store';
it.each([['','a',''],['a\r\n','','b\r\n'],['','',''],['a','b','c']])('text parts preserve exact empty/CRLF bytes: %j',(a:string,b:string,c:string)=>{
  const texts=[a,b,c],parts=texts.map(text=>({type:'text',text}));
  expect(queueItemText({input:parts} as never)).toBe(texts.join('\n'));
  const mixed=[parts[0]!,{type:'image',url:'data:image/png;base64,AAAA'},{type:'localImage',path:'/a.png'},{type:'skill',name:'review',path:'/s/review'},{type:'mention',name:'file',path:'/f'},...parts.slice(1)];
  expect(queueItemText({input:mixed.filter(x=>x.type==='text')} as never)).toBe(texts.join('\n'));
});
it('Unicode reference prefixes do not suppress a different attachment',()=>{
  expect(hasReferenceToken('比较 @计划书.md','@计划')).toBe(false);
  expect(inputSegments([{type:'text',text:'比较 @计划书.md'},{type:'mention',name:'计划',path:'/w/计划'}]).filter(x=>x.kind==='ref')).toHaveLength(1);
});

