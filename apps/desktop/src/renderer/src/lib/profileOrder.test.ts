import { describe, expect, it } from "vitest";
import { applyProfileOrder, canMoveProfile, dropProfile, moveProfile } from "./profileOrder";

const p = (id: string, name = id.toUpperCase()) => ({ id, name });
const ids = (list: { id: string }[]) => list.map((x) => x.id);

describe("applyProfileOrder", () => {
  const items = [p("a"), p("b"), p("c"), p("d")];

  it("keeps cutex's order when nothing is saved", () => {
    expect(ids(applyProfileOrder(items, []))).toEqual(["a", "b", "c", "d"]);
  });

  it("puts listed profiles first in the saved order", () => {
    expect(ids(applyProfileOrder(items, ["c", "a", "b", "d"]))).toEqual(["c", "a", "b", "d"]);
  });

  it("keeps unlisted profiles in their incoming order after the listed ones", () => {
    expect(ids(applyProfileOrder(items, ["d", "b"]))).toEqual(["d", "b", "a", "c"]);
  });

  it("ignores ids of deleted profiles", () => {
    expect(ids(applyProfileOrder(items, ["gone", "c"]))).toEqual(["c", "a", "b", "d"]);
  });

  it("matches by name when the id is not listed", () => {
    expect(ids(applyProfileOrder(items, ["C"]))).toEqual(["c", "a", "b", "d"]);
  });

  it("does not mutate the input", () => {
    const copy = [...items];
    applyProfileOrder(items, ["d"]);
    expect(items).toEqual(copy);
  });

  it("uses the first position of a duplicated id", () => {
    expect(ids(applyProfileOrder(items, ["b", "a", "b"]))).toEqual(["b", "a", "c", "d"]);
  });
});

describe("dropProfile", () => {
  const shown = ["a", "b", "c", "d"];
  it("drops before the target", () => expect(dropProfile(shown, "d", "b", false)).toEqual(["a", "d", "b", "c"]));
  it("drops after the target", () => expect(dropProfile(shown, "a", "c", true)).toEqual(["b", "c", "a", "d"]));
  it("is a no-op on itself", () => expect(dropProfile(shown, "b", "b", true)).toEqual(shown));
  it("is a no-op for an unknown target", () => expect(dropProfile(shown, "b", "x", true)).toEqual(shown));
  it("is a no-op for an unknown dragged id", () => expect(dropProfile(shown, "x", "b", true)).toEqual(shown));
});

describe("moveProfile", () => {
  const shown = ["a", "b", "c"];
  it("moves up", () => expect(moveProfile(shown, "c", "up")).toEqual(["a", "c", "b"]));
  it("moves down", () => expect(moveProfile(shown, "a", "down")).toEqual(["b", "a", "c"]));
  it("moves to the top", () => expect(moveProfile(shown, "c", "top")).toEqual(["c", "a", "b"]));
  it("stays at the edges", () => {
    expect(moveProfile(shown, "a", "up")).toEqual(shown);
    expect(moveProfile(shown, "c", "down")).toEqual(shown);
    expect(moveProfile(shown, "a", "top")).toEqual(shown);
  });
  it("ignores an unknown id", () => expect(moveProfile(shown, "x", "top")).toEqual(shown));
});

describe("canMoveProfile", () => {
  it("knows the edges", () => {
    expect(canMoveProfile(0, 3, "up")).toBe(false);
    expect(canMoveProfile(0, 3, "top")).toBe(false);
    expect(canMoveProfile(0, 3, "down")).toBe(true);
    expect(canMoveProfile(2, 3, "down")).toBe(false);
    expect(canMoveProfile(2, 3, "top")).toBe(true);
    expect(canMoveProfile(-1, 3, "up")).toBe(false);
  });
});
