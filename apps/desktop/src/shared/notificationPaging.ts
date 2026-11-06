/** S10 (058): bounded approvals, owner-notification and safety-check pages. */
export const NOTIFICATION_PAGES_FEATURE = "owner-notify-approval-pages-v1";
export interface OwnerStorePageQuery { limit?: number; cursor?: string }
export interface ApprovalPage<T> { approvals: T[]; nextCursor?: string | null }
