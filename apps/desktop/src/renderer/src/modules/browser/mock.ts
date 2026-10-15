// Preview is deliberately an inert browser card. The ordinary mock bridge has no browser namespace;
// BrowserBody shows its localized placeholder and never creates a webview / loads an external URL.
// The host reports browser-open-full-access (r236), so Settings → 浏览器 shows the full-access hint
// (`?legacy`: the older wording).
import type { ModuleMock } from "../../dev/mockTypes";
export const mock: ModuleMock = { features: { new: ["browser-open-full-access"] } };
