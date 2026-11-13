/** Development renderer URLs must never replace a packaged app's trusted document or
 * become an exception to its opaque-frame network containment. */
export function devRendererUrl(packaged: boolean, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return packaged ? undefined : env.ELECTRON_RENDERER_URL || undefined;
}
