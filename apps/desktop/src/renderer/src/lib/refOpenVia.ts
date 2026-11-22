// How a `cutex:` link chip in Markdown opens its ref (components/CutexLink). Unset: services.refs.open, which opens refs
// of the active or the viewed host only. A surface whose Markdown belongs to an agent elsewhere (a 备忘 of another host)
// provides an opener that first brings that host into view.
import { createContext } from "react";
import type { CutexRef, RefOpenResult } from "../modules/slots";

export type RefOpener = (ref: CutexRef, opts: { how?: "auto" | "peek" | "page" }) => Promise<RefOpenResult>;
export const RefOpenVia = createContext<RefOpener | null>(null);
