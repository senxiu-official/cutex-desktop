import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { imageInputItems, messageInputItems } from "../src/shared/input";
const f = vi.hoisted(() => ({ fetch: vi.fn(), decode: vi.fn() }));
vi.mock("electron", () => ({ app: {}, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, shell: {}, nativeImage: { createFromBuffer: f.decode } }));
vi.mock("../src/main/errorLog", () => ({ logError: vi.fn() }));
vi.mock("@cutex-desktop/cutex-client", async original => {
  const sdk = await original<typeof import("@cutex-desktop/cutex-client")>();
  return { ...sdk, CutexClient: class extends sdk.CutexClient {
    constructor(endpoint: any) { super(endpoint, { fetch: f.fetch }); }
    host(): Promise<any> { return new Promise(() => {}); }
  } };
});
import { DaemonService } from "../src/main/daemon";
// Unmodified cutex 002f0cdbfd7ab273f9225ce2ce8b045727fa3d67 schema snapshot.
const schema = JSON.parse(readFileSync(new URL("./fixtures/r259-cutex-methods-v2.json", import.meta.url), "utf8"));
const validate = new Ajv2020({ strict: false, validateFormats: false }).compile({ $schema: schema.$schema, $defs: schema.$defs, $ref: "#/$defs/userInputSubmitted" });
// r259 EventBlobStore::media recursively externalizes >32KiB data URLs before
// validating cutex/userInput/submitted. Model only this wire-boundary transformation.
function persisted(x: any): any {
  if (typeof x === "string" && x.length > 32768 && x.startsWith("data:image/")) {
    const bytes = Buffer.from(x.split(",")[1]!, "base64"), sha = createHash("sha256").update(bytes).digest("hex");
    return { type: "cutexBlob", blobId: sha, sha256: sha, mime: "image/png", size: bytes.length, url: `cutex-blob:cutex.test/${sha}` };
  }
  if (Array.isArray(x)) return x.map(persisted);
  return x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k,v]) => [k,persisted(v)])) : x;
}
const receipt = (input: any[], origin = { kind: "other", clientId: "fixture" }) => ({ managementRequestId: "fixture-request", clientUserMessageId: "fixture-message", origin, input, disposition: "started", nativeRequestId: "fixture-native", nativeMethod: "turn/start", appServerAccepted: true, submittedAt: "2026-10-25T00:00:00Z" });
const bytes = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(272235-8,42)]);
const url = `data:image/png;base64,${bytes.toString("base64")}`;
let service: DaemonService, requests: any[], uploads: any[];
beforeEach(() => {
  requests=[]; uploads=[]; f.decode.mockReset().mockReturnValue({ isEmpty: () => false, toPNG: () => bytes });
  f.fetch.mockReset().mockImplementation(async (raw: string | URL, init: RequestInit) => {
    const path = new URL(String(raw)).pathname;
    if (path.endsWith("/attachments")) {
      const uploaded={path:"/host/session-attachments/image.png",bytes:new Uint8Array(init.body as Uint8Array),mime:new Headers(init.headers).get("content-type")}; uploads.push(uploaded);
      return Response.json({path:uploaded.path,mime:uploaded.mime,size:uploaded.bytes.length});
    }
    if (path.endsWith("/cutex/requests")) {
      const body=JSON.parse(String(init.body)); requests.push(body);
      if (!validate(persisted(receipt(body.params.input,body.params.origin)))) return Response.json({error:{code:"event_persistence_unavailable",message:JSON.stringify(validate.errors)}},{status:500});
      return Response.json({cutex:{result:{accepted:true,disposition:"started"}}});
    }
    if (path.includes("/blobs/")) return new Response(bytes, { headers: { "Content-Type": "image/png" } });
    throw new Error(`Unexpected fixture route: ${path}`);
  });
  service=new DaemonService(()=>{});
});
afterEach(()=>service.stop());
it("reproduces r259: valid inline request becomes an invalid persisted image.url object",()=>{
  const original=receipt([{type:"image",url}]);
  expect(validate(original),JSON.stringify(validate.errors)).toBe(true);
  expect(validate(persisted(original))).toBe(false);
  expect(validate.errors?.some(e=>e.instancePath.endsWith("/url")&&e.keyword==="type")).toBe(true);
});
it.each([false,true])("real composer/main/SDK uploads large paste on remote=%s and passes r259 persistence schema",async remote=>{
  service.useEndpoint({baseUrl:"http://fixture.invalid",token:"fake"} as any,{remote});
  const extra=imageInputItems([{id:"draft",name:"screenshot.png",preview:url,source:{kind:"data",url}}]);
  await expect(service.submit("cutex.test","look","auto",false,{extra})).resolves.toMatchObject({accepted:true});
  expect(uploads).toHaveLength(1); expect(Buffer.from(uploads[0].bytes)).toEqual(bytes);
  expect(requests[0].params.input).toEqual([{type:"text",text:"look",text_elements:[]},{type:"localImage",path:uploads[0].path}]);
  expect(extra).toEqual([{type:"image",url}]);
});
it("upload rejection never falls back to broken inline submit",async()=>{
  service.useEndpoint({baseUrl:"http://fixture.invalid",token:"fake"} as any,{remote:false});
  f.fetch.mockResolvedValueOnce(Response.json({error:{code:"attachment_too_large",message:"limit"}},{status:413}));
  await expect(service.submit("cutex.test","","auto",false,{extra:[{type:"image",url}]})).rejects.toThrow();
  expect(requests).toHaveLength(0);
});

