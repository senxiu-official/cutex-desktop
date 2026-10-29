// QA 2026-10-27 P2: a DSH-only Profile created with "save the key here" but no key must reach cutex as an explicit
// stored credential (no `apiKeyEnv`), while the legacy create (neither key nor source) keeps DEEPSEEK_API_KEY.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ clients: [] as any[] }));
vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, shell: {} }));
vi.mock("@cutex-desktop/cutex-client", () => ({
  CutexClient: class {
    request = vi.fn(async () => ({ profile: { name: "ds" } }));
    constructor(public endpoint: unknown) { fixture.clients.push(this); }
    host() { return new Promise(() => {}); }
  },
  CutexApiError: class extends Error {},
  CutexUnreachableError: class extends Error {},
  EventFeed: class {},
  openStream: vi.fn(),
}));
import type { ProfilePreset } from "../src/shared/ipc";
import { DaemonService } from "../src/main/daemon";
import { newProfilePlan, previewCompatibility, type NewProfileDraft } from "../src/renderer/src/lib/profileVariants";

const deepseek = { id: "deepseek", aliases: [], label: "DeepSeek", providerId: "deepseek", baseUrl: "https://api.deepseek.com/", baseUrlRequired: false, defaultModel: "deepseek-flash", providerFamily: "deepseek", providerFamilyLabel: "DeepSeek" } as ProfilePreset;
const installed = { dshInstalled: true, claudeInstalled: true };
const draft = (over: Partial<NewProfileDraft>): NewProfileDraft => ({ provider: "apiKey", preset: "deepseek", baseUrl: "", apiKey: "", envName: null, runtimes: ["dsh"], defaults: {}, name: "ds", color: null, ...over });

describe("DSH create: credential source sent to cutex", () => {
  let service: DaemonService;
  beforeEach(() => {
    fixture.clients.length = 0;
    service = new DaemonService(() => {});
    service.useEndpoint({ baseUrl: "http://a.invalid", token: "fake" } as any, { remote: true });
  });
  afterEach(() => service.stop());
  const sent = () => fixture.clients.at(-1).request.mock.calls.at(-1);

  it("stored source chosen, key left empty: explicit stored credential, no env variable", async () => {
    const rows = previewCompatibility({ provider: "apiKey", envName: null, baseUrl: "" }, deepseek, installed);
    const r = newProfilePlan(draft({}), { name: "ds", preset: "deepseek" }, rows);
    if (!("plan" in r)) throw new Error(`plan failed: ${r.error}`);
    await service.createProfile(r.plan.create);
    const [method, path, { body }] = sent();
    expect([method, path]).toEqual(["POST", "/v2/profiles"]);
    expect(body).toEqual({ name: "ds", kind: "dsh", options: { dsh: { model: "deepseek-flash" } }, credential: { source: "stored" } });
    expect(JSON.stringify(body)).not.toContain("DEEPSEEK_API_KEY");
  });

  it("stored source with a key: the key goes with the stored source", async () => {
    await service.createProfile({ name: "ds", kind: "dsh", options: { dsh: { model: "deepseek-flash" } }, credential: { source: "stored" }, apiKey: "sk-test" });
    expect(sent()[2].body).toEqual({ name: "ds", kind: "dsh", options: { dsh: { model: "deepseek-flash" } }, credential: { source: "stored" }, apiKey: "sk-test" });
  });

  it("legacy create (neither key nor source) keeps the DEEPSEEK_API_KEY variable", async () => {
    await service.createProfile({ name: "ds", kind: "dsh", options: { dsh: { model: "deepseek-flash" } } });
    expect(sent()[2].body).toEqual({ name: "ds", kind: "dsh", options: { dsh: { model: "deepseek-flash", apiKeyEnv: "DEEPSEEK_API_KEY" } } });
  });
});
