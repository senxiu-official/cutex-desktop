// 新建 Profile step ③ (P1): the one runtime the login method leads to — a Profile on today's cutex
// has exactly one. Its component notice (Claude / DSH need theirs installed before agents start)
// and, on a relay, what the relay must speak.
import { useI18n } from "../../../i18n";
import { CLAUDE_RUNTIME_COMPONENT, DSH_RUNTIME_COMPONENT } from "../../../lib/componentCard";
import { relayHost, RUNTIME_LABEL, type Resolved } from "../../../lib/newProfileModel";
import { ComponentNotice } from "../../ComponentCard";
import { CreationRuntimeTag } from "../../CreationRuntimeTag";
import { Tag } from "../../Tag";
import { Notice } from "../Form";

export function RuntimeStep({ resolved, address, hostId }: { resolved: Resolved; address: string | null; hostId: string }) {
  const { t } = useI18n();
  const runtime = resolved.option.runtime;
  const relay = relayHost(resolved, address);
  return (
    <div className="pb-2">
      <div className="rounded-md border border-border px-3" data-runtime-step={runtime}>
        <div className="flex min-h-10 flex-wrap items-center gap-2.5 py-1.5">
          <span className="w-24 flex-none text-sm font-medium">{RUNTIME_LABEL[runtime]}</span>
          <CreationRuntimeTag runtime={runtime} />
          <span className="min-w-40 flex-1 text-xs text-subtle">
            {runtime === "kimi" ? t("variants.runtime.kimi.what") : t(`newProfile.runtime.desc.${runtime}`)}
            {resolved.option.auth === "chatgpt" && <span className="block">{t("newProfile.runtime.chatgptLogin")}</span>}
            {relay && <span className="block" data-relay-note="">{t(runtime === "claude" ? "newProfile.relayNote.claude" : "newProfile.relayNote.codex")}</span>}
          </span>
          <Tag tone="accent">{t("newProfile.runtime.tag.only")}</Tag>
        </div>
      </div>
      {runtime === "claude" && <ComponentNotice name={CLAUDE_RUNTIME_COMPONENT} hostId={hostId} className="py-2" />}
      {runtime === "dsh" && (
        <>
          <Notice>
            <span data-dsh-not-recommended="">{t("dsh.notRecommended")}</span>
          </Notice>
          <ComponentNotice name={DSH_RUNTIME_COMPONENT} hostId={hostId} className="py-2" />
        </>
      )}
    </div>
  );
}
