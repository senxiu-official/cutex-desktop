# Browser CDP executor (I1–I2c)

Original TypeScript implementation using public CDP interfaces. No Electron, Chrome, React,
OpenAI plugin code or product-specific runtime is imported. `CdpTransport` is injected by the
trusted host. This package does not attach a debugger, establish identity, grant a lease, open a
window, change OS focus or connect to a daemon.

```ts
const executor = new BrowserCdpExecutor(transport, {
  nextPageGeneration: () => host.guestRegistry.nextPageGeneration(guestId),
  authorize: operation => host.assertCurrentLease(operation),
  ensureVisible: () => host.assertGuestInputAllowed(),
  // I2b provider deliberately omits the optional focusTarget callback: no forced guest focus.
  allowUrl: url => host.isAllowedTarget(url),
});
const snapshot = await executor.read({ deadline: Date.now() + 10_000 });
await executor.act(snapshot.nodes[1].ref, 'fill', 'hello');
await executor.act(snapshot.nodes[1].ref, 'press', 'Enter');
const found = await executor.find({ role: 'button', name: 'Save', exact: true });
await executor.action({ kind: 'hover', ref: found.nodes[0].ref });
const image = await executor.screenshot(); // MCP host emits {type:'image', ...image}.
executor.stop(); // Terminal revocation; host detaches transport separately.
```

## Semantics

- One executor per guest / transport attachment; reject concurrent operations with `busy`, never
  queue or replay. `stop()` and `dispose()` immediately revoke local capability. To resume, obtain
  a new host lease and construct a new executor. The host still owns debugger detach/destruction.
- Snapshot refs last 30 seconds by default. New reads, main-frame navigation/document/context
  replacement, stop and detach invalidate them. Detached backend nodes fail `stale_ref`.
  The required `nextPageGeneration` allocator belongs to the host's persistent guest registry,
  **not** an executor-local counter; it survives regrant, debugger reattach, crash and LRU reload.
  Construction and every invalidation consume a positive safe integer strictly greater than the
  executor's previous generation. Invalid/repeated/regressing/throwing allocation permanently
  closes the executor; event handlers abort active work instead of throwing into the host emitter.
  Every executor also has its own 128-bit cryptographic random ref namespace, with no weak-random
  fallback. Old-instance refs cannot accidentally name nodes in a replacement executor.
- Snapshots always include `truncated: boolean`. They retain AX order and only returned nodes
  receive refs. Shared protocol limits cap node count (20,000), role (256 code points), name/value
  (16,384 code points), and the **entire snapshot's serialized UTF-8 JSON size**, including metadata,
  escaping, separators and truncation flags (8 MiB minus 64 KiB envelope reserve). Text is never
  split inside a Unicode code point; affected nodes carry `truncated: true`. Password/protected
  AX node values are omitted entirely, even if the browser supplied unmasked text. S3 additionally
  checks every value-bearing AX role's DOM attributes with `DOM.describeNode`, at most 256 per
  snapshot, including combobox/spinbutton rather than only textbox/searchbox. Values require a
  safe editable DOM control. Password types, password/passcode-like autocomplete tokens,
  `one-time-code`, and every `cc-*` token are omitted (including section/billing token lists).
  Missing/malformed/failed/over-budget DOM descriptions fail closed by omitting value; permission,
  abort/deadline, navigation and detach errors still reject the operation. This is DOM-derived
  redaction, not trust in Chromium's AX masking; real password-page trace acceptance is separate.
- Actions remain **main-frame only**. Known child-frame refs and frame-owner elements fail
  `unsupported_frame`; no OOPIF session is attached or silently redirected to the main frame.
