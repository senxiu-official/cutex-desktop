// Composer permission menu: network access and extra writable directories of a running workspace-write
// agent (cutex `session-sandbox-extras`). cutex stores them on the session (kept across restarts) and
// pushes them to the running thread, which uses them from its next turn. Shown only where
// liveExtrasApply (lib/permissionModes) says so; the folder picker goes through the agent's host.
import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { TargetHostContext } from "../lib/targetHost";
import { hostApi } from "../store";
import { WritableRootsEditor } from "./LaunchOptions";
import { Toggle } from "./settings/Form";

type Note = { kind: "nextTurn" | "stored" } | { kind: "failed"; error: string };

export function LiveSandboxExtras({ hostId, sessionId, network, roots }: { hostId: string; sessionId: string; network: boolean; roots: string[] }) {
  const { t } = useI18n();
  // What was saved but is not on the live thread yet (offline / refused push), or is in flight.
  const [pending, setPending] = useState<{ network: boolean; roots: string[] } | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [saving, setSaving] = useState(false);
  const rootsKey = roots.join("\n");
  // The live thread reported new settings (thread/settings/updated): show those.
  useEffect(() => setPending(null), [network, rootsKey]);
  const shown = pending ?? { network, roots };

  const save = async (next: { network: boolean; roots: string[] }, patch: { networkAccess?: boolean; writableRoots?: string[] }) => {
    setSaving(true);
    setPending(next);
    try {
      const result = await hostApi(hostId).setSessionSandboxExtras(sessionId, patch);
      const applied = result.live?.status === "applied";
      setNote({ kind: applied ? "nextTurn" : "stored" });
      // Applied: thread/settings/updated replaces the values shortly. Otherwise keep what cutex stored.
      if (!applied) setPending({ network: result.networkAccess, roots: result.writableRoots });
    } catch (e) {
      setPending(null);
      setNote({ kind: "failed", error: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-1 border-t border-border px-2.5 pt-1.5 pb-1 text-xs" data-testid="live-sandbox-extras">
      <div className="mb-1 text-subtle">{t("composer.live.title")}</div>
      <div className="flex items-center justify-between gap-3 py-0.5" title={t("composer.live.networkHint")}>
        <span className="text-muted">{t("launch.network")}</span>
        <Toggle label={t("launch.network")} checked={shown.network} disabled={saving}
          onChange={(networkAccess) => void save({ ...shown, network: networkAccess }, { networkAccess })} />
      </div>
      <div className="flex items-start justify-between gap-3 py-0.5">
        <span className="shrink-0 pt-0.5 text-muted">{t("launch.writableRoots")}</span>
        <TargetHostContext.Provider value={hostId}>
          <WritableRootsEditor roots={shown.roots} disabled={saving}
            onChange={(writableRoots) => void save({ ...shown, roots: writableRoots }, { writableRoots })} />
        </TargetHostContext.Provider>
      </div>
      <div className={`mt-1 max-w-72 ${note?.kind === "failed" ? "text-danger" : "text-subtle"}`} role={note?.kind === "failed" ? "alert" : undefined}>
        {note?.kind === "failed" ? t("composer.live.failed", { error: note.error }) : note?.kind === "stored" ? t("composer.live.stored") : t("composer.live.nextTurn")}
      </div>
    </div>
  );
}
