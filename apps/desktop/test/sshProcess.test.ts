import { describe, expect, it } from "vitest";
import { isOurTunnelCommandLine } from "../src/main/ssh";

describe("stale ssh tunnel recognition", () => {
  const oldCommand = '"C:\\Windows\\System32\\OpenSSH\\ssh.exe" -N -T -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -L 127.0.0.1:53122:127.0.0.1:24270 -- workstation';
  const newCommand = '"C:\\Windows\\System32\\OpenSSH\\ssh.exe" -N -T -o BatchMode=yes -o ForwardAgent=no -o ForwardX11=no -o PermitLocalCommand=no -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -L 127.0.0.1:53122:127.0.0.1:24270 -- workstation';

  it("recognises tunnels left by both the previous and current desktop versions", () => {
    expect(isOurTunnelCommandLine(oldCommand)).toBe(true);
    expect(isOurTunnelCommandLine(newCommand)).toBe(true);
  });

  it("does not recognise other ssh processes", () => {
    expect(isOurTunnelCommandLine(oldCommand.replace("ExitOnForwardFailure=yes", "ExitOnForwardFailure=no"))).toBe(false);
    expect(isOurTunnelCommandLine(oldCommand.replace("127.0.0.1:53122", "0.0.0.0:53122"))).toBe(false);
    expect(isOurTunnelCommandLine("other-process -o ExitOnForwardFailure=yes -o ServerAliveCountMax=3 -L 127.0.0.1:53122:127.0.0.1:24270")).toBe(false);
  });
});