- **Isolated checks (S1):** actions create/reuse one privately named main-frame isolated world
  with `Page.createIsolatedWorld` (`grantUniveralAccess: false`). The name uses the executor's
  independent cryptographic namespace. `DOM.resolveNode.executionContextId` and
  `Runtime.evaluate.contextId` bind the target and main-window identity to this world; all fixed
  inspection, frame/focus/selection and receipt functions then run on those remote objects.
  There is no default/page-world fallback. Malformed/missing contexts fail closed. Navigation,
  document/context replacement, destruction of this context, stop and detach invalidate the
  cache and refs; unrelated contexts being destroyed do not. A destruction racing creation or
  a late acknowledgement after cancellation cannot install a stale context.
  Transport adapters must support `Page.createIsolatedWorld` and forward Page/DOM/Runtime events,
  including `Runtime.executionContextDestroyed` and `Runtime.executionContextsCleared`.
- Authorization runs before every ordinary CDP command. Safety restoration and remote-object
  release are cleanup, not agent operations (see the cleanup contract below). Target URL checks
  do not replace the host's **all navigation/frame/redirect** scheme and domain interception.
- The host must reject unsupported hidden/minimized/tray input as `target_hidden`. The executor
  never calls an OS or application-window focus API. Guest-local focus emulation and DOM focus
  occur only after visibility approval; the optional `focusTarget` callback may focus the guest.
  Keep `ensureVisible` pure (no focus/restore); `focusTarget` is tracked as a possible side effect.
  Visibility is rechecked immediately before **every ordinary** side-effect command and focus callback,
  and before each screenshot attempt. Hiding after resolution but before the first effect sends
  no input and returns `target_hidden`; after an effect it becomes `outcome_unknown`.
- Click checks connected/visible/enabled/not inert and hit-tested center, then uses CDP mouse
  input. Offscreen or occluded elements are rejected; there is no automatic scrolling or retry.
- Fill supports textarea and text/search/tel/url/password/email input, checks editable state,
  focuses/selects, and sends `Input.insertText` (Backspace for empty text). No synthetic input
  event or DOM value assignment. Contenteditable, rich editors and other input types are deferred.
  Fill accepts at most the shared `MAX_FILL_TEXT_CODE_POINTS` (65,536 Unicode code points), not
  a UTF-16 code-unit approximation. Email chooses CDP Ctrl+A before insertText because the input
  type does not support setSelectionRange. A failing text selection never triggers a fallback
  retry. Guest-local emulation cleanup remains the R1 contract below.
- Press supports Enter/Tab/Backspace/Escape/arrows only. Enter includes `text: "\r"` and matching
  keyup. Keyboard shortcuts, IME, clipboard and drag are carrier acceptance items, not implemented
  as agent operations here.
- Click/fill/press/hover/wheel require a trusted event receipt; no receipt means `outcome_unknown`, even if the CDP call
  was acknowledged. `dispatched` + `observed: true` proves observed input, **not a business result**
  (for example, a saved form). The receipt closure, listeners and DOM wrappers live in the private
  isolated world; main-world API/expando overrides cannot forge those checks. The page still owns
  the shared DOM and application behavior: an input receipt is not trustworthy evidence of a
  business result or permission to act outside the host's target policy.
- Once a potentially side-effecting command (including DOM focus) is sent, cancellation,
  deadline, detach, missing receipt or later error becomes `outcome_unknown`. Never automatically
  replay; inspect fresh state. Before dispatch, deterministic validation errors stay deterministic.
  A `Page.navigate` reply with `errorText` is the narrow exception: it reports `navigation_failed`
  (not successful loading or a guarantee that no request reached the server), except
  `net::ERR_ABORTED` (a 204 / 205 response, a download, or a superseded navigation: the request may
  have reached the server and no new document committed), which stays `outcome_unknown`. Reads/finds/screenshots
  of Chromium's main-frame `chrome-error://chromewebdata/` document also report `navigation_failed`
  without reading its content. Existing authorization and URL policy still apply; recovery requires
  a new explicit navigation to an allowed URL, never automatic replay or a new grant by default.
- Remote-object/listener cleanup is best-effort and nonblocking; even synchronous adapter throws
  cannot skip focus restoration. No business input is sent by cleanup.
