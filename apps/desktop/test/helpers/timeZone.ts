// Test helper: pretend the machine is in another time zone ("here") for code that asks
// `Intl.DateTimeFormat().resolvedOptions().timeZone` — `localTimeZone()` (lib/dateText) and anything else reading it.
// Formatting is unaffected (a formatter with an explicit `timeZone` still formats in it); only what
// `resolvedOptions()` reports changes, for every formatter while faked.
//
//   import { withLocalTimeZone } from "./helpers/timeZone";
//   it("…", () => withLocalTimeZone("Australia/Sydney", () => { … }));
//
// Or around a whole file: `beforeEach(() => fakeLocalTimeZone("Australia/Sydney"))` + `afterEach(() => vi.restoreAllMocks())`.
import { vi } from "vitest";

/** Fakes "here" until `vi.restoreAllMocks()` (or the returned spy's `mockRestore()`). */
export function fakeLocalTimeZone(timeZone: string) {
  const real = Intl.DateTimeFormat.prototype.resolvedOptions;
  return vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...real.call(this), timeZone };
  });
}

/** Runs `fn` with "here" = `timeZone`, then restores it (also when `fn` throws; awaits a promise). */
export function withLocalTimeZone<T>(timeZone: string, fn: () => T): T {
  const spy = fakeLocalTimeZone(timeZone);
  let async = false;
  try {
    const out = fn();
    if (out instanceof Promise) {
      async = true;
      return out.finally(() => spy.mockRestore()) as T;
    }
    return out;
  } finally {
    if (!async) spy.mockRestore();
  }
}
