// Whether a Director rotation of a project is known to be running, for shell code (the sidebar
// project menu) that may not import the projects module. The module's rotation store registers the
// probe (modules/projects/rotationStore); until then nothing is known to run.
type Probe = (host: string, projectId: string) => boolean;

let probe: Probe = () => false;

export function setRotationProbe(next: Probe): void {
  probe = next;
}

export function rotationRunningOn(host: string, projectId: string): boolean {
  return probe(host, projectId);
}
