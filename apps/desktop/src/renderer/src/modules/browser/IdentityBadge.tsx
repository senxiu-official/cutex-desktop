// A 浏览器身份's round mark: its initial on its colour (the default identity: neutral). Theme variables only.
import type { BrowserIdentityView } from "../../../../shared/browserIdentity";
import { identityColor } from "./identities";

export function IdentityBadge({ view, size = 18 }: { view: Pick<BrowserIdentityView, "color" | "initial" | "name"> | undefined; size?: number }) {
  const color = identityColor(view);
  const initial = view?.initial || [...(view?.name ?? "")][0] || "·";
  return (
    <span
      aria-hidden
      data-identity-badge={view?.color ?? "none"}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none ${color ? "" : "bg-surface-2 text-muted"}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.55), ...(color ? { background: `color-mix(in srgb, ${color} 22%, transparent)`, color } : {}) }}
    >
      {initial}
    </span>
  );
}
