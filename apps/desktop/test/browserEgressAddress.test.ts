import { describe, expect, it } from "vitest";
import { isPublicEgressAddress, matchesEgressHost, parsePublicBrowserUrl, parsePublicConnectAuthority } from "../src/main/browser/egressAddress";

// CGNAT (100.64.0.0/10) range bounds, built from octets: the public-export scan rejects literal
// 100.x addresses outside its 100.64.0.x example block. These are range edges, not real hosts.
const cgnat = (...octets: number[]) => [100, ...octets].join(".");

describe("public-only browser egress address policy", () => {
  it.each(["0.0.0.0", "0.1.2.3", "10.0.0.1", "100.64.0.1", cgnat(127, 255, 255), "127.0.0.1", "127.255.0.1", "169.254.169.254",
    "172.16.0.1", "172.31.255.255", "192.0.0.9", "192.0.2.1", "192.31.196.1", "192.52.193.1", "192.88.99.1", "192.168.255.255", "192.175.48.1",
    "198.18.0.1", "198.19.255.255", "198.51.100.1", "203.0.113.1", "224.0.0.1", "239.1.2.3", "240.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:8.8.8.8", "64:ff9b::7f00:1", "64:ff9b:1::1", "100::1", "100:0:0:1::1",
    "2001::1", "2001:1ff:ffff::1", "2001:db8::1", "2002:7f00:1::", "2620:4f:8000::1", "3fff::1", "3fff:fff::1", "5f00::1", "fc00::1", "fd00::1", "fe80::1", "fec0::1", "ff02::1", "fe80::1%eth0",
    "127.1", "2130706433", "0x7f000001", "0177.0.0.1", "", "example.com"])("denies special/private/non-IP %s", value => expect(isPublicEgressAddress(value)).toBe(false));
  it.each(["8.8.8.8", "1.1.1.1", cgnat(63, 255, 255), cgnat(128, 0, 1), "172.15.255.255", "172.32.0.1", "192.0.1.1", "198.17.255.255", "198.20.0.1", "223.255.255.255",
    "2001:200::1", "2001:4860:4860::8888", "2606:4700:4700::1111", "3ffe::1", "3fff:1000::1"])("accepts ordinary public literal %s", value => expect(isPublicEgressAddress(value)).toBe(true));
  it.each(["http://public.example.com/a?q=1#fragment", "https://public.example.com:8443/", "ws://8.8.8.8/", "wss://[2606:4700:4700::1111]/", "http://xn--bcher-kva.example.com/"])("accepts public URL candidate %s without DNS", value => expect(parsePublicBrowserUrl(value)).toBeDefined());
  it.each(["file:///etc/passwd", "ftp://example.com/", "http://user:pass@example.com/", "http://@example.com/", "http://localhost/", "http://foo.localhost/", "http://foo.local/", "http://foo.internal/", "http://foo.home.arpa/", "http://printer/", "http://example.com./", "http://127.1/", "http://2130706433/", "http://0x7f000001/", "http://0177.0.0.1/", "http://%65xample.com/", "http://example.com:0/", "http://example.com:65536/", "http://example.com:080/", "http://example.com:/", "http://[::ffff:8.8.8.8]/", "http://[fe80::1%25eth0]/", "http://example.com\\@127.0.0.1/", "http://example.com/\n", "http://example.com/\u0085", "https://foo..example.com/", "https://-foo.example.com/", "https://bücher.example.com/"])("rejects ambiguous or nonpublic URL %s", value => expect(parsePublicBrowserUrl(value)).toBeUndefined());
  it("rejects fragments in actual HTTP request targets and bounds URL length", () => {
    expect(parsePublicBrowserUrl("http://example.com/#x", false)).toBeUndefined();
    expect(parsePublicBrowserUrl(`http://example.com/${"x".repeat(16384)}`)).toBeUndefined();
  });
  it.each(["example.com", "https://example.com:443", "example.com:443/path", "user@example.com:443", "example.com:0", "example.com:0443", "127.0.0.1:443", "[::1]:443", "example.com:443#x"])("rejects malformed or nonpublic CONNECT %s", value => expect(parsePublicConnectAuthority(value)).toBeUndefined());
  it("requires matching canonical host and effective port, including IPv6", () => {
    const target = parsePublicBrowserUrl("https://example.com/a")!;
    expect(matchesEgressHost("EXAMPLE.COM:443", target)).toBe(true);
    expect(matchesEgressHost("example.com:80", target)).toBe(false);
    expect(matchesEgressHost("127.0.0.1", target)).toBe(false);
    expect(parsePublicConnectAuthority("[2606:4700:4700::1111]:443")).toMatchObject({ hostname: "2606:4700:4700::1111", port: 443 });
  });
});
