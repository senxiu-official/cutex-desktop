// @vitest-environment jsdom
// State surfaces WP-D4 (fix plan S8 / L6, audit table 4.7): per-item 结束跟进, absolute deadline → unconfirmed,
// per-item clear, persisted unsettled receipts.
import { beforeEach, expect, it } from "vitest";
import {
  beginOperation, clearFinishedOperations, clearOperationItem, expireOperations, OPERATION_DEADLINE_MS, operationItem, operationRunning, operationsSummary,
  reloadOperationsFromStorage, replaceOperationItems, restoreOperations, stopWaitingItem, storedOperations, trackedOperationItem, updateOperationItem, useBackgroundOperations,
} from "../src/renderer/src/lib/backgroundOperations";

beforeEach(() => {
  localStorage.clear();
  useBackgroundOperations.setState({ operations: [] });
});
const ops = () => useBackgroundOperations.getState().operations;

it("结束跟进 stops waiting for one item without holding the others; a late result does not change it", async () => {
  const id = beginOperation("local", "operations.kind.start", [{ key: "a", name: "A" }, { key: "b", name: "B" }]);
  let finish!: () => void;
  const work = trackedOperationItem({ operationId: id, key: "a" }, () => new Promise<void>((r) => { finish = r; }));
  updateOperationItem({ operationId: id, key: "b" }, { state: "done" });
  expect(operationRunning(ops()[0]!)).toBe(true);
  stopWaitingItem({ operationId: id, key: "a" });
  expect(operationItem({ operationId: id, key: "a" })!.state).toBe("trackingStopped");
  expect(operationRunning(ops()[0]!)).toBe(false);
  finish();
  await work;
  expect(operationItem({ operationId: id, key: "a" })!.state).toBe("trackingStopped");
  // A final item is never stopped again or re-run by a replace.
  replaceOperationItems(id, [{ key: "a", name: "A", state: "running" }, { key: "b", name: "B", state: "done" }]);
  expect(operationItem({ operationId: id, key: "a" })!.state).toBe("trackingStopped");
});

it("an item still waiting past its absolute deadline becomes unconfirmed; only a final result changes it later", () => {
  const id = beginOperation("local", "operations.kind.start", [{ key: "a", name: "A" }, { key: "b", name: "B" }]);
  const op = ops()[0]!;
  expect(op.deadline).toBe(op.startedAt + OPERATION_DEADLINE_MS);
  updateOperationItem({ operationId: id, key: "a" }, { state: "running" });
  expireOperations(op.deadline - 1);
  expect(operationItem({ operationId: id, key: "a" })!.state).toBe("running");
  // Progress does not renew the deadline.
  updateOperationItem({ operationId: id, key: "a" }, { state: "running", detail: "retrying" });
  expireOperations(op.deadline);
  expect(operationItem({ operationId: id, key: "a" })).toMatchObject({ state: "unconfirmed", unconfirmedBy: "deadline" });
  expect(operationItem({ operationId: id, key: "b" })!.state).toBe("unconfirmed");
  expect(ops()[0]!.unreadFailure).toBe(true);
  expect(operationsSummary(ops()).running).toBe(0);
  updateOperationItem({ operationId: id, key: "a" }, { state: "running" });
  expect(operationItem({ operationId: id, key: "a" })!.state).toBe("unconfirmed");
  updateOperationItem({ operationId: id, key: "a" }, { state: "done" });
  expect(operationItem({ operationId: id, key: "a" })!.state).toBe("done");
});

it("clears per item, not per group; a waiting item cannot be cleared", () => {
  const id = beginOperation("local", "operations.kind.start", [{ key: "a", name: "A" }, { key: "b", name: "B" }, { key: "c", name: "C" }]);
  updateOperationItem({ operationId: id, key: "a" }, { state: "done" });
  updateOperationItem({ operationId: id, key: "b" }, { state: "done" });
  clearOperationItem({ operationId: id, key: "c" });
  expect(ops()[0]!.items.map((i) => i.key)).toEqual(["a", "b", "c"]);
  clearOperationItem({ operationId: id, key: "a" });
  expect(ops()[0]!.items.map((i) => i.key)).toEqual(["b", "c"]);
  expect(operationsSummary(ops())).toMatchObject({ done: 2, total: 3 });
  // 清除已结束的 drops finished items even while another item of the same operation still waits.
  clearFinishedOperations();
  expect(ops()[0]!.items.map((i) => i.key)).toEqual(["c"]);
  expect(operationsSummary(ops())).toMatchObject({ running: 1, done: 2, total: 3 });
  stopWaitingItem({ operationId: id, key: "c" });
  clearOperationItem({ operationId: id, key: "c" });
  expect(ops()).toHaveLength(0);
});

it("persists unsettled receipts (operation id, item key, action id); after a restart they read unconfirmed", () => {
  const id = beginOperation("remote", "operations.kind.restore", [{ key: "a", name: "A", actionId: "act-1" }, { key: "b", name: "B" }, { key: "c", name: "C" }]);
  updateOperationItem({ operationId: id, key: "b" }, { state: "done" });
  stopWaitingItem({ operationId: id, key: "c" });
  const stored = storedOperations(ops());
  expect(stored).toEqual([{ operationId: id, hostId: "remote", titleKey: "operations.kind.restore", titleVars: { n: 3 }, startedAt: ops()[0]!.startedAt, items: [{ key: "a", name: "A", actionId: "act-1", state: "waiting" }] }]);
  expect(JSON.parse(localStorage.getItem("cutex-desktop.backgroundOperations.v1")!)).toEqual(stored);
  reloadOperationsFromStorage();
  expect(ops()).toHaveLength(1);
  expect(ops()[0]).toMatchObject({ id, hostId: "remote", unreadFailure: true });
  expect(ops()[0]!.items).toEqual([{ key: "a", name: "A", actionId: "act-1", state: "unconfirmed", unconfirmedBy: "restart" }]);
  // Still unconfirmed after a second restart, until cleared.
  reloadOperationsFromStorage();
  expect(ops()[0]!.items[0]!.state).toBe("unconfirmed");
  clearOperationItem({ operationId: id, key: "a" });
  expect(localStorage.getItem("cutex-desktop.backgroundOperations.v1")).toBeNull();
  reloadOperationsFromStorage();
  expect(ops()).toHaveLength(0);
});

it("restores nothing from malformed storage", () => {
  localStorage.setItem("cutex-desktop.backgroundOperations.v1", "{not json");
  reloadOperationsFromStorage();
  expect(ops()).toEqual([]);
  expect(restoreOperations([])).toEqual([]);
});
