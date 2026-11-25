// How a clicked service notification opens a service that has its own owner UI on this desktop (e.g. WhatsApp's
// owner tab, registered by the `whatsapp` module while it is on). 服务通知 asks here first and otherwise opens the
// service like 服务 → 打开. Keeps 服务通知 free of any one service's code.
import type { ModuleServices } from "../modules/slots";

/** Opens the service on this desktop; false = could not (the caller falls back to the plain service open). */
export type ServiceOpener = (side: Pick<ModuleServices["side"], "open">) => Promise<boolean>;

const openers = new Map<string, ServiceOpener>();

/** Register while the owning module runs; the returned function removes it (only if still the same opener). */
export function registerServiceOpener(slug: string, opener: ServiceOpener): () => void {
  openers.set(slug, opener);
  return () => {
    if (openers.get(slug) === opener) openers.delete(slug);
  };
}

export function serviceOpener(slug: string): ServiceOpener | null {
  return openers.get(slug) ?? null;
}
