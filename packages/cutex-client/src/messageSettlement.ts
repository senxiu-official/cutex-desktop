import type { MessageSettlementCloseRequest } from "@cutex-desktop/protocol";

/** Rebuild the strict body at both trust boundaries; never generate or replace a request key. */
export function messageSettlementCloseBody(request: MessageSettlementCloseRequest): MessageSettlementCloseRequest {
  if (!request || typeof request !== "object") throw new Error("bad settlement request");
  const limits = { messageId: 512, expectedEvidenceToken: 256, requestId: 128, reason: 1024 } as const;
  for (const key of ["messageId", "expectedEvidenceToken", "requestId", "reason"] as const) {
    if (typeof request[key] !== "string" || !request[key].trim() || new TextEncoder().encode(request[key]).length > limits[key]) throw new Error(`bad settlement ${key}`);
  }
  return { messageId: request.messageId, expectedEvidenceToken: request.expectedEvidenceToken, requestId: request.requestId, reason: request.reason };
}
