import type { MessageImage } from "../../../shared/input";

// cutex management/v2/user_input/image_steering.rs::claude_path_text (r264).
// The daemon emits one complete text part per image; Claude history may join those parts with LF.
const PREFIX = "[Image supplied as a file path on this agent's host; use your image-reading tool to inspect it. Path is a JSON string: ";

/** Display projection only. Near matches, inline quotations and fenced examples remain literal. */
export function pathTextImages(text: string): { text: string; images: MessageImage[] } {
  const images: MessageImage[] = [];
  const lines: string[] = [];
  let fence: { char: string; length: number } | null = null;
  for (const line of text.split("\n")) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (delimiter) {
      if (!fence) fence = { char: delimiter[0]!, length: delimiter.length };
      else if (delimiter[0] === fence.char && delimiter.length >= fence.length) fence = null;
      lines.push(line);
      continue;
    }
    if (!fence && line.startsWith(PREFIX) && line.endsWith("]")) {
      const quoted = line.slice(PREFIX.length, -1);
      try {
        const path: unknown = JSON.parse(quoted);
        // Match the daemon's JSON string exactly, rather than accepting arbitrary JSON values,
        // unescaped prose or extra instructions after the path. Never turn it into file://.
        if (typeof path === "string" && JSON.stringify(path) === quoted &&
            (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || /^\\\\[^\\]+\\/.test(path))) {
          images.push({ kind: "path", path, delivery: "pathText" });
          continue;
        }
      } catch { /* A user's similar text stays exactly as written. */ }
    }
    lines.push(line);
  }
  return { text: images.length ? lines.join("\n").replace(/\n+$/, "") : text, images };
}
