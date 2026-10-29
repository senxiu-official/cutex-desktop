// Fakes only: no test reaches cutex or a real account; the consume call is a stub.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { consumeResultOf, creditToUse, hasResetCredits, resetCreditsViewOf, soonestExpiry, validIdempotencyKey, newIdempotencyKey, type ResetCreditsView } from "../../../shared/resetCredits";

const confirm = vi.fn<(message: string) => Promise<boolean>>();
const consume = vi.fn();
const read = vi.fn();
const toast = vi.fn();
const notify = vi.fn();
vi.mock("./contextMenu", () => ({ confirmDialog: (message: string) => confirm(message) }));
vi.mock("./hostLists", () => ({ hostApi: () => ({ consumeResetCredit: consume, profileResetCredits: read }) }));
vi.mock("./shelves", () => ({ showShelfToast: (text: string) => toast(text) }));
vi.mock("../store", () => ({ useApp: { getState: () => ({ notify }) } }));

const { confirmText, spendResetCredit, summaryText, outcomeText } = await import("./resetCredits");

const t = (key: string, vars?: Record<string, string | number>) => (vars ? `${key}${JSON.stringify(vars)}` : key);

function codexView(over: Partial<ResetCreditsView> = {}): ResetCreditsView {
  return resetCreditsViewOf({
    profile: { id: "p1", name: "gamma" },
    provider: "codex",
    supported: true,
    availableCount: 2,
    detailsComplete: true,
    credits: [
      { id: "rc_late", status: "available", expiresAt: 2_000_000_000, resetsLeft: 1 },
      { id: "rc_soon", status: "available", expiresAt: 1_900_000_000, resetsLeft: 1 },
      { id: "rc_used", status: "redeemed", expiresAt: 1_800_000_000 },
    ],
    ...over,
  })!;
}

describe("reset credit views", () => {
  it("normalizes replies and picks the soonest-expiring usable credit", () => {
    const view = codexView();
    expect(view.credits).toHaveLength(3);
    expect(creditToUse(view)).toBe("rc_soon");
    expect(soonestExpiry(view)).toBe(1_900_000_000);
    expect(hasResetCredits(view)).toBe(true);
    expect(hasResetCredits(codexView({ availableCount: 0 }))).toBe(false);
    expect(resetCreditsViewOf({ nonsense: 1 })).toBeNull();
    const glm = resetCreditsViewOf({ profile: { name: "GLM" }, provider: "glm", supported: false, unsupportedReason: "zcodeOnly" })!;
    expect(hasResetCredits(glm)).toBe(false);
    expect(summaryText(glm, t as never, "en")).toBe("resets.unsupported.zcodeOnly");
  });

  it("coerces outcomes and validates idempotency keys", () => {
    expect(consumeResultOf({ outcome: "reset", resetsLeft: 1 })).toEqual({ outcome: "reset", reason: null, resetsLeft: 1 });
    expect(consumeResultOf({ outcome: "brandNew" }).outcome).toBe("unavailable");
    expect(validIdempotencyKey(newIdempotencyKey())).toBe(true);
    expect(validIdempotencyKey("x")).toBe(false);
    expect(validIdempotencyKey("has space 1234")).toBe(false);
  });

  it("the confirm text names the account and says it cannot be undone", () => {
    const text = confirmText(codexView(), t as never, "en");
    expect(text).toContain("resets.account.codex");
    expect(text).toContain("gamma");
    expect(text).toContain("resets.confirm.final");
    const claude = resetCreditsViewOf({ profile: { name: "claude" }, provider: "claude", supported: true, availableCount: 1, account: { id: "ca-work" }, credits: [] })!;
    expect(confirmText(claude, t as never, "en")).toMatch(/resets.account.claude.*ca-work/);
    expect(outcomeText("nothingToReset", t as never, null)).toBe("resets.outcome.nothingToReset");
  });
});

describe("spendResetCredit", () => {
  beforeEach(() => {
    confirm.mockReset();
    consume.mockReset();
    read.mockReset().mockResolvedValue(null);
    toast.mockReset();
    notify.mockReset();
  });

  it("does nothing when the owner cancels", async () => {
    confirm.mockResolvedValue(false);
    await spendResetCredit({ hostId: "h", profile: "gamma", view: codexView(), t: t as never, locale: "en" });
    expect(consume).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("confirmed: uses the soonest credit with a key, toasts and re-reads", async () => {
    confirm.mockResolvedValue(true);
    consume.mockResolvedValue({ outcome: "reset", resetsLeft: 1 });
    const after = vi.fn();
    await spendResetCredit({ hostId: "h", profile: "gamma", view: codexView(), t: t as never, locale: "en", afterReset: after });
    expect(consume).toHaveBeenCalledTimes(1);
    const [profile, body] = consume.mock.calls[0]!;
    expect(profile).toBe("gamma");
    expect(body.creditId).toBe("rc_soon");
    expect(validIdempotencyKey(body.idempotencyKey)).toBe(true);
    expect(toast).toHaveBeenCalledWith('resets.outcome.resetLeft{"n":1}');
    expect(after).toHaveBeenCalled();
    expect(read).toHaveBeenCalledWith("gamma", true);
  });

  it("a failed click's retry reuses its key, so a second credit is never used", async () => {
    confirm.mockResolvedValue(true);
    consume.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce({ outcome: "alreadyRedeemed" });
    await spendResetCredit({ hostId: "h2", profile: "gamma", view: codexView(), t: t as never, locale: "en" });
    expect(notify).toHaveBeenCalledTimes(1);
    await spendResetCredit({ hostId: "h2", profile: "gamma", view: codexView(), t: t as never, locale: "en" });
    expect(consume.mock.calls[1]![1].idempotencyKey).toBe(consume.mock.calls[0]![1].idempotencyKey);
    // Settled: the next click is a new attempt.
    consume.mockResolvedValueOnce({ outcome: "reset" });
    await spendResetCredit({ hostId: "h2", profile: "gamma", view: codexView(), t: t as never, locale: "en" });
    expect(consume.mock.calls[2]![1].idempotencyKey).not.toBe(consume.mock.calls[0]![1].idempotencyKey);
  });
});
