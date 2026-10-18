import type { KeyObject } from "node:crypto";
export const TEST_SEED_TEXT: string;
export interface SigningKey { privateKey: KeyObject; keyId: Buffer }
export function testKey(): SigningKey;
export function publicKeyLine(key: SigningKey): string;
export function signMinisig(data: Uint8Array, fileName: string, key?: SigningKey, timestamp?: number): string;
