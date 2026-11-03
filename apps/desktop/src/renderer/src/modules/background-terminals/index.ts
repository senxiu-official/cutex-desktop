// Background terminals (/ps) for runtimes advertising backgroundTerminals, including Claude shells.
import { Terminal } from "lucide-react";
import { defineModule } from "../slots";
import { TerminalsBody, TerminalsMeta, TerminalsStatusBar } from "./TerminalsStatus";
import { useTerminalsStatus } from "./useTerminalsStatus";

export default defineModule({
  id: "background-terminals",
  titleKey: "background-terminals.title",
  descriptionKey: "background-terminals.description",
  contributes: {
    "conversation.status": [
      {
        id: "background-terminals.status",
        order: 300,
        agentFeature: "backgroundTerminals",
        titleKey: "background-terminals.statusTitle",
        defaultPlace: "capsule",
        useStatus: useTerminalsStatus,
        Meta: TerminalsMeta,
        Body: TerminalsBody,
        Bar: TerminalsStatusBar,
        icon: Terminal,
      },
    ],
  },
});
