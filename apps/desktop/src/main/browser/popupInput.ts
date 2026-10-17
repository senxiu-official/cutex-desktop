/** Main-observed native input only: page dispatchEvent cannot mint this capability. Co-control
 * (0.1.3): an owner click in a shared (granted) tab is still the owner's gesture; only input that
 * main's provider attributes to the agent's own dispatch (isAgentInput) never counts. The agent's
 * popups have their own rate-limited gate (consumeAgent). */
export class BrowserPopupInput {
  private inputAt = -Infinity;
  private forwardedAt = -Infinity;
  private agentForwardedAt = -Infinity;
  private available = false;
  rejection = "no_owner_input";
  constructor(private readonly now = () => performance.now(), private readonly isAgentInput = () => false) {}
  observe(type: string, trusted: boolean): void {
    if (!trusted || this.isAgentInput() || !["mouseDown", "mouseUp", "keyDown"].includes(type)) return;
    this.inputAt = this.now(); this.available = true;
  }
  consume(): boolean {
    const now = this.now();
    if (this.isAgentInput()) { this.available = false; this.rejection = "agent_input"; return false; }
    if (!this.available || now < this.inputAt || now - this.inputAt > 500) { this.available = false; this.rejection = "no_owner_input"; return false; }
    this.available = false;
    if (now - this.forwardedAt < 1000) { this.rejection = "rate_limited"; return false; }
    this.forwardedAt = now; return true;
  }
  /** One agent-caused popup per tab per second; the caller checked isAgentInput itself. */
  consumeAgent(): boolean {
    const now = this.now();
    if (now - this.agentForwardedAt < 1000) return false;
    this.agentForwardedAt = now; return true;
  }
  revoke(): void { this.available = false; }
}
