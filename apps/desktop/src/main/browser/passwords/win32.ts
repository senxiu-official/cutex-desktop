// Windows bindings for saved browser passwords (koffi, the one native dependency: docs/DESIGN.md browser contract).
//   - Credential Manager (advapi32 CredWriteW / CredReadW / CredDeleteW / CredEnumerateW): where the sealed entries live;
//     the owner sees and can delete them in Control Panel.
//   - The Windows Hello key: an RSA key in the Microsoft Passport key storage provider (ncrypt). Encrypting with its
//     public half needs nothing; NCryptDecrypt with the private half makes Windows show its own Hello prompt (PIN, face,
//     fingerprint) over the app window. Key creation (NCryptFinalizeKey) prompts once too.
//   - UserConsentVerifier.CheckAvailabilityAsync (WinRT, polled): whether Hello is set up. It never verifies or shows UI.
// Prompting calls run on koffi's worker thread (`.async`) so the app keeps painting while Windows asks.
// Nothing here logs a value; every native buffer that held a secret is zeroed before it is freed.
import { publicEncrypt, createPublicKey, constants } from "node:crypto";

type Koffi = typeof import("koffi");
type Fn = ((...args: unknown[]) => unknown) & { async(...args: unknown[]): void };

export const ERROR_NOT_FOUND = 1168;
const CRED_TYPE_GENERIC = 1;
const CRED_PERSIST_LOCAL_MACHINE = 2;
const NTE_NO_KEY = 0x8009000d;
const NTE_BAD_KEYSET = 0x80090016;
const NTE_USER_CANCELLED = 0x80090036;
const HRESULT_CANCELLED = 0x800704c7; // HRESULT_FROM_WIN32(ERROR_CANCELLED)
const SCARD_W_CANCELLED_BY_USER = 0x8010006e;
const NCRYPT_SILENT_FLAG = 0x40;
const NCRYPT_OVERWRITE_KEY_FLAG = 0x80;
const NCRYPT_PAD_PKCS1_FLAG = 0x2;
const PASSPORT_PROVIDER = "Microsoft Passport Key Storage Provider";

export class Win32Error extends Error {
  constructor(readonly op: string, readonly code: number) { super(`${op} failed (0x${(code >>> 0).toString(16)})`); }
}

/** The refusal codes of the store contract, from an NCrypt status. */
export function helloFailure(status: number): "auth_cancelled" | "key_lost" | "auth_unavailable" {
  const s = status >>> 0;
  if (s === NTE_USER_CANCELLED || s === HRESULT_CANCELLED || s === SCARD_W_CANCELLED_BY_USER) return "auth_cancelled";
  if (s === NTE_NO_KEY || s === NTE_BAD_KEYSET) return "key_lost";
  return "auth_unavailable";
}

interface Api {
  k: Koffi;
  GetLastError(): number;
  CredWriteW: Fn; CredReadW: Fn; CredDeleteW: Fn; CredEnumerateW: Fn; CredFree: Fn;
  CREDENTIALW: unknown;
  NCryptOpenStorageProvider: Fn; NCryptOpenKey: Fn; NCryptCreatePersistedKey: Fn; NCryptSetPropertyU32: Fn; NCryptSetPropertyPtr: Fn;
  NCryptSetPropertyBytes: Fn; NCryptGetProperty: Fn; NCryptFinalizeKey: Fn; NCryptExportKey: Fn; NCryptDecrypt: Fn; NCryptFreeObject: Fn;
  sid: string;
  combase: { WindowsCreateString: Fn; WindowsDeleteString: Fn; RoGetActivationFactory: Fn; RoInitialize: Fn; RoUninitialize: Fn };
}

let api: Promise<Api> | null = null;
/** Lazy: only Windows ever loads koffi (a failed load leaves the store unavailable, never the app). */
export function win32Api(): Promise<Api> {
  if (process.platform !== "win32") return Promise.reject(new Error("unsupported"));
  return (api ??= load().catch((error) => { api = null; throw error; }));
}

