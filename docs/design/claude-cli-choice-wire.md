# Optional Claude Code choice in onboarding

The host and selected runtime must both advertise this optional extension.
Desktop supports the following optional `GET /v2/components` extension on the
`claude-runtime` component. Hosts and components that do not advertise it retain
their existing card and `needsUser` instructions. Supporting hosts implement this
wire contract to enable the feature without a separate desktop change.

```json
{
  "name": "claude-runtime",
  "state": "ready",
  "claudeCli": {
    "selected": "bundled",
    "bundled": { "version": "2.1.301" },
    "system": { "version": "2.1.299" }
  }
}
```

- `selected`: `bundled` or `system`; missing/null defaults to `bundled` in the UI
  without sending a setting. The daemon remains the authority for that default.
- `bundled`: object; `version` is a bounded string or null/missing when unknown.
- `system`: object only when a usable system installation was detected;
  null/missing means no detected installation. Its version may also be unknown.
- A `system` selection with no detected system installation is rejected as
  malformed metadata, rather than offered as a working choice.
- Other unknown fields are ignored. Invalid or absent choice metadata hides the
  entire source display/choice and retains the legacy card.
- The existing `detail.selected.claudeCli` executable path is not this extension.
  Desktop neither reads it as a choice nor executes a CLI itself.

On explicit user selection, desktop uses the existing target-host settings IPC:

```http
PATCH /v2/settings
Content-Type: application/json

{"claudeCli":"system"}
```

The only other allowed value is `bundled`. Desktop then refreshes components and
renders the daemon's confirmed selection; it does not optimistically claim success
or retry a failed/uncertain mutation. The daemon must return its effective selected
source through the extension after applying the preference. Credentials, executable
paths, process launch and runtime selection remain backend responsibilities.

Mock preview: append `claudeCli=both` to the existing onboarding hash route for the
default bundled choice with an alternative system installation. `claudeCli=bundled`
shows bundled-only metadata without a selector; `claudeCli=system` starts with the
system source selected. Omitting it remains the current-host scenario.