- **Focus cleanup contract (R1):** mark `focusEmulationDirty` **before** sending enable. Reset is a
  direct `transport.send('Emulation.setFocusEmulationEnabled', {enabled:false})`: it intentionally
  bypasses authorization, visibility, operation abort/deadline and ref expiry, because it restores
  state rather than granting agent authority. Wait at most **1 second**, independently of the
  operation's context. An unconfirmed reset turns an affected action into `outcome_unknown`.
  `stop()` / `dispose()` initiate cleanup without waiting; they and the action's `finally` share
  one attempt, including when that attempt rejects immediately. Never-enabled means no reset.
- Failed reset stays dirty. Before any ordinary work (including authorization) the next `run()`
  attempts repair; unsuccessful repair returns `transport_error` without issuing agent commands.
  **Timeout safety barrier:** an underlying reset promise that has not settled remains tracked.
  No concurrent reset or later enable is permitted while it is unresolved. Once it settles,
  dirty stays set and the next run sends a fresh repair, requiring acknowledgement before normal
  work. Thus a delayed old reset cannot disable a later action's focus emulation. A permanently
  unresolved reset requires host debugger detach and executor reconstruction, not blind retries.
- **Host release must detach the debugger session**, not merely stop this executor. Detach is the
  last cleanup boundary for session Emulation overrides and still belongs to the host. This package
  does not claim a mock test proves actual Electron detach behavior; the carrier lab verifies that
  separately. Do not reuse the old executor after stop/dispose.
- Screenshots are viewport-only (or the visible intersection of an explicit element ref, with
  no implicit scrolling). Try PNG once; if base64 exceeds the shared 6 MiB limit, try one
  viewport JPEG at quality 60. Still oversized → explicit `message_too_large`, never an unbounded
  retry. The result MIME is `image/png | image/jpeg`; adapters must honor format/quality and hosts
  must forward that MIME. A documented native capture fallback remains transport-owned; this
  package cannot guarantee capture of a hidden/uncomposited Electron surface.

## I2c actions, find, screenshots and dialogs

`action(action: BrowserAction, options?: OperationOptions)` is the uniform entry; the existing
`act(ref, 'click' | 'fill' | 'press', value, options)` stays compatible. New actions are hover,
scroll (CSS-pixel wheel deltas, default 500), scrollIntoView, select by exact value/label,
check/uncheck, wait, back/forward/reload and dialog policy. New actions use the same ref TTL,
main-frame identity, isolated-world, permission, visibility and uncertain-outcome gates.

- Check/uncheck use a CDP click and read the native checkbox state. Already-correct state is an
  observed no-op. ScrollIntoView is a fixed isolated-world DOM operation, followed by actionability
  inspection. No automatic action retry is added.
- Select supports native select controls, including multiple. A readonly preflight rejects absent,
  ambiguous or disabled options. The fixed isolated-world function uses native option accessors,
  sets selected, dispatches standard input/change and verifies the selected values after handlers.
  Those select events are **not trusted CDP input**. `observed` means the state was read back, not
  that any business operation succeeded. Lost acknowledgements/failed readback are unknown.
- `find(query, options)` creates a new snapshot and invalidates previous refs. Original AX names
  are filtered before any node/text/byte truncation. Role is exact; name/text default to case-
  insensitive substring, or exact case-sensitive equality with `exact:true`. Text never searches
  values. Defaults to 20 results (maximum 100), preserving AX order and shared output budgets.
- Wait URL is exact; load uses DOM readyState; element means a matching nonignored AX node exists,
  not a promise of clickability. Condition polling is readonly and may cross navigation while old
  refs remain invalid. There is no arbitrary script predicate, action retry or condition extension
  beyond the original deadline. Actual actions perform their own visibility/actionability checks.