async function load(): Promise<Api> {
  const mod = (await import("koffi")) as unknown as { default?: Koffi } & Koffi;
  const k: Koffi = (mod.default ?? mod) as Koffi;
  const kernel32 = k.load("kernel32.dll"), advapi32 = k.load("advapi32.dll"), ncrypt = k.load("ncrypt.dll"), combase = k.load("combase.dll");
  const f = (lib: { func(def: string): unknown }, def: string) => lib.func(def) as Fn;
  const CREDENTIALW = k.struct("CUTEX_CREDENTIALW", {
    Flags: "uint32", Type: "uint32", TargetName: "str16", Comment: "str16", LastWritten: "uint64", CredentialBlobSize: "uint32",
    CredentialBlob: "void *", Persist: "uint32", AttributeCount: "uint32", Attributes: "void *", TargetAlias: "str16", UserName: "str16",
  });
  const GetLastError = f(kernel32, "uint32 __stdcall GetLastError()") as unknown as () => number;
  const a: Omit<Api, "sid"> = {
    k, GetLastError, CREDENTIALW,
    CredWriteW: f(advapi32, "bool __stdcall CredWriteW(CUTEX_CREDENTIALW *cred, uint32 flags)"),
    CredReadW: f(advapi32, "bool __stdcall CredReadW(str16 target, uint32 type, uint32 flags, _Out_ void **cred)"),
    CredDeleteW: f(advapi32, "bool __stdcall CredDeleteW(str16 target, uint32 type, uint32 flags)"),
    CredEnumerateW: f(advapi32, "bool __stdcall CredEnumerateW(str16 filter, uint32 flags, _Out_ uint32 *count, _Out_ void **creds)"),
    CredFree: f(advapi32, "void __stdcall CredFree(void *buffer)"),
    NCryptOpenStorageProvider: f(ncrypt, "int32 __stdcall NCryptOpenStorageProvider(_Out_ uintptr *provider, str16 name, uint32 flags)"),
    NCryptOpenKey: f(ncrypt, "int32 __stdcall NCryptOpenKey(uintptr provider, _Out_ uintptr *key, str16 name, uint32 spec, uint32 flags)"),
    NCryptCreatePersistedKey: f(ncrypt, "int32 __stdcall NCryptCreatePersistedKey(uintptr provider, _Out_ uintptr *key, str16 alg, str16 name, uint32 spec, uint32 flags)"),
    NCryptSetPropertyU32: f(ncrypt, "int32 __stdcall NCryptSetProperty(uintptr object, str16 property, uint32 *value, uint32 size, uint32 flags)"),
    NCryptSetPropertyPtr: f(ncrypt, "int32 __stdcall NCryptSetProperty(uintptr object, str16 property, uint64 *value, uint32 size, uint32 flags)"),
    NCryptSetPropertyBytes: f(ncrypt, "int32 __stdcall NCryptSetProperty(uintptr object, str16 property, uint8 *value, uint32 size, uint32 flags)"),
    NCryptFinalizeKey: f(ncrypt, "int32 __stdcall NCryptFinalizeKey(uintptr key, uint32 flags)"),
    NCryptExportKey: f(ncrypt, "int32 __stdcall NCryptExportKey(uintptr key, uintptr exportKey, str16 blobType, void *params, _Out_ uint8 *out, uint32 size, _Out_ uint32 *result, uint32 flags)"),
    NCryptDecrypt: f(ncrypt, "int32 __stdcall NCryptDecrypt(uintptr key, uint8 *input, uint32 inputSize, void *padding, uint8 *out, uint32 outSize, uint8 *result, uint32 flags)"),
    NCryptFreeObject: f(ncrypt, "int32 __stdcall NCryptFreeObject(uintptr object)"),
    NCryptGetProperty: f(ncrypt, "int32 __stdcall NCryptGetProperty(uintptr object, str16 property, uint8 *out, uint32 size, uint8 *result, uint32 flags)"),
    combase: {
      RoInitialize: f(combase, "int32 __stdcall RoInitialize(int type)"),
      RoUninitialize: f(combase, "void __stdcall RoUninitialize()"),
      WindowsCreateString: f(combase, "int32 __stdcall WindowsCreateString(str16 s, uint32 len, _Out_ void **h)"),
      WindowsDeleteString: f(combase, "int32 __stdcall WindowsDeleteString(void *h)"),
      RoGetActivationFactory: f(combase, "int32 __stdcall RoGetActivationFactory(void *cls, uint8 *iid, _Out_ void **factory)"),
    },
  };
  // The current user's SID names the Hello key ("<SID>//<domain>/<sub>/<name>", the Passport provider's format).
  const GetCurrentProcess = f(kernel32, "void * __stdcall GetCurrentProcess()");
  const OpenProcessToken = f(advapi32, "bool __stdcall OpenProcessToken(void *process, uint32 access, _Out_ void **token)");
  const GetTokenInformation = f(advapi32, "bool __stdcall GetTokenInformation(void *token, int cls, _Out_ uint8 *info, uint32 len, _Out_ uint32 *retLen)");
  const ConvertSidToStringSidW = f(advapi32, "bool __stdcall ConvertSidToStringSidW(void *sid, _Out_ void **str)");
  const LocalFree = f(kernel32, "void * __stdcall LocalFree(void *mem)");
  const CloseHandle = f(kernel32, "bool __stdcall CloseHandle(void *h)");
  const token: unknown[] = [null];
  if (!OpenProcessToken(GetCurrentProcess(), 0x0008 /* TOKEN_QUERY */, token)) throw new Win32Error("OpenProcessToken", GetLastError());
  const info = Buffer.alloc(512), len = [0];
  const ok = GetTokenInformation(token[0], 1 /* TokenUser */, info, info.length, len);
  CloseHandle(token[0]);
  if (!ok) throw new Win32Error("GetTokenInformation", GetLastError());
  const out: unknown[] = [null];
  if (!ConvertSidToStringSidW(k.decode(info, "void *"), out)) throw new Win32Error("ConvertSidToStringSidW", GetLastError());
  const sid = k.decode.string16(out[0]);
  LocalFree(out[0]);
  if (!/^S-1-[0-9-]+$/.test(sid)) throw new Error("unexpected SID");
  return { ...a, sid };
}

