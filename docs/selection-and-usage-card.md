# Renderer selection contract and usage first paint

`body { user-select: none }` is the default for every renderer page, menu and overlay. Navigation,
titles, metadata, times, badges, avatars, status rows and controls inherit it. A mixed history/detail
container such as `.message-body` must not opt in: it contains both chrome and content.

The whitelist in `styles.css` and `lib/contentSelection.ts` is:

- `.selectable`: explicit content leaves: user/bus/task/delegation/subagent/side-chat messages,
  expanded interaction/review reasons, notification replies, goals, alarm messages, note snippets,
  pending-chat drafts, upgrade notes, structured artifact values, workflow arguments, diff source
  and paths, workspace breadcrumb values, job commands and cwd, standalone owner-alert body.
- `.markdown`: rendered prose, including delegation brief/result and artifact/document content.
- `pre`, `code`: source, commands, logs, error details and raw JSON.
- `.select-text` and `[data-copy-value]`: explicit copyable values, including existing build/SHA,
  address/fingerprint and diagnostic values.
- `.textLayer`: PDF text content.
- Inputs, textareas and editable content (including the mention editor): native selection.

Buttons/menu items, explicit `[data-chrome]`, avatars, code language/action headers remain
nonselectable even within prose. A leaf explicitly whitelisted inside a button can expose a path
or command without exposing the rest of the control. Custom mention clipboard serialization also
removes chrome from cloned ranges before serializing it; native `user-select` alone does not filter
`Range.cloneContents()`.

Outside editors, Ctrl/Cmd+A selects only the last pointed/focused content block. A chrome click
clears that scope; with no content scope the shortcut clears the selection and prevents document-wide
selection. Existing handled shortcuts and IME events are respected. Input/editor Ctrl/Cmd+A remains
native. The standalone owner alert installs the same scope policy.

The shortcut is matched by `keybindings.ts`'s fixed native editing-command registry. Select-all
already belongs to its fixed `COMPOSER` editing keys (protected from window-command rebinding),
alongside native copy/paste/undo. The content handler asks `matchesEditingCommand("selectAll")`;
it does not interpret modifier/key combinations itself. The registry handles platform command keys,
physical-key layouts, IME and shortcut recording. Native editing bindings remain fixed in editors.

## Usage flyout

The previous flyout already positioned itself in `useLayoutEffect`, before paint. The changing
geometry came from asynchronous profile/gauge counts: a predicted two-window row could acquire
a third window, and the refreshed list could add a profile. The baseline browser fixture measured
114 → 188px during a single opening (74px height change).

The identity menu now warms profiles and quotas together, sharing in-flight work with the flyout.
The flyout uses cached shapes/values or fixed-height placeholders on first paint. Each opening
snapshots its viewport height and gauge slot counts. Values refresh in place; unexpected extra
gauges/rows remain reachable by scrolling in that fixed viewport. The next opening uses the refreshed
shape at its full height. Cold or changed shapes may scroll during that opening. Gauge lines are
18px with 4px gaps, rows add 12px padding, the optional no-quota footer is 26px. Outer viewport
height is capped to the window, independent of font/icon arrival.

`apps/desktop/scripts/chrome-selection-usage-card.mjs` runs against a loopback mock preview only.
It exercises actual native Ctrl+A in message/code blocks, text and mention editors, settings/usage,
delegation title/body, services and account/usage chrome. It then delays profile/quota responses,
adds a profile and third gauge, and records every animation frame of the actual flyout from its first
visible frame through refresh, plus a second warm opening. It asserts zero x/y/width/height drift,
and verifies extra values remain in the DOM. Set `PLAYWRIGHT_MODULE`, `JITTER_CHROME`,
`CHROME_QA_URL`, `CHROME_QA_OUTPUT`, optional `CHROME_QA_WIDTH` and `CHROME_QA_NAME`.
`CHROME_QA_BASELINE=1` records the unpatched baseline without repaired-behavior assertions.
