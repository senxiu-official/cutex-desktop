// The agent a Markdown file link opens against when it is not the selected one (components/AgentMarkdownScope: a side
// chat, a note). Undefined in conversation panes: the openers keep using the selected agent there.
import { createContext } from "react";
import type { OpenSource } from "./sideOpen";

export const MarkdownOpenSource = createContext<OpenSource | undefined>(undefined);