// ---- Credential Manager ----

export interface CredentialSummary { target: string; username: string; comment: string }

export async function credWrite(target: string, username: string, comment: string, blob: Buffer): Promise<void> {
  const a = await win32Api();
  if (blob.length > 2560) throw new Error("credential_too_large");
  const ok = a.CredWriteW({ Flags: 0, Type: CRED_TYPE_GENERIC, TargetName: target, Comment: comment, LastWritten: 0, CredentialBlobSize: blob.length,
    CredentialBlob: blob, Persist: CRED_PERSIST_LOCAL_MACHINE, AttributeCount: 0, Attributes: null, TargetAlias: null, UserName: username }, 0);
  if (!ok) throw new Win32Error("CredWriteW", a.GetLastError());
}

/** The blob, or null when there is no such credential. The native copy is zeroed before CredFree. */
export async function credRead(target: string): Promise<Buffer | null> {
  const a = await win32Api();
  const out: unknown[] = [null];
  if (!a.CredReadW(target, CRED_TYPE_GENERIC, 0, out)) {
    const code = a.GetLastError();
    if (code === ERROR_NOT_FOUND) return null;
    throw new Win32Error("CredReadW", code);
  }
  try {
    const cred = a.k.decode(out[0], a.CREDENTIALW as never) as { CredentialBlobSize: number; CredentialBlob: unknown };
    if (!cred.CredentialBlobSize || !cred.CredentialBlob) return Buffer.alloc(0);
    const view = new Uint8Array(a.k.view(cred.CredentialBlob, cred.CredentialBlobSize));
    const copy = Buffer.from(view);
    view.fill(0);
    return copy;
  } finally { a.CredFree(out[0]); }
}

export async function credDelete(target: string): Promise<boolean> {
  const a = await win32Api();
  if (a.CredDeleteW(target, CRED_TYPE_GENERIC, 0)) return true;
  const code = a.GetLastError();
  if (code === ERROR_NOT_FOUND) return false;
  throw new Win32Error("CredDeleteW", code);
}

