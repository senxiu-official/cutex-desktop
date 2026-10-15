// The words of "who you are on a host" (Settings → 你 → 你在各主机上, Settings → 用户 → 你在这台主机上;
// docs/research/identity-settings-review-20261015.md §4.1.2): the role line (主人 · 全部项目 / 用户「Mia
// Chen」 · 只读 · projects / 等主人分配 / 未连接 · 上次是 …) and the device line (这台电脑就是这台主机 /
// 这台电脑在此是「…」 / 请告诉主人：这台设备叫「…」).
import { useState } from "react";
import { useI18n } from "../../i18n";
import { foldNames, type DeviceLine, type MyAccessRow } from "../../lib/myAccess";

export function RoleLine({ row, stale }: { row: MyAccessRow; stale: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const folded = Array.isArray(row.projects) ? foldNames(row.projects, 5, open) : null;
  const words = (
    <>
      {row.role === "owner" && (
        <>
          <span className="text-accent">{t("identity.role.owner")}</span>
          <span>·</span>
          <span>{t("me.access.allProjects")}</span>
        </>
      )}
      {row.role === "older" && <span className="text-accent">{t("me.access.role.older")}</span>}
      {row.role === "pending" && <span className="text-warn">{t("me.access.role.pending")}</span>}
      {row.role === "member" && (
        <>
          <span>{t("me.access.role.member", { name: row.userName ?? "" })}</span>
          <span>·</span>
          <span>{t(row.send ? "me.access.send" : "me.access.readOnly")}</span>
          <span>·</span>
          {row.projects === "all" ? (
            <span>{t("me.access.allProjects")}</span>
          ) : !row.projects?.length && !row.standalone ? (
            <span>{t("me.access.noProjects")}</span>
          ) : (
            <span className="min-w-0">
              {folded!.shown.join(t("me.access.listSeparator"))}
              {folded!.more > 0 && (
                <button type="button" className="ml-1 text-accent hover:underline" onClick={(e) => (e.stopPropagation(), setOpen(true))}>
                  {t("me.access.more", { n: folded!.more })}
                </button>
              )}
              {row.standalone > 0 && <span>{(folded!.shown.length ? " · " : "") + t("me.access.standalone", { n: row.standalone })}</span>}
            </span>
          )}
        </>
      )}
    </>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted" data-testid="my-access-role">
      {row.role === "unknown" || stale ? (
        <>
          <span>{t("me.access.role.unknown")}</span>
          {stale && (
            <>
              <span>·</span>
              <span>{t("me.access.lastKnown")}</span>
              {words}
            </>
          )}
        </>
      ) : (
        words
      )}
    </div>
  );
}

export function DeviceLineText({ device }: { device: DeviceLine }) {
  const { t } = useI18n();
  if (!device) return null;
  return (
    <div className={`truncate text-xs ${device.kind === "tell" ? "text-warn" : "text-subtle"}`} data-testid="my-access-device">
      {device.kind === "root" ? t("me.access.device.root") : t(device.kind === "tell" ? "me.access.device.tell" : "me.access.device.token", { device: device.name })}
    </div>
  );
}
