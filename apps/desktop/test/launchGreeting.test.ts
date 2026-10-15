import { expect, it } from "vitest";
import { resolveLaunchGreeting } from "../src/renderer/src/lib/launchGreeting";
import { resolveTerms } from "../src/renderer/src/lib/terms";

it("uses the existing owner preference unless the module supplies an address", () => {
  const owner = resolveTerms({ "zh-CN": { owner: { one: "阿森" } } }, "zh-CN").owner.one;
  expect(resolveLaunchGreeting({ messages: "又开工了，{称呼}" }, "首页", owner, 0)).toBe("又开工了，阿森");
  expect(resolveLaunchGreeting({ messages: "Hello, {name}", address: " Alex " }, "Home", owner, 0)).toBe("Hello, Alex");
  expect(resolveLaunchGreeting({ messages: "Hello, {name}", address: " " }, "Home", owner, 0)).toBe("Hello, 阿森");
});

it("keeps the selected phrase while the address changes, including literal replacement characters", () => {
  const messages = [" ", "Hi, {name}", "Welcome back, {name}"];
  expect(resolveLaunchGreeting({ messages }, "Home", "owner", 0.75)).toBe("Welcome back, owner");
  expect(resolveLaunchGreeting({ messages: [...messages], address: "$&" }, "Home", "owner", 0.75)).toBe("Welcome back, $&");
});

it("retains the page title when there is no configured copy and uses the default owner term", () => {
  const owner = resolveTerms({}, "zh-CN").owner.one;
  expect(resolveLaunchGreeting(undefined, "快速启动", owner, 0.5)).toBe("快速启动");
  expect(resolveLaunchGreeting({ messages: ["", " "] }, "你好，{name}", owner, 0.5)).toBe("你好，主人");
});