/** Targets and user names under `prefix` (a literal; "*" is appended). Blobs are zeroed, never copied out. */
export async function credList(prefix: string): Promise<CredentialSummary[]> {
  const a = await win32Api();
  if (prefix.includes("*")) throw new Error("invalid prefix");
  const count = [0], out: unknown[] = [null];
  if (!a.CredEnumerateW(`${prefix}*`, 0, count, out)) {
    const code = a.GetLastError();
    if (code === ERROR_NOT_FOUND) return [];
    throw new Win32Error("CredEnumerateW", code);
  }
  try {
    const list: CredentialSummary[] = [];
    const pointers = a.k.decode(out[0], "void *", count[0]!) as unknown[];
    for (const pointer of pointers) {
      const cred = a.k.decode(pointer, a.CREDENTIALW as never) as { Type: number; TargetName: string; UserName: string | null; Comment: string | null; CredentialBlobSize: number; CredentialBlob: unknown };
      if (cred.CredentialBlobSize && cred.CredentialBlob) new Uint8Array(a.k.view(cred.CredentialBlob, cred.CredentialBlobSize)).fill(0);
      if (cred.Type === CRED_TYPE_GENERIC && cred.TargetName.startsWith(prefix)) list.push({ target: cred.TargetName, username: cred.UserName ?? "", comment: cred.Comment ?? "" });
    }
    return list;
  } finally { a.CredFree(out[0]); }
}

// ---- Windows Hello availability (WinRT, no UI) ----

function guid(text: string): Buffer {
  const h = text.replace(/-/g, ""), b = Buffer.alloc(16);
  b.writeUInt32LE(parseInt(h.slice(0, 8), 16), 0); b.writeUInt16LE(parseInt(h.slice(8, 12), 16), 4); b.writeUInt16LE(parseInt(h.slice(12, 16), 16), 6);
  Buffer.from(h.slice(16), "hex").copy(b, 8);
  return b;
}
const IID_IUserConsentVerifierStatics = guid("af4f3f91-564c-4ddc-b8b5-973447627c65");
const IID_IAsyncInfo = guid("00000036-0000-0000-c000-000000000046");

