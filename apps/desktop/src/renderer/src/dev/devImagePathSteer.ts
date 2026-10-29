// ?imagePathSteer: Eva's history contains the backend's exact path-text image markers.
// hostFile uses mockImageFile's canvas PNG for screenshot.png; the missing path rejects.
export const IMAGE_PATH_STEER_SCENE = typeof location !== "undefined" && new URLSearchParams(location.search).has("imagePathSteer");
export const IMAGE_PATH_STEER_READABLE = "/home/ema/.cutex/runtime/attachments/cutex.mock/screenshot.png";
export const IMAGE_PATH_STEER_UNAVAILABLE = "/home/ema/.cutex/runtime/attachments/cutex.mock/screenshot-missing.png";

// Keep this wire text identical to cutex's standalone marker, including JSON path quoting.
const marker = (path: string) => `[Image supplied as a file path on this agent's host; use your image-reading tool to inspect it. Path is a JSON string: ${JSON.stringify(path)}]`;

export function imagePathSteerThread(agentId = "eva") {
  return { thread: { id: `thread-${agentId}`, turns: [{
    id: "image-path-steer-turn", status: "completed", startedAt: 1793059200, completedAt: 1793059201,
    items: [{ type: "userMessage", id: "image-path-steer-user", content: [{ type: "text", text: [
      "请查看这两张截图，第一张可以读取，第二张已不可用。",
      "",
      marker(IMAGE_PATH_STEER_READABLE),
      "",
      marker(IMAGE_PATH_STEER_UNAVAILABLE),
    ].join("\n") }] }],
  }] } };
}
