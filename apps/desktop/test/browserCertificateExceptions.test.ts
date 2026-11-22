import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { BROWSER_CERTIFICATE_EXCEPTION_LIMIT, BrowserCertificateExceptionStore, browserCertificateFingerprintHex } from "../src/main/browser/certificateExceptions";
import { browserCertificateVerdict, createBrowserUrlPolicy, hardenBrowserGuest, isBrowserPrivateCertificateHost } from "../src/main/browser/network";

const fp = (fill: string) => `sha256/${fill.repeat(43).slice(0, 43)}=`;
const A = fp("A"), B = fp("B");
function memoryIo(initial?: string) {
  const files = new Map<string, string>(initial === undefined ? [] : [["certs.json", initial]]);
  return { files, io: { read: (path: string) => { const text = files.get(path); if (text === undefined) throw new Error("ENOENT"); return text; }, write: (path: string, text: string) => { files.set(path, text); } } };
}

describe("B5 certificate verdict: Chromium's refusal stands for LAN / loopback hosts of the owner pool only", () => {
  const refused = (hostname: string) => ({ hostname, errorCode: -202, verificationResult: "net::ERR_CERT_AUTHORITY_INVALID" });
  it("passes Chromium's own success and rejects everything else without an overridable predicate (agent pool)", () => {
    expect(browserCertificateVerdict({ hostname: "example.org", errorCode: 0, verificationResult: "net::OK" })).toBe(-3);
    for (const host of ["10.0.0.1", "localhost", "nas.lan", "example.org"]) expect(browserCertificateVerdict(refused(host))).toBe(-2);
  });
  it("hands a LAN / loopback refusal to the guest's certificate-error, never a public name", () => {
    for (const host of ["10.0.0.1", "10.0.0.5", "localhost", "127.0.0.1", "[::1]", "::1", "nas.lan", "router", "printer.local", "fd12::1"])
      expect([host, browserCertificateVerdict(refused(host), isBrowserPrivateCertificateHost)]).toEqual([host, -3]);
    for (const host of ["example.org", "nas.example.com", "8.8.8.8", "198.18.0.1", "", "a".repeat(300)])
      expect([host, browserCertificateVerdict(refused(host), isBrowserPrivateCertificateHost)]).toEqual([host, -2]);
    expect(browserCertificateVerdict(refused("nas.lan"), () => { throw new Error("broken"); })).toBe(-2);
  });
});

describe("B5 owner certificate exception store", () => {
  it("pins exactly host + origin + fingerprint; another certificate, origin or host does not match", () => {
    const { io, files } = memoryIo();
    const store = new BrowserCertificateExceptionStore("certs.json", io);
    expect(store.matches("local", "https://10.0.0.1", A)).toBe(false);
    store.set("local", "https://10.0.0.1", A);
    expect(store.matches("local", "https://10.0.0.1", A)).toBe(true);
    expect(store.matches("local", "https://10.0.0.1", B)).toBe(false);
    expect(store.matches("local", "https://10.0.0.1:8443", A)).toBe(false);
    expect(store.matches("ssh-nas", "https://10.0.0.1", A)).toBe(false);
    // Persisted, re-read by a fresh store; a new certificate for the origin replaces the old one.
    expect(new BrowserCertificateExceptionStore("certs.json", io).matches("local", "https://10.0.0.1", A)).toBe(true);
    store.set("local", "https://10.0.0.1", B);
    expect(store.matches("local", "https://10.0.0.1", A)).toBe(false);
    expect(JSON.parse(files.get("certs.json")!)).toEqual({ exceptions: { "local https://10.0.0.1": B } });
  });
  it("refuses malformed input and ignores malformed / forged file entries (fail closed)", () => {
    const store = new BrowserCertificateExceptionStore(null);
    for (const [host, origin, value] of [["local", "http://10.0.0.1", A], ["local", "https://10.0.0.1/path", A], ["lo cal", "https://x.lan", A], ["local", "https://x.lan", "sha1/abc"]])
      expect(() => store.set(host!, origin!, value!)).toThrow("invalid_certificate_exception");
    const { io } = memoryIo(JSON.stringify({ exceptions: { "local https://ok.lan": A, "https://no-host.lan": A, "local http://x.lan": A, "local https://bad.lan": "sha256/short=" } }));
    const loaded = new BrowserCertificateExceptionStore("certs.json", io);
    expect(loaded.matches("local", "https://ok.lan", A)).toBe(true);
    expect(loaded.matches("local", "https://bad.lan", "sha256/short=")).toBe(false);
    expect(new BrowserCertificateExceptionStore("certs.json", memoryIo("{not json").io).matches("local", "https://ok.lan", A)).toBe(false);
  });
  it("is bounded: the oldest exception falls off", () => {
    const store = new BrowserCertificateExceptionStore(null);
    for (let i = 0; i <= BROWSER_CERTIFICATE_EXCEPTION_LIMIT; i++) store.set("local", `https://host${i}.lan`, A);
    expect(store.matches("local", "https://host0.lan", A)).toBe(false);
    expect(store.matches("local", `https://host${BROWSER_CERTIFICATE_EXCEPTION_LIMIT}.lan`, A)).toBe(true);
  });
  it("shows the fingerprint as colon-separated hex", () => {
    expect(browserCertificateFingerprintHex(A)).toMatch(/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(browserCertificateFingerprintHex("sha1/abc")).toBeUndefined();
  });
});

describe("B5 guest certificate-error: only main's decision accepts, only while hardening is active", () => {
  function guest() {
    const emitter = Object.assign(new EventEmitter(), { id: 9, setWebRTCIPHandlingPolicy: vi.fn(), getURL: () => "about:blank" });
    return emitter;
  }
  const policy = createBrowserUrlPolicy({ getHost: () => ({ kind: "local" }) });
  function emit(target: EventEmitter, mainFrame = true) {
    const event = { preventDefault: vi.fn() }, callback = vi.fn();
    target.emit("certificate-error", event, "https://10.0.0.1/", "net::ERR_CERT_AUTHORITY_INVALID", { fingerprint: A }, callback, mainFrame);
    return { event, callback };
  }
  it("accepts when main says so, otherwise leaves Electron's denial; disposal stops accepting", () => {
    const target = guest(), decide = vi.fn(() => true);
    const dispose = hardenBrowserGuest(target as unknown as WebContents, { hostId: "local", policy, certificateError: decide });
    const accepted = emit(target);
    expect(decide).toHaveBeenCalledWith("https://10.0.0.1/", A, true);
    expect(accepted.event.preventDefault).toHaveBeenCalledOnce(); expect(accepted.callback).toHaveBeenCalledWith(true);
    decide.mockReturnValue(false);
    const denied = emit(target, false);
    expect(decide).toHaveBeenLastCalledWith("https://10.0.0.1/", A, false);
    expect(denied.event.preventDefault).not.toHaveBeenCalled(); expect(denied.callback).not.toHaveBeenCalled();
    decide.mockReturnValue(true); dispose();
    const stale = emit(target);
    expect(stale.event.preventDefault).not.toHaveBeenCalled(); expect(stale.callback).not.toHaveBeenCalled();
  });
  it("a throwing or absent decision denies", () => {
    const target = guest();
    hardenBrowserGuest(target as unknown as WebContents, { hostId: "local", policy, certificateError: () => { throw new Error("x"); } });
    const other = guest();
    hardenBrowserGuest(other as unknown as WebContents, { hostId: "local", policy });
    for (const t of [target, other]) { const { event, callback } = emit(t); expect(event.preventDefault).not.toHaveBeenCalled(); expect(callback).not.toHaveBeenCalled(); }
  });
});
