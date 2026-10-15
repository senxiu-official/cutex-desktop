export const DEFAULT_MANAGEMENT_URL = "http://127.0.0.1:24270";

export interface DaemonEndpoint {
  baseUrl: string;
  /** Bearer token (root / client / device); null when cutex runs without auth. */
  token: string | null;
  /** Where the token came from, for diagnostics (local config path, `ssh:<target>`, ...). */
  configPath?: string;
}
