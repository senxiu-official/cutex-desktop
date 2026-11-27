import { expect, it } from "vitest";
import { paCreateBody, paUpdateBody, readPaCreateOptions, readPaView, type PaRuntimePolicy } from "../src/shared/personalAssistants";

const config = { name: "PA", profile: "gpt", homeInstanceId: "eva", projectIds: [] };
const policy: PaRuntimePolicy = { version: 1, initialPermissionMode: "auto", checkInFullAccess: false, authorizedWriteProjects: [] };
const assistant = { id: "pa-1", revision: 1, config, grants: {}, enabled: true };

it("omits the new create field for older hosts and validates explicit choices", () => {
  expect(paCreateBody({ actionId: "create", config })).not.toHaveProperty("permissionMode");
  expect(paCreateBody({ actionId: "create", config, permissionMode: "fullAccess" }).permissionMode).toBe("fullAccess");
  expect(() => paCreateBody({ actionId: "create", config, permissionMode: "bypass" as never })).toThrow();
});
it("rebuilds owner runtime settings without injecting product authority", () => {
  const change = paUpdateBody({ actionId: "mode", expectedRevision: 1, change: { kind: "runtime", policy: { ...policy, fullOwner: true } as never } }).change;
  expect(change).toEqual({ kind: "runtime", policy });
  expect(() => paUpdateBody({ actionId: "mode", expectedRevision: 1, change: { kind: "runtime", policy: { ...policy, version: 2 } as never } })).toThrow();
});
it("reads new choices and persisted canonical modes while keeping legacy replies compatible", () => {
  const runtime = { behavior: "agent", permissionMode: "fullAccess", policy, workspace: "D:/private/pa" };
  expect(readPaView({ assistant, runtime }).runtime).toEqual(runtime);
  expect(readPaView({ assistant }).runtime).toBeUndefined();
  expect(() => readPaView({ assistant, runtime: { ...runtime, policy: null } })).toThrow();
  const options = readPaCreateOptions({ homeInstanceId: "eva", profiles: [], capabilities: {}, observedAt: "now", permissionModes: ["auto", "fullAccess"], defaultPermissionMode: "auto" });
  expect(options.defaultPermissionMode).toBe("auto");
});
