// Clearing one agent page's saved data (channel A, docs/design/004-artifact-page-bridge.md), from the artifact's ⋯ menu
// and 设置 → 页面数据. Confirm by risk: the data are local to this desktop and limited to one page, and the owner clears
// them deliberately, so the control arms in place (click twice) with the page, size and host in its text — no typed
// name. The second click reads the usage again: data that changed since the first click (another save, another host
// in front, the page gone) are left alone with a notice.
import type { ArtifactSummary } from "../../../../shared/artifactStore";
import type { PageDataUsage } from "../../../../shared/pageBridge";
import { bridge } from "../../bridge";
import { translate } from "../../i18n";
import type { MenuAction } from "../../lib/contextMenu";
import { ARMED_TIMEOUT_MS } from "../../lib/armedConfirm";
import { SettingsRiskGate, settingsRiskFingerprint } from "../../lib/settingsRisk";
import { settingsRiskText as riskText } from "../../lib/settingsRiskText";
import { useApp } from "../../store";
import { services } from "../app";
import { formatBytes } from "./model";

type Page = Pick<ArtifactSummary, "artifactId" | "name">;
type Entry = PageDataUsage["items"][number];

const frames = () => bridge?.frames ?? null;
const hostLabel = (hostId: string) => useApp.getState().hosts?.hosts.find((host) => host.id === hostId)?.label ?? hostId;
const entryOf = (usage: PageDataUsage, hostId: string, artifactId: string) => usage.items.find((item) => item.hostId === hostId && item.artifactId === artifactId);

/** What the armed click is bound to: the host in front, the page's host label and its saved entry. */
export function pageDataClearFingerprint(hostId: string, entry: Entry | undefined): string {
  return settingsRiskFingerprint([useApp.getState().hosts?.active, hostLabel(hostId), entry ?? null]);
}

/** The armed text: what the second click clears (page, size, host; not undoable). */
export function pageDataClearArmedText(hostId: string, name: string, bytes: number): string {
  return translate("artifacts.pageData.clearArmed", { name, size: formatBytes(bytes), host: hostLabel(hostId) });
}

/**
 * Another host in front (even and back again) or the page's host relabelled from now on: the returned check turns
 * false. It stops watching by itself after the armed window.
 */
function watchHosts(hostId: string): () => boolean {
  const gate = new SettingsRiskGate();
  const scope = () => settingsRiskFingerprint([useApp.getState().hosts?.active, hostLabel(hostId)]);
  gate.update(scope());
  const valid = gate.capture();
  const unsubscribe = useApp.subscribe(() => gate.update(scope()));
  setTimeout(unsubscribe, ARMED_TIMEOUT_MS + 1000);
  return valid;
}

/** The ⋯ menu row: the first select reads the size and arms the row; nothing saved → says so instead. */
export function pageDataClearEntry(hostId: string, page: Page): MenuAction {
  let armed: { expected: string; valid(): boolean } | null = null;
  return {
    label: translate("artifacts.pageData.clear"),
    danger: true,
    prepare: async () => {
      const f = frames();
      const entry = f ? entryOf(await f.pageDataUsage(), hostId, page.artifactId) : undefined;
      if (!entry) return { empty: translate("artifacts.pageData.none", { name: page.name }) };
      armed = { expected: pageDataClearFingerprint(hostId, entry), valid: watchHosts(hostId) };
      return { armed: pageDataClearArmedText(hostId, page.name || entry.name || translate("artifacts.pageData.unnamed"), entry.bytes) };
    },
    onSelect: () => (armed ? clearPageData(hostId, page, armed.expected, armed.valid) : undefined),
  };
}

/**
 * The armed control's second click: clear when the page's data, its host and the host in front are still what the
 * first click showed (`expected`, pageDataClearFingerprint) and `valid()` holds; otherwise a notice, nothing cleared.
 */
export async function clearPageData(hostId: string, page: Page, expected: string, valid: () => boolean = () => true): Promise<void> {
  const f = frames();
  if (!f) return;
  try {
    const entry = entryOf(await f.pageDataUsage(), hostId, page.artifactId);
    if (!valid() || frames() !== f || pageDataClearFingerprint(hostId, entry) !== expected) {
      services.ui.notice(riskText("settingsRisk.changed"));
      return;
    }
    if (!entry) return;
    await f.pageDataClear(hostId, page.artifactId);
    services.ui.notice(translate("artifacts.pageData.cleared", { name: page.name || entry.name || translate("artifacts.pageData.unnamed") }));
  } catch (e) {
    services.ui.notice(String(e), "error");
  }
}
