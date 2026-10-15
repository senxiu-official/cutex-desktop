/** Main-observed native input only: page dispatchEvent cannot mint this capability. I3 must
 * wire hasAgentLease before enabling any provider input; a leased guest never auto-forwards. */
export class BrowserPopupInput {
  private inputAt = -Infinity;
  private forwardedAt = -Infinity;
  private available = false;
  rejection = "no_owner_input";
  constructor(private readonly now = () => performance.now(), private readonly hasAgentLease = () => false) {}
  observe(type: string, trusted: boolean): void {
    if (!trusted || this.hasAgentLease() || !["mouseDown", "mouseUp", "keyDown"].includes(type)) return;
    this.inputAt = this.now(); this.available = true;
  }
  consume(): boolean {
    const now = this.now();
    if (this.hasAgentLease()) { this.available = false; this.rejection = "agent_lease"; return false; }
    if (!this.available || now < this.inputAt || now - this.inputAt > 500) { this.available = false; this.rejection = "no_owner_input"; return false; }
    this.available = false;
    if (now - this.forwardedAt < 1000) { this.rejection = "rate_limited"; return false; }
    this.forwardedAt = now; return true;
  }
  revoke(): void { this.available = false; }
}
