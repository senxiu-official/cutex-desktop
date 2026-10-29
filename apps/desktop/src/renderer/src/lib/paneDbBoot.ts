// main.tsx imports this first: the pane layout (lib/paneDb) starts loading before the rest of the app's modules run.
import { paneDb } from "./paneDb";

export const panesLoaded = paneDb.load();