- `screenshot({ref?,format?,quality?,signal?,deadline?})` returns `viewport` CSS dimensions,
  `captureRect` in viewport CSS coordinates and `imageScale` actual output pixels per CSS pixel.
  Dimensions are derived from bounded PNG/JPEG header parsing; document offsets are added only to
  CDP's clip. The host supplies `displayScale` separately and revalidates the image. Explicit JPEG
  accepts quality 0–100 and makes one attempt; PNG/default uses bounded PNG→JPEG60 fallback.
- `dialog` **arms only the next dialog**, not an acknowledgement that it was handled. The policy
  lasts at most 5 seconds (also bounded by the arming deadline), belongs to this executor/grant and
  page generation, and is consumed once. Navigation, stop, detach and disposal clear it. Before an
  armed response, authorize, visibility and authorize are rechecked, then generation/TTL/stop are
  checked immediately before send. No policy, expiry, denied authority or a stalled guard defaults
  to dismiss. Default dismissal is terminal-safe cleanup and deliberately bypasses agent gates;
  it never accepts a dialog or provides prompt text. An uncertain response is never replayed.

These new paths have deterministic fixture/VM tests only in this package. S3 real Chromium traces,
email delivery, fullscreen/DPI, native dialog ordering and actual select framework behavior require
owner-run product acceptance; passing unit tests does not mark C1–C7 complete.

## Tests and evidence boundaries

`pnpm --filter @cutex-desktop/browser-cdp test` and `typecheck`.
`fixtures/cdp-shapes.json` is explicitly hand-authored contract-shaped data, **not** a claimed
recorded browser run. `fixtures/electron-44.5.1-hidden-fill.json` is a normalized real recording
from the 2026-10-10 Windows hidden-window lab: first read/fill per carrier, temporary identifiers
and loopback port normalized, AX fields reduced, own function bodies omitted. It preserves the
important difference: WebContentsView input was observed; webview acknowledged `Input.insertText`
but the receipt stayed `{seen:false,value:""}`. Replay tests prevent falsely calling the latter
success. Hidden evidence **does not decide visible-window carrier selection**.
The recording predates S1 and is intentionally unchanged. Its replay adapter adds explicitly
synthetic isolated-world creation/context routing while retaining the original command results;
it is **not** a real Electron isolated-world recording.

Deterministic tests cover refs/navigation/frames, permission boundaries,
hidden target rejection, trusted dispatch and receipts, lost ack, cancellation/deadline/detach,
no replay, no input into a navigated replacement page, and screenshot output. These tests do not
establish actual Electron delivery, IME, DPI, rendering/compositing or operating-system focus.
Those require `services/browser-lab` and the H1–H11 matrix; visible acceptance remains separate.

Review regression coverage (M1–M3): replacement-executor refs and monotonic host generations,
allocator failure, missing crypto, visibility changes after resolution/focus/input, screenshot
visibility, exact/non-BMP fill boundaries, deterministic node/text/escaped-byte truncation,
password/protected values, protocol URL syntax, and bounded PNG → JPEG fallback.

R1 regression coverage adds exact-once reset after normal action, hide, stop/dispose, revoke,
abort, deadline and ref expiry; reset rejection/timeout repair, no delayed-reset/new-enable race,
never-enabled behavior, synchronous adapter exceptions and observed late promise rejections.

S1 regression coverage adds explicit context routing, malformed/unsupported worlds, world reuse,
navigation/destruction races, missing frame-change events, cancellation/deadline late replies and
permission rechecks. A separate Node VM fixture executes the actual fixed function bodies in two
modeled JavaScript realms with shared DOM state: poisoned main-world builtins/wrappers cannot
change inspection, focus, selection or trusted receipts, and untrusted events remain insufficient.
That deterministic model is not a real browser DOM-isolation acceptance test; visible Electron
verification remains an integration responsibility.

Public interfaces: [CDP Input](https://chromedevtools.github.io/devtools-protocol/tot/Input/),
[CDP DOM](https://chromedevtools.github.io/devtools-protocol/tot/DOM/),
[CDP Page](https://chromedevtools.github.io/devtools-protocol/tot/Page/),
[CDP Runtime](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/),
[CDP Accessibility](https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/).
