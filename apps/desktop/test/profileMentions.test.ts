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
