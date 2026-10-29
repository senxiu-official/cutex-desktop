/** Preview choreography only; copy fixtures live with their module. */
export function startCopyPreview() {
  if (typeof location === "undefined" || !new URLSearchParams(location.search).has("copies")) return;
  setTimeout(() => { void import("../lib/remoteCopies").then(async m => {
    const { openSide } = await import("../lib/sideOpen");
    openSide(m.COPIES, {}, { binding: { kind: "host", hostId: "ssh-7a3f01c2" } });
    if (new URLSearchParams(location.search).has("bigCopy")) void m.requestCopy("ssh-7a3f01c2", "/home/sam/reports/dataset-large.zip");
  }); }, 1500);
}
