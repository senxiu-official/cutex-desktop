import type { SessionResource } from "@cutex-desktop/protocol";

/** UI-only notice: a role changed while this runtime still had its old launch-time tools. */
export class OperatorRestartNotices {
  private readonly generations = new Map<string, number>();
  require(session: SessionResource): void { this.generations.set(session.cutexSessionId, session.runtime.runtimeGeneration); }
  current(sessions: readonly SessionResource[]): string[] {
    const byId = new Map(sessions.map(s => [s.cutexSessionId, s]));
    for (const [id, generation] of this.generations) {
      const session = byId.get(id);
      if (!session || session.lifecycle === "retired" || session.runtime.status !== "online" || session.runtime.runtimeGeneration !== generation) this.generations.delete(id);
    }
    return [...this.generations.keys()];
  }
  clear(id: string): void { this.generations.delete(id); }
}

/** A launch-time permission change requires an explicit owner restart for every online runtime. */
export async function recordOperatorRuntimeNotice(options: {
  read(): Promise<SessionResource>;
  current(): boolean;
  notices: OperatorRestartNotices;
}): Promise<{ state: "required" | "offline" }> {
  const session = await options.read();
  if (!options.current()) throw Error("host_changed");
  if (session.lifecycle === "retired" || session.runtime.status !== "online") {
    options.notices.clear(session.cutexSessionId); return { state: "offline" };
  }
  options.notices.require(session);
  return { state: "required" };
}
