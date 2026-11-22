// Entry of the 项目看板 window (renderer/board.html). Its only bridge is `window.board` (preload/board.ts).
import { createRoot } from "react-dom/client";
import type { BoardBridge } from "../../../shared/board";
import { BoardApp, type BoardDocument } from "./BoardApp";
import "../styles.css";

// This window's own document (not drawn by the app renderer): theme, root font size (大字), language, title.
const root = document.documentElement;
root.dataset.theme = "dark";
const applyDocument = (d: BoardDocument) => {
  root.style.fontSize = d.bigText ? "19px" : "16px";
  root.lang = d.lang;
  document.title = d.title;
};
const bridge = (window as unknown as { board?: BoardBridge }).board;
if (bridge) createRoot(document.getElementById("board")!).render(<BoardApp bridge={bridge} applyDocument={applyDocument} />);
