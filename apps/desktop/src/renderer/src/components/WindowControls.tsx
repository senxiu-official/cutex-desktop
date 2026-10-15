// Window caption parts shared by the title bar and the right side's full-screen title row: Linux
// gets drawn buttons; Windows keeps native caption buttons over the right end (a spacer under them);
// macOS keeps the traffic lights on the left (callers pad by 76 px).
import { Minus, Square, X } from "lucide-react";
import { bridge } from "../bridge";

const win = bridge.window;

export function LinuxControls() {
  if (!win || win.nativeControls !== null) return null;
  return (
    <div className="ml-1 flex items-center [app-region:no-drag]">
      <button onClick={() => void win.control("minimize")} className="px-3 py-2.5 text-muted hover:bg-surface-2">
        <Minus size={14} />
      </button>
      <button onClick={() => void win.control("toggleMaximize")} className="px-3 py-2.5 text-muted hover:bg-surface-2">
        <Square size={12} />
      </button>
      <button onClick={() => void win.control("close")} className="px-3 py-2.5 text-muted hover:bg-danger hover:text-white">
        <X size={14} />
      </button>
    </div>
  );
}

/** Space under the native Windows caption buttons (3 × 46 px). */
export function CaptionSpace() {
  return win?.nativeControls === "right" ? <div className="w-[138px] shrink-0" /> : null;
}