it("image-only queue input also uploads before entering typed management receipts", async () => {
  service.useEndpoint({baseUrl:"http://fixture.invalid",token:"fake"} as any,{remote:false});
  await service.submit("cutex.test","","queue",false,{extra:[{type:"image",url}]});
  expect(requests[0].params.strategy).toBe("queue");
  expect(requests[0].params.input).toEqual([{type:"localImage",path:uploads[0].path}]);
});
it("local resend resolves a source blob then uploads to the target without reintroducing inline data", async () => {
  service.useEndpoint({baseUrl:"http://fixture.invalid",token:"fake"} as any,{remote:false});
  const sha=createHash("sha256").update(bytes).digest("hex");
  const extra=messageInputItems([{kind:"blob",blob:{type:"cutexBlob",blobId:sha,sha256:sha,mime:"image/png",size:bytes.length,url:`cutex-blob:cutex.source/${sha}`}}]);
  await service.submit("cutex.test","","auto",false,{extra});
  expect(uploads).toHaveLength(1); expect(Buffer.from(uploads[0].bytes)).toEqual(bytes);
  expect(requests[0].params.input).toEqual([{type:"localImage",path:uploads[0].path}]);
});
it("BMP inline input uses native PNG conversion because the attachment endpoint accepts PNG/JPEG/GIF/WebP", async () => {
  service.useEndpoint({baseUrl:"http://fixture.invalid",token:"fake"} as any,{remote:false});
  await service.submit("cutex.test","","auto",false,{extra:[{type:"image",url:"data:image/bmp;base64,Qk0="}]});
  expect(f.decode).toHaveBeenCalledWith(Buffer.from("BM"));
  expect(uploads[0].mime).toBe("image/png");
  expect(requests[0].params.input[0].type).toBe("localImage");
});
it("existing local host paths stay local and never become a main-process filesystem read", async () => {
  service.useEndpoint({baseUrl:"http://fixture.invalid",token:"fake"} as any,{remote:false});
  await service.submit("cutex.test","","auto",false,{extra:[{type:"localImage",path:"C:/user-picked/image.png"}]});
  expect(uploads).toHaveLength(0);
  expect(requests[0].params.input).toEqual([{type:"localImage",path:"C:/user-picked/image.png"}]);
});
