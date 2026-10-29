// Sidebar layout B 「现在 / 全部」 (design 040 §4 B): the 「全部」 half lists every agent as a compact 28 px line with a
// 20 px avatar. Provided around that list (components/Sidebar); components/AgentRows reads it.
import { createContext } from "react";

export const AllRowsCompact = createContext(false);
