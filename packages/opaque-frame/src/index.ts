// Opaque frames for untrusted HTML (docs/desktop-modules.md §10.2): the frame attributes, the offline
// agent-page document (also `./page`, DOM-free for main), and (`./documents`, main process) the one-use
// document store.
// No bridge, MessagePort, daemon access or token lives here; plugin-sandbox adds its own bridge.
export { applyOpaqueFrame, createOpaqueFrame, onFrameNavigatedAway, OPAQUE_FRAME_ALLOW, OPAQUE_FRAME_SANDBOX } from "./frame";
export { buildOfflinePageDocument, OFFLINE_PAGE_CSP, OFFLINE_PAGE_MAX_BYTES } from "./page";