/** UserConsentVerifierAvailability: 0 Available, 1 DeviceNotPresent, 2 NotConfiguredForUser, 3 DisabledByPolicy, 4 DeviceBusy. */
export async function helloAvailability(): Promise<number> {
  const a = await win32Api(), k = a.k;
  const vfn = (object: unknown, index: number) => k.decode(k.decode(object, "void *"), 8 * index, "void *");
  const OutPtr = k.proto("int32 __stdcall CutexOutPtr(void *self, _Out_ void **out)");
  const QI = k.proto("int32 __stdcall CutexQI(void *self, uint8 *iid, _Out_ void **out)");
  const Release = k.proto("uint32 __stdcall CutexRelease(void *self)");
  const OutU32 = k.proto("int32 __stdcall CutexOutU32(void *self, _Out_ uint32 *out)");
  const release = (object: unknown) => { if (object) k.call(vfn(object, 2), Release, object); };
  // Balanced: S_OK / S_FALSE add a reference this call takes back; RPC_E_CHANGED_MODE (Electron's main thread is
  // already an STA) adds none.
  const initialized = (a.combase.RoInitialize(1) as number) >= 0;
  const cls = "Windows.Security.Credentials.UI.UserConsentVerifier";
  const name: unknown[] = [null], factory: unknown[] = [null], op: unknown[] = [null], info: unknown[] = [null];
  try {
    check("WindowsCreateString", a.combase.WindowsCreateString(cls, cls.length, name) as number);
    check("RoGetActivationFactory", a.combase.RoGetActivationFactory(name[0], IID_IUserConsentVerifierStatics, factory) as number);
    check("CheckAvailabilityAsync", k.call(vfn(factory[0], 6), OutPtr, factory[0], op) as number);
    check("QueryInterface", k.call(vfn(op[0], 0), QI, op[0], IID_IAsyncInfo, info) as number);
    const status = [0];
    for (let i = 0; i < 200; i++) { // ≤ 5 s; it answers within milliseconds
      check("get_Status", k.call(vfn(info[0], 7), OutU32, info[0], status) as number);
      if (status[0] !== 0) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (status[0] !== 1) throw new Error("hello availability check did not complete");
    const result = [0];
    check("GetResults", k.call(vfn(op[0], 8), OutU32, op[0], result) as number);
    return result[0]!;
  } finally {
    release(info[0]); release(op[0]); release(factory[0]);
    if (initialized) a.combase.RoUninitialize();
    if (name[0]) a.combase.WindowsDeleteString(name[0]);
  }
}

function check(op: string, hr: number): void { if (hr < 0) throw new Win32Error(op, hr); }

// ---- The Windows Hello key (Passport KSP) ----

export function helloKeyName(sid: string, name: string): string { return `${sid}//CutexDesktop/BrowserPasswords/${name}`; }

async function withProvider<T>(use: (a: Api, provider: bigint | number) => Promise<T>): Promise<T> {
  const a = await win32Api();
  const provider = [0];
  check("NCryptOpenStorageProvider", a.NCryptOpenStorageProvider(provider, PASSPORT_PROVIDER, 0) as number);
  try { return await use(a, provider[0]!); } finally { a.NCryptFreeObject(provider[0]); }
}

async function withKey<T>(name: string, use: (a: Api, key: bigint | number) => Promise<T>): Promise<T> {
  return withProvider(async (a, provider) => {
    const key = [0];
    const status = a.NCryptOpenKey(provider, key, helloKeyName(a.sid, name), 0, NCRYPT_SILENT_FLAG) as number;
    if (status < 0) throw new Win32Error("NCryptOpenKey", status);
    try { return await use(a, key[0]!); } finally { a.NCryptFreeObject(key[0]); }
  });
}

/** Whether the Hello key exists (no prompt). False after a Hello reset or on another PC. */
export async function helloKeyExists(name: string): Promise<boolean> {
  try { return await withKey(name, async () => true); }
  catch (error) { if (error instanceof Win32Error && helloFailure(error.code) === "key_lost") return false; throw error; }
}

const NGC_CACHE = ["NgcCacheType", "NgcCacheTypeProperty"] as const;
const NGC_AUTH_MANDATORY = 1;
const NTE_NOT_SUPPORTED = 0x80090029 | 0;

/** The key's cache policy as Windows reports it, or null when neither property name can be read. */
export function readNgcCacheType(read: (name: string, out: Buffer, size: Buffer) => number): number | null {
  for (const name of NGC_CACHE) {
    const out = Buffer.alloc(4), size = Buffer.alloc(4);
    if (read(name, out, size) >= 0 && size.readUInt32LE(0) === 4) return out.readUInt32LE(0);
  }
  return null;
}

/**
 * Refuses a key Windows reports as caching unlocks (it would let a recent Hello pass without asking). A policy that
 * cannot be read back is accepted only because it was set successfully at creation (creation fails closed).
 */
function requireAuthMandatory(a: Api, key: bigint | number): void {
  const value = readNgcCacheType((name, out, size) => a.NCryptGetProperty(key, name, out, 4, size, 0) as number);
  if (value !== null && value !== NGC_AUTH_MANDATORY) throw new Win32Error("NgcCacheType", NTE_NOT_SUPPORTED);
}

function setPromptContext(a: Api, key: bigint | number, hwnd: bigint | null, message: string): void {
  if (hwnd) a.NCryptSetPropertyPtr(key, "HWND Handle", [hwnd], 8, 0);
  const text = Buffer.from(`${message}\0`, "utf16le");
  a.NCryptSetPropertyBytes(key, "Use Context", text, text.length, 0);
}

function callAsync(fn: Fn, ...args: unknown[]): Promise<number> {
  return new Promise((resolve, reject) => fn.async(...args, (error: unknown, result: number) => (error ? reject(error) : resolve(result))));
}

/**
 * Creates (or replaces) the Hello key: Windows prompts once. Returns its public key (SPKI DER).
 * Cache type "auth mandatory": every decrypt asks again; the 5-minute grace is the app's own, in memory.
 */
export async function helloKeyCreate(name: string, hwnd: bigint | null, message: string): Promise<Buffer> {
  return withProvider(async (a, provider) => {
    const key = [0];
    check("NCryptCreatePersistedKey", a.NCryptCreatePersistedKey(provider, key, "RSA", helloKeyName(a.sid, name), 0, NCRYPT_OVERWRITE_KEY_FLAG) as number);
    try {
      check("Length", a.NCryptSetPropertyU32(key[0], "Length", [2048], 4, 0) as number);
      check("Key Usage", a.NCryptSetPropertyU32(key[0], "Key Usage", [0x3 /* decrypt | sign */], 4, 0) as number);
      // NgcCacheType = AUTH_MANDATORY (older builds: NgcCacheTypeProperty): Windows asks on every use instead of reusing
      // a recent unlock. Fail closed: no key is created when neither name can be set.
      let cache = a.NCryptSetPropertyU32(key[0], NGC_CACHE[0], [NGC_AUTH_MANDATORY], 4, 0) as number;
      if (cache < 0) cache = a.NCryptSetPropertyU32(key[0], NGC_CACHE[1], [NGC_AUTH_MANDATORY], 4, 0) as number;
      if (cache < 0) throw new Win32Error("NgcCacheType", cache);
      setPromptContext(a, key[0]!, hwnd, message);
      const status = await callAsync(a.NCryptFinalizeKey, key[0], 0);
      if (status < 0) throw new Win32Error("NCryptFinalizeKey", status);
      requireAuthMandatory(a, key[0]!);
      return exportPublic(a, key[0]!);
    } finally { a.NCryptFreeObject(key[0]); }
  });
}

/** The public key (no prompt), SPKI DER, from BCRYPT_RSAPUBLIC_BLOB. */
export async function helloKeyPublic(name: string): Promise<Buffer> { return withKey(name, async (a, key) => exportPublic(a, key)); }

function exportPublic(a: Api, key: bigint | number): Buffer {
  const size = [0];
  check("NCryptExportKey", a.NCryptExportKey(key, 0, "RSAPUBLICBLOB", null, null, 0, size, 0) as number);
  const blob = Buffer.alloc(size[0]!);
  check("NCryptExportKey", a.NCryptExportKey(key, 0, "RSAPUBLICBLOB", null, blob, blob.length, size, 0) as number);
  return rsaPublicBlobToSpki(blob.subarray(0, size[0]));
}

/** BCRYPT_RSAKEY_BLOB { Magic 'RSA1', BitLength, cbPublicExp, cbModulus, cbPrime1, cbPrime2 } + exponent + modulus (big-endian). */
export function rsaPublicBlobToSpki(blob: Buffer): Buffer {
  if (blob.length < 24 || blob.readUInt32LE(0) !== 0x31415352) throw new Error("not an RSA public blob");
  const exp = blob.readUInt32LE(8), mod = blob.readUInt32LE(12);
  if (blob.length < 24 + exp + mod) throw new Error("short RSA public blob");
  const e = blob.subarray(24, 24 + exp), n = blob.subarray(24 + exp, 24 + exp + mod);
  const b64 = (v: Buffer) => v.toString("base64url");
  return createPublicKey({ key: { kty: "RSA", n: b64(n), e: b64(e) }, format: "jwk" }).export({ type: "spki", format: "der" }) as Buffer;
}

/** Wraps with the public key (PKCS#1 v1.5, what the Passport provider decrypts). No prompt. */
export function helloWrap(spki: Buffer, secret: Buffer): Buffer {
  return publicEncrypt({ key: createPublicKey({ key: spki, format: "der", type: "spki" }), padding: constants.RSA_PKCS1_PADDING }, secret);
}

/** Windows shows Hello over `hwnd`; resolves with the plaintext (caller zeroes it). */
export async function helloUnwrap(name: string, wrapped: Buffer, hwnd: bigint | null, message: string): Promise<Buffer> {
  return withKey(name, async (a, key) => {
    requireAuthMandatory(a, key);
    setPromptContext(a, key, hwnd, message);
    // Buffers (not out-parameter arrays) for the worker-thread call: written in place.
    const out = Buffer.alloc(512), size = Buffer.alloc(4);
    const status = await new Promise<number>((resolve, reject) =>
      a.NCryptDecrypt.async(key, wrapped, wrapped.length, null, out, out.length, size, NCRYPT_PAD_PKCS1_FLAG, (error: unknown, result: number) => (error ? reject(error) : resolve(result))));
    if (status < 0) { out.fill(0); throw new Win32Error("NCryptDecrypt", status); }
    const plain = Buffer.from(out.subarray(0, Math.min(size.readUInt32LE(0), out.length)));
    out.fill(0);
    return plain;
  });
}
