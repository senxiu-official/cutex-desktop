// Node-only entry (`@cutex-desktop/cutex-client/node`): local daemon discovery via ~/.cutex.
// The main entry must stay free of Node built-ins so it runs in a browser / Capacitor WebView.
export * from "./discovery";
