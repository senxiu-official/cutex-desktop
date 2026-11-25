// Mock preview of cutex text-rewrite-v1 (提示词增强; shared/textRewrite.ts). SYNTHETIC answers, no model involved.
//   default          ~0.9 s, success with the route's first Profile
//   ?rewrite=fallback success after the first Profile ran out of quota (fallbackUsed)
//   ?rewrite=fail     every Profile tried fails (quota used up / signed out) → per-Profile reasons
//   ?rewrite=slow     8 s, to try Esc (cancel)
// Routes: the agent's own Profile then backups (功能 Profile IDs fp-… on hosts with feature-profiles), or a list.
import type { TextRewriteRequest, TextRewriteResult } from "../../../shared/textRewrite";

const pending = new Map<string, () => void>();

function scenario(): string {
  return typeof location === "undefined" ? "" : (new URLSearchParams(location.search).get("rewrite") ?? "");
}

function enhanced(text: string): string {
  const body = text.trim();
  return `目标：${body}\n\n要求：\n- 先列出要改的文件和改动范围，再动手\n- 不改无关代码；保留现有行为\n- 完成后运行相关测试，汇报通过与失败的数量`;
}

/** The Profiles a route would try, the agent's own first (here: `ownProfile`). */
function candidates(request: TextRewriteRequest, ownProfile: string): string[] {
  const r = request.route;
  if (r.mode === "profile") return r.profileIds;
  if (r.mode === "featureProfiles") return r.featureProfileIds;
  return [ownProfile, ...(r.fallbackFeatureProfileIds ?? r.fallbackProfileIds ?? [])];
}

export function mockTextRewrite(request: TextRewriteRequest, ownProfile: string): Promise<TextRewriteResult> {
  const mode = scenario();
  const tried = candidates(request, ownProfile);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(request.requestId);
      if (mode === "fail") {
        resolve({ ok: false, code: "rewrite_failed", attempts: tried.slice(0, 2).map((profileId, i) => ({ profileId, category: i === 0 ? "quota_exhausted" : "authentication" })) });
        return;
      }
      const fallback = mode === "fallback" && tried.length > 1;
      const profileId = fallback ? tried[1]! : tried[0]!;
      resolve({
        ok: true,
        rewrittenText: enhanced(request.text),
        missingDetails: ["要改的是哪个模块或页面？", "完成的标准：只要测试通过，还是也要截图？"],
        used: { profileId, provider: /claude/i.test(profileId) ? "anthropic" : "openai", model: /claude/i.test(profileId) ? "claude-sonnet-5-5" : "gpt-6.2", requestedModel: /claude/i.test(profileId) ? "claude-sonnet-5-5" : "gpt-6.2", fallbackUsed: fallback },
      });
    }, mode === "slow" ? 8000 : 900);
    pending.set(request.requestId, () => {
      clearTimeout(timer);
      pending.delete(request.requestId);
      resolve({ ok: false, code: "cancelled", attempts: [] });
    });
  });
}

export function mockCancelTextRewrite(requestId: string): void {
  pending.get(requestId)?.();
}
