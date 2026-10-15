import { describe, expect, it } from "vitest";
import { shownSessions } from "../src/shared/hiddenSessions";

describe("shownSessions", () => {
  it("keeps visible rows and hidden persistent agents, drops hidden local-only sessions", () => {
    const rows = [
      { id: "a", visible: true, registrationClass: "local_only" },
      { id: "b", visible: false, registrationClass: "persistent" },
      { id: "c", visible: false, registrationClass: "local_only" },
      { id: "d", visible: false, registrationClass: null },
    ];
    expect(shownSessions(rows).map((r) => r.id)).toEqual(["a", "b"]);
  });
});
