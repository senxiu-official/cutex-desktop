/** 「后台网页帧率」: how often main's offscreen background carriers (agent tabs while off screen) paint.
 * Main stores and applies it; the card picture stays at one frame a second whatever this is. */
export const BROWSER_CARRIER_FRAME_RATES = [15, 30] as const;
export type BrowserCarrierFrameRate = (typeof BROWSER_CARRIER_FRAME_RATES)[number];
export const DEFAULT_BROWSER_CARRIER_FRAME_RATE: BrowserCarrierFrameRate = 15;
export interface BrowserCarrierPreferences { frameRate: BrowserCarrierFrameRate }
export const isBrowserCarrierFrameRate = (value: unknown): value is BrowserCarrierFrameRate => BROWSER_CARRIER_FRAME_RATES.includes(value as BrowserCarrierFrameRate);
