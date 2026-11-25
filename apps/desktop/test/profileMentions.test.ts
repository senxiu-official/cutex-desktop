import {expect,it} from "vitest";
import {profileMentionAt,profileMentionText,profileMentionTokens,profileCascadeQuery,finishProfileCascade} from "../src/renderer/src/lib/profileMentions";
import {composerMentionTokens} from "../src/renderer/src/lib/composerMentionTokens";
import {atomicMentionSelection} from "../src/renderer/src/lib/agentMentionEditor";
it("uses only p@/m@ at word starts, including line boundaries, never an embedded email",()=>{
 for(const s of ["p@","p@Ada","hello p@Ada","hello\nm@ast"])expect(profileMentionAt(s,s.length)).not.toBeNull();
 for(const s of ["ap@x.com","amp@x.com","x.p@A","@agent","hello p@a x"])expect(profileMentionAt(s,s.length)).toBeNull();
 expect(profileMentionAt("p@astra",4)).toEqual({kind:"profile",start:0,end:7,query:"as"});
});
it("round-trips typed plain-text fields and punctuation without agent-name ambiguity",()=>{
 for(const [p,m] of [["Ada","gpt-6-astra"],["Ada",null],[null,"gpt-6-astra"],['a ] , " \\ \n b','m ] , " \\']]){
  const raw=profileMentionText(p ?? null,m ?? null);const [token]=profileMentionTokens("hi "+raw+" done");
  expect(token).toMatchObject({profile:p,model:m,raw,start:3,end:3+raw.length});
  expect(composerMentionTokens(raw)).toHaveLength(1);expect(atomicMentionSelection(raw,2)).toEqual({start:raw.length,end:raw.length});
 }
 expect(profileMentionText("Ada","gpt-6-astra")).toBe('[profile: "Ada", model: "gpt-6-astra"]');
 expect(profileMentionTokens('\\[profile: "literal"]')).toEqual([]);
 expect(profileMentionTokens('[profile: ""] [profile: "bad\\q"]')).toEqual([]);
});
it("keeps unmatched filtering until explicit exit and removes the filter buffer on selection/exit",()=>{
 const raw=profileMentionText("Ada"),cascade={profile:"Ada",start:3,end:3+raw.length,raw};
 const text="use"+raw+"unmatched";
 expect(profileCascadeQuery(text,text.length,cascade)).toBe("unmatched");
 expect(finishProfileCascade(text,text.length,cascade,null,false)).toEqual({text:"use"+raw,caret:3+raw.length});
 const picked=finishProfileCascade(text,text.length,cascade,"gpt-6-astra",true);expect(picked.text).toBe('use[profile: "Ada", model: "gpt-6-astra"] ');
 expect(finishProfileCascade(text,text.length,cascade,null,true).text).toBe("use"+raw+" ");
 expect(profileCascadeQuery("changed",7,cascade)).toBeNull();
});

it("treats nested mention syntax as text inside its outer typed atom",()=>{
 const raw=profileMentionText('[@name](cutex:agent/cutex.01234567-89ab-cdef-0123-456789abcdef)');
 expect(composerMentionTokens(raw)).toMatchObject([{kind:"profile",raw}]);
});

it("round-trips optional effort while default omission preserves existing wire text",()=>{
 const legacy=profileMentionText("Ada","gpt-6-astra");
 expect(profileMentionText("Ada","gpt-6-astra",null)).toBe(legacy);
 for(const profile of ["Ada",null]){
  const raw=profileMentionText(profile,"gpt-6-astra",'custom "] \\ effort');
  expect(profileMentionTokens(raw)).toMatchObject([{profile,model:"gpt-6-astra",effort:'custom "] \\ effort',raw}]);
  expect(atomicMentionSelection(raw,1)).toEqual({start:raw.length,end:raw.length});
 }
 expect(profileMentionTokens('[profile: "Ada", effort: "high"]')).toEqual([]);
 expect(profileMentionTokens('[model: "gpt-6-astra", effort: ""]')).toEqual([]);
});

// Owner 2026-11-24: an ID-only reference left the agent guessing which profile was meant; the name goes along.
const PID = "a4afa1e0-1111-4222-8333-944455556666";
it("writes the name with the ID; model / effort as before; no name when empty or the same as the ID",()=>{
 expect(profileMentionText(PID,null,null,"Ceobe")).toBe(`[profile: "${PID}", name: "Ceobe"]`);
 expect(profileMentionText(PID,"claude-opus-5-5","high","Ceobe")).toBe(`[profile: "${PID}", name: "Ceobe", model: "claude-opus-5-5", effort: "high"]`);
 expect(profileMentionText(PID,null,null,"")).toBe(`[profile: "${PID}"]`);
 expect(profileMentionText(PID,null,null,"  ")).toBe(`[profile: "${PID}"]`);
 expect(profileMentionText("Ada",null,null,"Ada")).toBe('[profile: "Ada"]');
 expect(profileMentionText(null,"gpt-6",null,"Ceobe")).toBe('[model: "gpt-6"]');
 // One line, bounded.
 expect(profileMentionTokens(profileMentionText(PID,null,null,"two\nlines\t here"))[0]!.name).toBe("two lines here");
 const long=profileMentionTokens(profileMentionText(PID,null,null,"x".repeat(200)))[0]!.name!;
 expect([...long]).toHaveLength(64);expect(long.endsWith("…")).toBe(true);
});
it("parses the new and the old form alike (old: no name)",()=>{
 expect(profileMentionTokens(`hi [profile: "${PID}"] x`)).toMatchObject([{profile:PID,name:null,model:null,effort:null}]);
 expect(profileMentionTokens(`hi [profile: "${PID}", name: "Ceobe"] x`)).toMatchObject([{profile:PID,name:"Ceobe",model:null}]);
 expect(profileMentionTokens(`[profile: "${PID}", name: "Ceobe", model: "m", effort: "low"]`)).toMatchObject([{profile:PID,name:"Ceobe",model:"m",effort:"low"}]);
 expect(profileMentionTokens(`[profile: "${PID}", model: "m"]`)).toMatchObject([{profile:PID,name:null,model:"m"}]);
 // A name only follows a profile, and only in that place.
 expect(profileMentionTokens('[model: "m", name: "x"]')).toEqual([]);
 expect(profileMentionTokens(`[profile: "${PID}", model: "m", name: "x"]`)).toEqual([]);
 // An empty written name is no name.
 expect(profileMentionTokens(`[profile: "${PID}", name: ""]`)).toMatchObject([{profile:PID,name:null}]);
});
it("escapes quotes, backslashes, brackets and lookalike fields in the name; round-trips exactly",()=>{
 for(const name of ['Ce"obe','back\\slash \\','a ], model: "evil"','[profile: "x"]','曲 · 名']){
  const raw=profileMentionText(PID,"gpt-6",null,name);
  const tokens=profileMentionTokens("x "+raw+" y");
  expect(tokens).toHaveLength(1);
  expect(tokens[0]).toMatchObject({profile:PID,name,model:"gpt-6",raw});
  expect(composerMentionTokens(raw)).toHaveLength(1);
 }
});
it("the model / effort steps keep the name picked with the profile",()=>{
 const raw=profileMentionText(PID,null,null,"Ceobe"),cascade={profile:PID,name:"Ceobe",start:0,end:raw.length,raw};
 expect(finishProfileCascade(raw,raw.length,cascade,"claude-opus-5-5",false,"high").text).toBe(`[profile: "${PID}", name: "Ceobe", model: "claude-opus-5-5", effort: "high"]`);
});
