import { beforeEach, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, shell: {} }));
import { DaemonService } from "../src/main/daemon";
import { PROFILE_PORTRAIT_THEME_32_FEATURE } from "../src/shared/profilePortraitThemes";

let service: DaemonService;
const request = vi.fn();
const capabilities = vi.fn();
beforeEach(() => {
  request.mockReset().mockResolvedValue({ profile: { id: "profile" } });
  capabilities.mockReset().mockResolvedValue({ featureList: ["profile-avatar-style"] });
  service = Object.create(DaemonService.prototype) as DaemonService;
  Object.assign(service, { requireClient: () => ({ request }), capabilities });
});

it("saves a rename on an old host and returns its unsaved portrait problem", async () => {
  request.mockResolvedValue({ profile: { id: "profile", name: "New name" } });
  const draft = { name: "New name", avatarStyle: { kind: "portrait" as const, portraitThemes: ["kit-20261029/mountain-city-myriad-layers"] } };
  const result = await service.patchProfile("profile", draft);
  expect(request).toHaveBeenCalledWith("PATCH", "/v2/profiles/profile", { body: { name: "New name" } });
  expect(result).toEqual({ id: "profile", name: "New name", portraitProblem: { kind: "invalidReferences", references: draft.avatarStyle.portraitThemes, maxThemeLength: 20 } });
  expect(draft.avatarStyle.portraitThemes).toEqual(["kit-20261029/mountain-city-myriad-layers"]);
});

it("returns the current profile and problem without an empty PATCH for a style-only draft", async () => {
  const result = await service.patchProfile("profile", { avatarStyle: { kind: "portrait", portraitThemes: ["kit-20261029/university-universalis"] }, avatarStyleImportIfUnset: true });
  expect(request).toHaveBeenCalledExactlyOnceWith("GET", "/v2/profiles/profile");
  expect(result.portraitProblem?.references).toEqual(["kit-20261029/university-universalis"]);
  expect(result.id).toBe("profile");
});

it("does not report a partial save when the remaining PATCH fails", async () => {
  request.mockRejectedValue(new Error("rename refused"));
  await expect(service.patchProfile("profile", { name: "Taken", avatarStyle: { kind: "portrait", portraitThemes: ["kit-20261029/university-universalis"] } })).rejects.toThrow("rename refused");
});

it("does not mistake undefined fields for a remaining mutation", async () => {
  await service.patchProfile("profile", { name: undefined, avatarStyle: { kind: "portrait", portraitThemes: ["kit-20261029/university-universalis"] } });
  expect(request).toHaveBeenCalledExactlyOnceWith("GET", "/v2/profiles/profile");
});

it("forwards exact long IDs to a host advertising the expanded contract", async () => {
  capabilities.mockResolvedValue({ featureList: ["profile-avatar-style", PROFILE_PORTRAIT_THEME_32_FEATURE] });
  const body = { avatarStyle: { kind: "portrait" as const, portraitThemes: ["kit-20261029/mountain-city-myriad-layers", "kit-20261029/university-universalis"] } };
  await service.patchProfile("profile", body);
  expect(request).toHaveBeenCalledWith("PATCH", "/v2/profiles/profile", { body });
});

it("still refuses path-invalid references on an expanded host", async () => {
  capabilities.mockResolvedValue({ featureList: [PROFILE_PORTRAIT_THEME_32_FEATURE] });
  await expect(service.patchProfile("profile", { avatarStyle: { kind: "portrait", portraitThemes: ["pack/../theme"] } })).rejects.toThrow("invalid_portrait_themes");
  expect(request).not.toHaveBeenCalled();
});

it("does not let an over-limit list hide an unsafe reference while saving other fields", async () => {
  const portraitThemes = ["pack/../theme", ...Array.from({ length: 128 }, (_, i) => `pack/theme-${i}`)];
  await expect(service.patchProfile("profile", { name: "New name", avatarStyle: { kind: "portrait", portraitThemes } })).rejects.toThrow("invalid_portrait_themes");
  expect(request).not.toHaveBeenCalled();
});

it("does not fetch extra capabilities for unrelated fields or explicit inheritance", async () => {
  await service.patchProfile("profile", { name: "New name", avatarStyle: null });
  expect(capabilities).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledOnce();
});
