// Additive r254 Director views. Authority and delivery decisions belong to cutex.
import type { CutexClient } from "./client";

export interface DirectorChange {
  changeId: string;
  projectId: string;
  oldDirector: string | null;
  newDirector: string | null;
  cleared?: boolean;
  oldEpoch: number | null;
  newEpoch: number;
  reason: string;
  state: "prepared" | "finalized" | "superseded" | "aborted";
  preparedAt: string;
  settledAt?: string;
  replacementActionId?: string;
}
export interface ProjectDirector {
  projectId: string;
  directorSessionId: string | null;
  authorityEpoch: number;
  changes: DirectorChange[];
}
export interface DirectorHandover {
  id: string;
  projectId: string;
  askId: string;
  from: string;
  to: string;
  changeId: string;
  revision: number;
  state: "pending" | "accepted" | "discarded" | "superseded";
  reason: string;
  provenanceKnown: boolean;
  actor?: string | null;
  ownerOnly?: boolean;
  resolvedTo?: string;
}
export interface DirectorStartReview {
  reviewId: string;
  projectId: string;
  sourceActionId: string;
  sourceMessageId: string;
  sourceOperation: string;
  originalRequester: string;
  originalDirector: string;
  targetSession: string;
  contentSha256: string;
  directorAtReview: string;
  epochAtReview: number;
  revision: number;
  state: "open" | "deliveryUnknown" | "adopted" | "discarded";
  adoptionId?: string;
  settledBy?: string;
  settledByOwner?: boolean;
  settleReason?: string;
  createdAt: string;
  updatedAt: string;
}
export interface DirectorFence {
  expectedEpoch: number;
  expectedRevision: number;
}
export interface DirectorScope {
  id: string;
  expectedEpoch: number;
  askIds: string[];
}
export interface DirectorScopeCandidate {
  askId: string;
  title: string;
  requester: { kind: "agent"; cutexSessionId: string; name?: string };
  targetSession: string;
  projectHint: string | null;
  provenanceKnown: boolean;
}
export interface DirectorReviewContent {
  reviewId: string;
  content: string;
  delivery: {
    message_id: string;
    state: string;
    error?: string;
    outcome: "not_delivered" | "unknown" | "owner_discarded";
    note?: string;
  };
}
const path = (project: string, tail = "") =>
  `/v2/projects/${encodeURIComponent(project)}/director${tail}`;
export const projectDirector = (client: CutexClient, project: string) =>
  client.request<ProjectDirector>("GET", path(project));
export const directorHandovers = (client: CutexClient, project: string) =>
  client.request<{ items: DirectorHandover[] }>(
    "GET",
    path(project, "/handover"),
  );
export const directorStartReviews = (client: CutexClient, project: string) =>
  client.request<{ items: DirectorStartReview[] }>(
    "GET",
    path(project, "/start-reviews"),
  );
export const decideDirectorItem = (
  client: CutexClient,
  project: string,
  kind: "handover" | "start-reviews",
  id: string,
  decision: "accept" | "discard",
  fence: DirectorFence,
) =>
  client.request<unknown>(
    "POST",
    path(project, `/${kind}/${encodeURIComponent(id)}/${decision}`),
    { body: fence },
  );
export const approveDirectorScope = (
  client: CutexClient,
  project: string,
  scope: DirectorScope,
) => client.request<unknown>("POST", path(project, "/scopes"), { body: scope });
export const directorScopeCandidates = (client: CutexClient, project: string) =>
  client.request<{ items: DirectorScopeCandidate[] }>(
    "GET",
    path(project, "/scopes/candidates"),
  );
export const directorReviewContent = (
  client: CutexClient,
  project: string,
  id: string,
) =>
  client.request<DirectorReviewContent>(
    "GET",
    path(project, `/start-reviews/${encodeURIComponent(id)}/content`),
  );
