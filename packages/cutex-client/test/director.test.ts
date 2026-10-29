import { describe, expect, it, vi } from "vitest";
import type { CutexClient } from "../src/client";
import {
  approveDirectorScope,
  decideDirectorItem,
  directorHandovers,
  directorReviewContent,
  directorScopeCandidates,
  directorStartReviews,
  projectDirector,
} from "../src/director";

describe("Director routes", () => {
  it("encodes project and item IDs without changing the epoch/revision fence", async () => {
    const request = vi.fn().mockResolvedValue({});
    const client = { request } as unknown as CutexClient;
    await decideDirectorItem(
      client,
      "p /?#",
      "start-reviews",
      "review:a/b?",
      "accept",
      { expectedEpoch: 8, expectedRevision: 3 },
    );
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "POST",
      "/v2/projects/p%20%2F%3F%23/director/start-reviews/review%3Aa%2Fb%3F/accept",
      { body: { expectedEpoch: 8, expectedRevision: 3 } },
    );
  });
  it("uses distinct read routes for lists, owner candidates and content", async () => {
    const request = vi.fn().mockResolvedValue({});
    const c = { request } as unknown as CutexClient;
    await projectDirector(c, "p");
    await directorHandovers(c, "p");
    await directorStartReviews(c, "p");
    await directorScopeCandidates(c, "p");
    await directorReviewContent(c, "p", "r/1");
    expect(request.mock.calls.map((c) => c[1])).toEqual([
      "/v2/projects/p/director",
      "/v2/projects/p/director/handover",
      "/v2/projects/p/director/start-reviews",
      "/v2/projects/p/director/scopes/candidates",
      "/v2/projects/p/director/start-reviews/r%2F1/content",
    ]);
  });
  it("approves only explicit IDs and preserves failures without a second call", async () => {
    const request = vi.fn().mockRejectedValue(new Error("unknown outcome"));
    const c = { request } as unknown as CutexClient;
    await expect(
      approveDirectorScope(c, "p", {
        id: "scope-1",
        expectedEpoch: 8,
        askIds: ["ask-a"],
      }),
    ).rejects.toThrow("unknown outcome");
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "POST",
      "/v2/projects/p/director/scopes",
      { body: { id: "scope-1", expectedEpoch: 8, askIds: ["ask-a"] } },
    );
  });
});
