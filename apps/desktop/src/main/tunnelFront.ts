// The fixed local port of a host with several SSH routes. Service pages, the daemon client and
// browser policy all name one local port, and an origin cannot move while a page runs, so a route
// change must not move it either. This only copies TCP bytes to the current `ssh -L` port: it binds
// loopback like `ssh -L` itself, reads nothing of what passes and is no HTTP server. A connection
// stays on the route it started on until it ends; only new connections follow `use()`.
import { connect, createServer, type Server, type Socket } from "node:net";

const LOOPBACK = "127.0.0.1";

export class TunnelFront {
  private server: Server | null = null;
  private port = 0;
  private current: number | null = null;
  /** Open connections per `ssh -L` port. */
  private readonly open = new Map<number, Set<Socket>>();

  /** `onDrained`: the last connection of a port that is no longer current has ended. */
  constructor(private readonly onDrained: (backendPort: number) => void) {}

  /** Listen (once). `preferred`: the port this tunnel showed before, when it is still free. */
  async listen(preferred: number | null): Promise<number> {
    if (this.server) return this.port;
    const bind = (port: number) =>
      new Promise<Server>((resolve, reject) => {
        const server = createServer({ allowHalfOpen: true }, (socket) => this.accept(socket));
        server.once("error", reject);
        server.listen(port, LOOPBACK, () => {
          server.removeListener("error", reject);
          // Stays open for the app's life: an accept error must not become an uncaught exception.
          server.on("error", () => {});
          resolve(server);
        });
      });
    const server = await (preferred ? bind(preferred).catch(() => bind(0)) : bind(0));
    const address = server.address();
    this.server = server;
    this.port = typeof address === "object" && address ? address.port : 0;
    return this.port;
  }

  /** Where new connections go (null: no route is up, they are closed at once, like a refused port). */
  use(backendPort: number | null): void {
    this.current = backendPort;
  }

  connections(backendPort: number): number {
    return this.open.get(backendPort)?.size ?? 0;
  }

  close(): void {
    this.current = null;
    this.server?.close(() => {});
    this.server = null;
    for (const sockets of this.open.values()) for (const socket of sockets) socket.destroy();
    this.open.clear();
  }

  private accept(client: Socket): void {
    const backendPort = this.current;
    if (backendPort === null) {
      client.on("error", () => {});
      client.destroy();
      return;
    }
    const upstream = connect({ host: LOOPBACK, port: backendPort, allowHalfOpen: true });
    client.setNoDelay(true);
    upstream.setNoDelay(true);
    let sockets = this.open.get(backendPort);
    if (!sockets) this.open.set(backendPort, (sockets = new Set()));
    sockets.add(client);
    const abort = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("error", abort);
    upstream.on("error", abort);
    client.pipe(upstream);
    upstream.pipe(client);
    // One side gone: what was read from it is still written out to the other, then that closes too.
    upstream.once("close", () => client.destroySoon());
    client.once("close", () => {
      upstream.destroySoon();
      const left = this.open.get(backendPort);
      if (!left?.delete(client) || left.size > 0) return;
      this.open.delete(backendPort);
      if (backendPort !== this.current) this.onDrained(backendPort);
    });
  }
}
