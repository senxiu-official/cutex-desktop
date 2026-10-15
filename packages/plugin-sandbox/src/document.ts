// Kept as browser source text so the main process does not import DOM implementations.
const GUEST_BOOTSTRAP = String.raw`function guestBootstrap(instanceId, channel) {
  // CSP does not cover WebRTC. Defence in depth only (a same-origin child frame keeps its own
  // copies); the Electron host disables UDP WebRTC and black-holes TCP / DNS for plugin frames.
  for (const name of Object.getOwnPropertyNames(window)) {
    if (/^(?:webkit)?RTC|^WebTransport/.test(name)) { try { delete window[name]; } catch {} }
  }
  let port;
  let sequence = 0;
  let closed = false;
  const pending = new Map();
  const ready = new Promise(resolve => {
    const listener = (event) => {
      const data = event.data;
      if (event.source !== parent || !data || data.version !== 1 || data.instanceId !== instanceId || port) return;
      if (data.kind !== "probe" || typeof data.challenge !== "string") return;
      window.removeEventListener("message", listener);
      const ports = new MessageChannel();
      port = ports.port1;
      port.onmessage = event => {
        const data = event.data;
        if (!data || data.version !== 1 || data.instanceId !== instanceId || data.channel !== channel) return;
        if (data.kind === "closed") {
          closed = true;
          for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error("disposed")); }
          pending.clear();
          port?.close();
        } else if (data.kind === "response" && Number.isSafeInteger(data.id)) {
          const waiter = pending.get(data.id);
          if (!waiter) return;
          pending.delete(data.id);
          clearTimeout(waiter.timer);
          if (data.error && typeof data.error.code === "string") waiter.reject(new Error(data.error.code));
          else if (Object.hasOwn(data, "result")) waiter.resolve(data.result);
          else waiter.reject(new Error("invalid_response"));
        }
      };
      port.start();
      // The port belongs to this document. Never ask the host to transfer a
      // privileged port back through a WindowProxy that can navigate meanwhile.
      parent.postMessage({ version: 1, kind: "ready", instanceId, channel, challenge: data.challenge }, "*", [ports.port2]);
      resolve();
    };
    window.addEventListener("message", listener);
  });
  Object.defineProperty(window, "sandboxBridge", { value: Object.freeze({
    async call(method, params = null) {
      await ready;
      if (closed) throw new Error("disposed");
      if (pending.size >= 32) throw new Error("busy");
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("timeout")); }, 35000);
        pending.set(id, { resolve, reject, timer });
        try { port.postMessage({ version: 1, kind: "request", instanceId, channel, id, method, params }); }
        catch { clearTimeout(timer); pending.delete(id); reject(new Error("invalid_request")); }
      });
    },
  }), writable: false, configurable: false });
}`;

/** Framework bootstrap plus untrusted local content, served by the main-owned document protocol. */
export function buildSandboxDocument(input: { instanceId: string; channel: string; html: string; script: string; styles?: readonly string[] }) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'`;
  const script = (code: string) => `<script nonce="${nonce}">${code.replace(/<\/script/gi, "<\\/script")}</script>`;
  const styles = (input.styles ?? []).map(css => `<style>${css.replace(/</g, "\\3c ")}</style>`).join("");
  const html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}">${styles}${script(`(${GUEST_BOOTSTRAP})(${JSON.stringify(input.instanceId)},${JSON.stringify(input.channel)})`)}</head><body>${input.html}${script(input.script)}</body></html>`;
  return { html, csp };
}

