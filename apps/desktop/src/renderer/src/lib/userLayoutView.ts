import { create } from "zustand";
import type { MemoryHost } from "@cutex-desktop/cutex-client";
import type { SidebarDoc, LayoutHost } from "./userLayoutModel";
export const useLayoutView = create<{
  doc: SidebarDoc | null; memoryHost: MemoryHost | null; hosts: LayoutHost[]; status: string; error: string | null; migration: boolean; ownerPersonConfirmed: boolean; pending: number;
}>(() => ({ doc: null, memoryHost: null, hosts: [], status: "local", error: null, migration: false, ownerPersonConfirmed: true, pending: 0 }));
