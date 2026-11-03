/** A legacy host can reject RGB; validate before changing the mock's saved project. */
export function mockProjectColor(color: string, legacy: boolean): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    if (legacy) throw new Error("invalid_request: unsupported_project_color");
    return color.toUpperCase();
  }
  return color;
}
