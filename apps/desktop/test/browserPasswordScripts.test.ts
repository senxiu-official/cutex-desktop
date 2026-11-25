// @vitest-environment jsdom
// The fixed isolated-world scripts of saved passwords, run against real DOM shapes (jsdom; layout is stubbed: an
// element is "visible" unless it has data-hidden).
import { beforeEach, describe, expect, it } from "vitest";
import { FIELD_SCRIPT, FORM_SCRIPT, GONE_SCRIPT, fillScript, parseFieldProbe, parseSubmitProbe, submitScript } from "../src/main/browser/passwords/pageScripts";

const run = async (code: string): Promise<unknown> => (0, eval)(code);

beforeEach(() => {
  delete (globalThis as { __cutexPasswords?: unknown }).__cutexPasswords;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const hidden = this.hasAttribute("data-hidden");
    return { x: 5, y: 7, left: 5, top: 7, width: hidden ? 0 : 120, height: hidden ? 0 : 24, right: 125, bottom: 31, toJSON() {} } as DOMRect;
  };
});

function page(html: string, focus?: string): void {
  document.body.innerHTML = html;
  if (focus) (document.querySelector(focus) as HTMLElement).focus();
}

describe("submit", () => {
  it("reads the user name and password of the submitted form", async () => {
    page(`<form><input name="email" type="email" value="mika@example.com"><input type="password" value="pw!"><button type="submit">Sign in</button></form>`, "button");
    expect(parseSubmitProbe(await run(submitScript("click")))).toEqual({ kind: "login", username: "mika@example.com", password: "pw!" });
    (document.querySelector("input[type=password]") as HTMLElement).focus();
    expect(parseSubmitProbe(await run(submitScript("enter")))).toEqual({ kind: "login", username: "mika@example.com", password: "pw!" });
  });

  it("prefers autocomplete=username; skips new-password, one-time-code, change-password forms and empty values", async () => {
    page(`<form><input id="a" value="noise"><input autocomplete="username" value="real"><input type="password" value="pw"></form>`, "input[type=password]");
    expect(parseSubmitProbe(await run(submitScript("enter")))).toMatchObject({ username: "real" });
    page(`<form><input value="u"><input type="password" autocomplete="new-password" value="pw"></form>`, "input[type=password]");
    expect(await run(submitScript("enter"))).toBeNull();
    page(`<form><input type="password" value="old"><input type="password" value="new"><input type="password" value="new"></form>`, "input[type=password]");
    expect(await run(submitScript("enter"))).toBeNull();
    page(`<form><input value="u"><input type="password" value=""></form>`, "input[type=password]");
    expect(await run(submitScript("enter"))).toBeNull();
    page(`<form><input value="u"><input type="password" value="pw"><a href="#">x</a></form>`, "a");
    expect(await run(submitScript("click"))).toBeNull(); // a link is not a submit
  });

  it("a user-name-only step reports the name (two-step sign-in)", async () => {
    page(`<form><input type="email" name="loginfmt" value="mika@example.com"><input type="submit" value="Next"></form>`, "input[type=submit]");
    expect(parseSubmitProbe(await run(submitScript("click")))).toEqual({ kind: "username", username: "mika@example.com" });
  });

  it("ignores hidden password fields", async () => {
    page(`<form><input value="u"><input type="password" value="pw" data-hidden></form>`, "input");
    expect(parseSubmitProbe(await run(submitScript("enter")))).toEqual({ kind: "username", username: "u" });
  });
});

describe("field, focus, gone", () => {
  it("names the clicked login field and its rect, then fills each field of that form in one step", async () => {
    page(`<form><input id="u" type="text" name="username" value="typed"><input id="p" type="password" value="x"></form>`, "#u");
    expect(parseFieldProbe(await run(FIELD_SCRIPT))).toEqual({ role: "username", rect: { x: 5, y: 7, width: 120, height: 24 } });
    expect(await run(FORM_SCRIPT)).toEqual({ username: true, password: true });
    (document.querySelector("#u") as HTMLElement).blur();
    const inputs: string[] = [];
    document.querySelector("#p")!.addEventListener("input", () => inputs.push("p"));
    expect(await run(fillScript("password", "pa\"ss'word", location.origin))).toBe(true);
    expect((document.querySelector("#p") as HTMLInputElement).value).toBe("pa\"ss'word");
    expect(document.activeElement?.id).toBe("p");
    expect(inputs).toEqual(["p"]); // the page sees an input event
    expect(await run(fillScript("username", "mika", location.origin))).toBe(true);
    expect((document.querySelector("#u") as HTMLInputElement).value).toBe("mika");
  });

  it("fill refuses another origin (checked in the same step as the insertion)", async () => {
    page(`<form><input id="p" type="password" value=""></form>`, "#p");
    await run(FIELD_SCRIPT);
    expect(await run(fillScript("password", "secret", "https://evil.example.com"))).toBe(false);
    expect((document.querySelector("#p") as HTMLInputElement).value).toBe("");
  });

  it("a search box or a one-time code is not a login field", async () => {
    page(`<input id="q" type="search">`, "#q");
    expect(await run(FIELD_SCRIPT)).toBeNull();
    page(`<form><input id="c" autocomplete="one-time-code"><input type="password"></form>`, "#c");
    expect(await run(FIELD_SCRIPT)).toBeNull();
  });

  it("password-only page: the form has no user name field to fill", async () => {
    page(`<form><input id="p" type="password"></form>`, "#p");
    expect(parseFieldProbe(await run(FIELD_SCRIPT))).toMatchObject({ role: "password" });
    expect(await run(FORM_SCRIPT)).toEqual({ username: false, password: true });
    expect(await run(fillScript("username", "u", location.origin))).toBe(false);
  });

  it("focus fails once the remembered field left the page", async () => {
    page(`<form><input id="p" type="password"></form>`, "#p");
    await run(FIELD_SCRIPT);
    document.body.innerHTML = "<p>moved on</p>";
    expect(await run(fillScript("password", "p", location.origin))).toBe(false);
    expect(await run(FORM_SCRIPT)).toBeNull();
  });

  it("gone: no usable password field left", async () => {
    page(`<form><input type="password"></form>`);
    expect(await run(GONE_SCRIPT)).toBe(false);
    page(`<form><input type="password" autocomplete="new-password"></form><p>welcome</p>`);
    expect(await run(GONE_SCRIPT)).toBe(true);
    page(`<p>welcome</p>`);
    expect(await run(GONE_SCRIPT)).toBe(true);
  });
});

describe("parsers", () => {
  it("refuse odd shapes", () => {
    expect(parseSubmitProbe({ kind: "login", username: "a\nb", password: "x" })).toBeNull();
    expect(parseSubmitProbe({ kind: "login", username: "a", password: "" })).toBeNull();
    expect(parseSubmitProbe({ kind: "login", username: "a", password: "x".repeat(513) })).toBeNull();
    expect(parseFieldProbe({ role: "username", rect: { x: Infinity, y: 0, width: 1, height: 1 } })).toBeNull();
    expect(parseFieldProbe({ role: "other", rect: { x: 0, y: 0, width: 1, height: 1 } })).toBeNull();
  });
});
