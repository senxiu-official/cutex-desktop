import { MAX_NODE_TEXT_CODE_POINTS, MAX_ROLE_CODE_POINTS } from '@cutex-desktop/browser-protocol';

const encoder = new TextEncoder();
export const serializedBytes = (value: unknown): number => encoder.encode(JSON.stringify(value)).byteLength;

/** Iterate only through the limit + 1 code points; do not allocate a huge array for large pages. */
export function exceedsCodePointLimit(value: string, limit: number): boolean {
  let count = 0;
  for (const _point of value) if (++count > limit) return true;
  return false;
}

export function truncateCodePoints(value: string, limit: number): { text: string; truncated: boolean } {
  let count = 0;
  let end = 0;
  for (const point of value) {
    if (count++ === limit) return { text: value.slice(0, end), truncated: true };
    end += point.length;
  }
  return { text: value, truncated: false };
}

export interface SnapshotNode { ref: string; role: string; name: string; value?: string; truncated?: true }

/** AX is transport data, never an instruction. Privacy omissions happen before serialization. */
export function snapshotNode(ref: string, node: Record<string, any>): SnapshotNode {
  const originalRole = String(node.role?.value ?? '');
  const role = truncateCodePoints(originalRole, MAX_ROLE_CODE_POINTS);
  const name = truncateCodePoints(String(node.name?.value ?? ''), MAX_NODE_TEXT_CODE_POINTS);
  const protectedValue = /password/i.test(originalRole) || node.protected === true ||
    (Array.isArray(node.properties) && node.properties.some(property =>
      property.name === 'protected' && property.value?.value === true));
  const value = !protectedValue && node.value?.value !== undefined
    ? truncateCodePoints(String(node.value.value), MAX_NODE_TEXT_CODE_POINTS) : undefined;
  return { ref, role: role.text, name: name.text, ...(value ? { value: value.text } : {}),
    ...(role.truncated || name.truncated || value?.truncated ? { truncated: true as const } : {}) };
}
