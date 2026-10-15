// A provider logo (LobeHub, bundled), or the name's first letter in a dot when the provider is unknown.
import { PROVIDER_LABEL, PROVIDER_SVG, type Provider } from "../lib/provider";

export function ProviderIcon({ provider, name, color, size = 16 }: { provider: Provider | null; name: string; color?: string; size?: number }) {
  if (provider)
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center text-foreground"
        style={{ width: size, height: size, fontSize: size }}
        title={PROVIDER_LABEL[provider]}
        aria-label={PROVIDER_LABEL[provider]}
        dangerouslySetInnerHTML={{ __html: PROVIDER_SVG[provider] }}
      />
    );
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-surface-2 font-semibold text-muted uppercase"
      style={{ width: size, height: size, fontSize: size * 0.55, ...(color ? { background: color, color: "#fff" } : {}) }}
      aria-hidden
    >
      {name.slice(0, 1)}
    </span>
  );
}
