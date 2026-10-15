// Shared widths for form controls, so selects stacked in a column line up instead of sizing to
// their current label ("profile 默认（gpt-5.6-sol）" vs "profile 默认（—）"). Long labels truncate;
// the Select shows the full label as a tooltip.
export const FIELD_W = {
  /** Model pickers (labels like "GPT-6.1-Sol · 272k", "profile 默认（gpt-5.6-sol）"). */
  model: "w-60",
  /** Reasoning effort ("— (medium)", "xhigh"). */
  effort: "w-28",
  /** Anything else (profile, project, approval policy, notification level…). */
  generic: "w-48",
  /** Compact enums next to another control (context window presets, reset format). */
  short: "w-36",
} as const;
