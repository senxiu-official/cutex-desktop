# How to add a desktop widget

A step-by-step guide for adding one widget to the cutex desktop, written so a member can do it alone. Read it once top to
bottom, then follow §2 and tick the checklist in §5. The worked example is the 世界时钟 (world clock),
`apps/desktop/src/renderer/src/modules/world-clock/`; a ready-to-copy template is in `docs/widget-template/`.

Reference sections you will come back to: **§8 data you can read** (which hook for which data), **§9 the preview and
screenshots**, **§10 the lint tests that will check your strings and store reads**.

Background (read when something is unclear, not before): design `docs/design/032-desktop-widgets.md` (why), the contract
`docs/desktop-modules.md` §27 (exact types), the layout `docs/design/030-desktop-grid.md` (how the desktop places things).

## 0. What a widget is

A **widget kind** is one entry in the `desktop.widget` slot, contributed by a desktop **module**. It declares its sizes, its
shape, whether there can be several, where it goes on a fresh desktop, a settings schema, how often it re-renders, and a
React component. The desktop (module `home`) places every **instance** of every kind on a grid of whole units (40 px, 16 px apart; contract 1.24), draws the
card, handles dragging / resizing / the right-click menu / the settings form, and stores everything in the owner's home
document. **You only write the component and the declaration.**

Paths below are relative to `apps/desktop/src/renderer/src/`.

## 1. Rules that are not optional

1. **Data only through your module's own services or existing hooks** (`ctx.services`, `useApp` selectors, hooks the shell
   already exports — §8 lists them by kind of data). Never call the daemon (`services.daemonFor(...)…`) from a widget for something no module service offers —
   add the service first (that is a separate task, ask the lead).
2. **No timers.** If anything shown depends on the clock, declare `refresh: "minute"` (or `"second"`) and use the `now` prop.
   That includes **"N minutes ago" and "running for N minutes"**, not only clocks: without `refresh` the widget re-renders only
   when its data changes, so a duration stands still for as long as nothing else happens. Never `setInterval` /
   `setTimeout` loops in a widget.
3. **No side effects of your own.** To open an agent, a page or a service, call `props.actions.*`. Never import the store to
   select an agent (`useApp((s) => s.openAgent)`), never `services.ui.openPage` directly, never `window.open`.
   (Two built-ins of the home module are allowed exceptions, marked in `modules/home/widgets.tsx`: 名片 opens the home
   module's own 个人页 pane and a pinned tile opens its pin, which may be an artifact, a link or a page pin. `actions`
   cannot do either. 需要你 uses `actions` like any other widget.)
4. **Fill the box you are given.** Your root element is `h-full w-full`; read `width` / `height` and choose how much to show
   (fewer rows, smaller text). Never set your own width/height or margins around the root.
5. **The shell draws the chrome.** Do not draw your own card background / border / shadow for `shape: "card"`; just padding
   and content (`px-3.5 py-3` is the house style, `home-sub` for secondary text). **`shape: "bare"` has no chrome at all**:
   the text sits on the wallpaper, so the card advice does not apply. Put `home-clock` on the root (white text with the
   desktop's adaptive text shadow, as both clocks do), draw no background, use `opacity-80`/`-90` for secondary lines
   instead of `home-sub` (which is grey, for the glass card), and keep text large enough to carry the shadow: nothing
   under 11 px, light weights (`font-light`) only for big digits. **Readability rule for bare widgets:** every text must
   read on the pale light sky (around the top right of the default desktop) and on a dark wallpaper; check both in
   screenshots (§9). If it does not read, make it a card, do not invent your own shadow or scrim.
6. **While `arranging` is true, do nothing on click** (the shell takes the pointer anyway; guard your handlers).
7. **Every string through i18n**, keys prefixed with your module id (`<id>.…`), in zh-CN, en, and zh-Hant-CN. An agent is
   named only as `{{agent}}` / `{{agents}}` (the plural form is `{{agents}}`, also in English titles), never the word itself
   (§10).
8. **Sizes are in units** (contract 1.24): one unit is 40 px, two units are 16 px apart, so n units = n × 56 − 16 px (2 units =
   96 px); at least 2 × 2. Give them in `size.units` (1.23 `size.cells` still works: doubled); `size.min / max / default` stay in the old 8 px steps (what a 1.22 desktop reads; a kind with only
   steps still works — each size maps to the nearest cell count).
9. **Clickable rows are `<button type="button">`**, not a `div` with `onClick`: that gives focus, Enter / Space and the
   screen-reader role for free. Put a `title` on text that may be cut off.

## 2. Step by step

### Step 1 — the module folder

Create `modules/<id>/` (lower-case, dashes: e.g. `quota-gauges`). Copy the four files from `docs/widget-template/`:
`index.ts`, `Widget.tsx`, `i18n.ts`, and the test into `apps/desktop/test/<id>.test.tsx`. Replace every `my-widget` /
`MyWidget` with your names.

If your widget belongs to an **existing** module (it reads that module's data), add it to that module's `index.ts` instead of
making a new module — e.g. a widget for delegations goes into `modules/delegations/`.

### Step 2 — i18n (`modules/<id>/i18n.ts`)

- `zhCN` first, then `en: Record<keyof typeof zhCN, string>` (the compiler makes en complete).
- Keep the `declare module "../i18nCatalog"` block from the template — without it your keys do not type-check.
- Keys: `<id>.title`, `<id>.description` (the module), `<id>.widget`, `<id>.widgetHint` (the kind), one per settings label,
  one per visible text. Chinese: no full stop at the end of hints; write `{{agent}}`-style terms flush against Chinese text
  (`正在运行的{{agent}}`, not `正在运行的 {{agent}}`).
- **`<id>.title` and `<id>.description` are what the owner reads in Settings → 模块** (the module list, where they turn modules
  on and off). Write them for the owner: what it shows them, in their words (「桌面上列出此刻正在工作的{{agent}}……」), not how it
  is built («a desktop.widget contribution of …»). `<id>.widgetHint` is shown in the 添加小组件 menu and the widget list of 编辑主页.
- **zh-Hant-CN (繁體中文) is a complete catalog**: typecheck fails until every key has an entry ("missing the following
  properties …"). Do not hand-convert and do not edit the shared `i18n/zh-Hant-CN.ts`: ship the entries in your own
  `i18n.ts` (`locales["zh-Hant-CN"]` + the `ModuleZhHantMessages` block, as in the template and `modules/perf-log/i18n.ts`),
  generated by OpenCC with the same conversion the catalog was made with:

  ```
  python3 scripts/zh-hant.py --write apps/desktop/src/renderer/src/modules/<id>/i18n.ts
  ```

  (from the repo root). It converts your `zhCN` block (one entry per line) and writes the `zhHantCN` block into the file:
  the first time with the `ModuleZhHantMessages` declaration and `export const locales`, later by replacing the block.
  Without `--write` it only prints it. It needs the OpenCC Python package and gets it itself through `uvx --with opencc`
  when it is not installed; `uvx` is found on `PATH` or at `~/.local/bin/uvx` (on hachimi it is there, often not on an
  agent's `PATH`, which is fine). Without uv it says so and how to install it. Run it again after changing a Chinese
  string, and read the diff. It is character-level s2t: mainland words stay (软件 → 軟件, not 軟體), which is what
  zh-Hant-CN means. Other locales fall back to English.

### Step 3 — the declaration (`modules/<id>/index.ts`)

```ts
"desktop.widget": [{
  id: "<id>.<name>",                 // e.g. "world-clock.clock"
  titleKey: "<id>.widget",
  descriptionKey: "<id>.widgetHint",
  icon: SomeLucideIcon,
  size: { min: [20, 10], max: [80, 60], default: [36, 18], units: { min: [4, 2], max: [14, 10], default: [6, 4] } }, // units (40 px); steps for 1.22
  shape: "card",                     // card | round (also set size.ratio: 1) | path (+ clipPath) | bare (no chrome)
  multiple: true,                    // can the owner add more than one?
  defaultPlace: { area: "side", order: 5 },   // on a fresh desktop; omit = only via 添加小组件
  refresh: "minute",                 // if anything shown depends on the clock (a time, "5 min ago", "running 4m")
  settings: [ … ],                   // §Step 5
  defaults: { … } or (locale) => ({ … }),
  Widget: MyWidget,
}],
```

Choosing sizes: the desktop's side column is 6 units wide (320 px); a header row is 2 units high (96 px). Pick a default
that looks right in the side column, a min where your content still reads, a max where it stops getting better.

`defaultPlace.area`: `header-left` / `header-right` (the top row), `side` (the right column, stacked by `order`), `main`
(the left area, packed in order). **Leave it out unless the owner asked** for the widget to be on every new desktop; without it
the owner adds the widget from 添加小组件 (that is the normal case: 世界时钟 has one only because the owner asked).

### Step 4 — the component (`modules/<id>/Widget.tsx`)

```tsx
export function MyWidget({ width, height, settings, now, arranging, actions }: DesktopWidgetProps) {
  const { t } = useI18n();
  // read settings (already validated against your schema; defaults filled in)
  // decide what fits: e.g. const rows = Math.floor((height - 24) / 40);
  return <div className="h-full px-3.5 py-3">…</div>;
}
```

- `card`: use `home-sub` for secondary text (it is tuned for the glass card). `bare`: `home-clock` on the root and opacity
  for secondary text (rule 5). Use `tabular-nums` for numbers.
- Dates and "here": `formatDate(at, locale, options)` and `localTimeZone()` from `lib/dateText` (§8), not
  `new Intl.DateTimeFormat(…).format` / `resolvedOptions().timeZone` directly.
- Data: §8 says which hook gives what. Read only what you show, and select narrowly (a string fingerprint from a `useApp`
  selector, as `modules/running-agents/RunningAgents.tsx` does) so a streamed token does not re-render the desktop.
- If a click should open something: `onClick={() => !arranging && actions.openPage("delegations.page")}` (page ids are the
  `main.page` items, e.g. `projects.page`, `delegations.page`); an agent: `actions.openAgent(hostId, sessionId)`. Make the
  clickable thing a `<button type="button">`.
- Keep pure logic (maths, formatting) in a separate file (`zones.ts` in the example) so it is easy to test.

### Step 5 — settings (the shell draws the form)

Field types: `text` (`maxLength`), `number` (`min`, `max`, `step`), `toggle`, `select` (`options: [{ value, labelKey }]`),
`timezone` (an IANA zone), `list` (rows of flat fields, with `min`, `max`, `addLabelKey`, `itemDefaults`). Values that do not
match the schema (wrong type, out of `min`/`max`, not one of the options) are replaced by your defaults when read, so your
component can trust the *type* of what it gets. The template shows a `number` and a `select` next to `text` and `toggle`.

**Defaults need not name every field.** `settings` = your defaults, then each schema field's stored value if it is valid.
A field with no default and nothing stored is simply **absent**, so read every value defensively
(`typeof settings.rows === "number" ? settings.rows : 5`). Giving every field a default is still the clearest, and it is what
the defaults test checks against the schema.

Words in defaults (city names, titles) depend on the language: make `defaults` a function and use `translate("<id>.…")`.

**Lists.** A `list` field's rows are flat records of the other field types, `select` included (世界时钟's rows:
`label` text, `tz` timezone, `icon` select). `itemDefaults` is what a new row (再加一个) starts with, **and** what fills a
stored row's missing fields when settings are read.

**Adding a field to an existing list without breaking stored settings.** Owners already have rows saved without the new
field. Two things keep them:

1. Put the new field in `itemDefaults` (the shell then fills it into old rows before validating; without it the old rows
   fail the new field, and the whole list falls back to your defaults — the owner's cities would be gone).
2. Read rows defensively in your own code too (a row may come from somewhere the shell did not fill), defaulting the new
   field — as `citiesOf` in `modules/world-clock/WorldClock.tsx` does for `icon`:

```ts
// index.ts: the list field after adding `icon`
{ key: "cities", type: "list", labelKey: "world-clock.cities", min: 1, max: 6, addLabelKey: "world-clock.addCity",
  itemDefaults: { label: "", tz: "UTC", icon: "none" },          // ← the new field's default goes here
  fields: [
    { key: "label", type: "text", labelKey: "world-clock.city", maxLength: 24 },
    { key: "tz", type: "timezone", labelKey: "world-clock.zone" },
    { key: "icon", type: "select", labelKey: "world-clock.icon", options: [{ value: "none", labelKey: "world-clock.iconNone" }, …] },
  ] }

// WorldClock.tsx: reading a row, old or new
const icon = row.icon === "pin" || row.icon === "home" ? row.icon : "none";
```

Then add a test with a row stored the old way (`settingsOf(kind, { cities: [{ label: "London", tz: "Europe/London" }] })`
keeps London, with `icon: "none"`; see `test/worldClock.test.tsx`). Never rename or retype an existing key: a stored value of
the old type fails the field and is replaced by the default. Add a new key instead.

### Step 6 — register the module

Add it to `modules/registry.ts`: `import myWidget from "./<id>";` and the name in the `MODULES` list (next to `worldClock`,
with a one-line comment). i18n is collected automatically.

### Step 7 — tests (`apps/desktop/test/<id>.test.tsx`)

Copy the template test. At least:
1. the kind's declaration (id, sizes, `multiple`, `refresh`, settings keys);
2. the defaults pass their own schema (`settingsOf(kind, defaults)` returns them unchanged);
3. the pure logic (the example: offsets, date differences, half-hour zones);
4. rendering at a normal size and at the smallest size (what shows, what hides);
5. a click calls the right action, and nothing while `arranging`.

Time zones: code that asks for "here" (`localTimeZone()`, or anything reading `resolvedOptions().timeZone`) is tested with
`test/helpers/timeZone.ts`: `withLocalTimeZone("Australia/Sydney", () => { … })` for one test, or `fakeLocalTimeZone(tz)` in a
`beforeEach` with `vi.restoreAllMocks()` after. Pass the instant explicitly (`now`) instead of faking the clock, and give zones
explicitly (`timeIn("Asia/Shanghai", AT, …)`) for everything that is not "here".

The template's i18n mock echoes the variables (`t("x.count", { n: 3 })` renders `x.count {"n":3}`), so a test can see the
numbers it passes; keep it that way.

Then, **before any screenshot** (in `apps/desktop`):

1. `npx vitest run test/<id>.test.tsx`
2. `npm run typecheck`
3. the full `npx vitest run` — it runs the lint tests of §10 over your strings and code, which your own test file does not.
   The three updater tests are known failures; anything else is yours to fix.

### Step 8 — look at it

Start the preview (mock data, no daemon) and open `http://127.0.0.1:5241/?desktop`; add your widget with right-click on an
empty part of the desktop → **添加小组件** → your widget. Try: light and dark, the window narrow (≈ 900 px) and wide, resize it to
its min and max, its settings (right-click the widget → 小组件设置…, or 编辑主页 → the widget's settings button). Take a screenshot
of each with `scripts/shot.mjs` and look at them before you report. §9 has the commands, the URL parameters and the waits.

## 3. Worked example: 世界时钟

Files: `modules/world-clock/index.ts` (the declaration), `WorldClock.tsx` (the component), `zones.ts` (time-zone maths with
`Intl` only), `i18n.ts`; test `test/worldClock.test.tsx`.

- **Owner's request**: Canberra + Chongqing. There is no `Australia/Canberra` zone of its own (Canberra keeps Sydney's time,
  daylight saving included), and Chongqing uses China Standard Time — so the defaults are `Australia/Sydney` labelled
  「堪培拉」 and `Asia/Shanghai` labelled 「重庆」. The label is free text; the zone sets the time. Check zone names this way
  whenever an owner names a city.
- **Sizes**: default `[36, 18]` (288 × 144: two rows in the side column), min `[20, 10]`, max `[80, 60]`; two columns when the
  box is ≥ 440 px wide.
- **Settings**: `cities` (list: `label` text ≤ 24, `tz` timezone; 1–6 rows), `hour12` (toggle), `showDiff` (toggle).
- **Refresh**: `"minute"` — the time comes from `now`.
- **What it shows**: per city the name, the time, and 「今天 / 明天 / 昨天 · 快 3 小时」 relative to the machine's own zone.

## 4. Sources (where the content comes from)

Every instance has a `source` (default: your module). Pick the one that matches; only `module` needs no other work today.

### 4.1 Module (this guide)

Your component, your module's data. Everything above.

### 4.2 Service

A cutex service publishes a tile (capability `service-tiles`). A **pinned service** is already an instance of the tile widget
with `source: { kind: "service", hostId, slug }` — nothing to do. For a service that should offer **more** widgets, cutex must
first describe them (design 032 §3.2; a cutex change — ask the lead). Never fetch a service's URL from a widget yourself.

### 4.3 Agent

An agent's HTML artifact shown in the opaque frame, with only design 004's three channels (own storage, hand back to the agent
after the owner confirms, copy on click), optionally fed by a small JSON artifact the agent republishes. Specified in design
032 §3.3; **not built yet** — do not build one as a module widget.

### 4.4 Actions

`actions.openAgent`, `actions.openPage`, `actions.openService`, `actions.sendToAgent` are the only ways to affect anything
outside the widget. `sendToAgent` always asks the owner first and returns false in v1.22 (reserved).

## 5. Checklist

- [ ] Module folder (or an existing module's `index.ts`); registered in `modules/registry.ts`.
- [ ] Kind id `<module>.<name>`; `titleKey`, `descriptionKey`, `icon`.
- [ ] Sizes in units: default looks right in the side column (6 units wide); min still readable; max sensible.
- [ ] Shape chosen; `round` has `size.ratio: 1`; `path` has `clipPath`.
- [ ] `multiple` decided; **no `defaultPlace` unless the owner asked** for it on every new desktop.
- [ ] Settings schema; defaults valid against it (a function if they hold words); missing values read defensively.
- [ ] No own timers: `refresh: "minute"` + `now` for anything clock-dependent, durations and "ago" included.
- [ ] Data only from the §8 hooks; per-agent maps through `viewOf` / `agentState` / `agentActivityOf`, never `s.sessions[id]`.
- [ ] No daemon calls; no own side effects (`actions` only, no `useApp((s) => s.openAgent)`); clicks ignored while `arranging`.
- [ ] Clickable rows are `<button type="button">` (keyboard and screen readers); `title` on text that may be cut off.
- [ ] Fills its box; adapts to `width` / `height`; reads in light and dark. `bare`: `home-clock` on the root, no own
      background or shadow, readable on the pale sky and on a dark wallpaper (screenshots).
- [ ] A field added to an existing list is in `itemDefaults`, read defensively, and tested with a row stored the old way.
- [ ] Dates through `formatDate`, "here" through `localTimeZone()`; time-zone tests through `test/helpers/timeZone.ts`.
- [ ] i18n: zh-CN + en in the module, zh-Hant-CN from `scripts/zh-hant.py` in the module's `locales`; agents only as
      `{{agent}}` / `{{agents}}`, flush against Chinese; no full stop at the end of hints; `description` written for the owner.
      zh-Hant: `python3 scripts/zh-hant.py --write …` re-run after every Chinese change, never hand-edited.
- [ ] Tests: declaration, defaults vs schema, pure logic, render at normal and smallest size, click vs `arranging`.
- [ ] `npm run typecheck` clean; your test file and **the full vitest run** (with the §10 lint tests) pass, except the 3
      known updater tests — before the screenshots.
- [ ] Screenshots with `scripts/shot.mjs` (light / dark, narrow / wide, settings open) looked at.
- [ ] One line in `PROGRESS.md` if the lead asks; no contract change (`modules/widgetTypes.ts`) without the lead.

## 6. Common mistakes

- Starting a `setInterval` for a clock → use `refresh: "minute"` and `now`.
- Drawing a card background inside a `card` widget → double card. The shell draws it.
- Fixed pixel layout (e.g. always five rows) → overflows at small sizes. Compute from `height`.
- Forgetting zh-Hant-CN → typecheck error "missing the following properties". Generate it (Step 2).
- 「智能体」 / "agent" typed into a string → `terms.test` fails; write `{{agent}}` / `{{agents}}`.
- `useApp((s) => s.sessions[id])` → `conversationScope.scan` fails; use `viewOf(s, hostId, id)`.
- A bare widget with `home-sub` text or its own shadow → grey on the wallpaper, or a second shadow fighting the shared one.
  Use `home-clock` and opacity.
- A new list field without an `itemDefaults` entry → every owner's saved list resets to your defaults.
- 「10 月 22 日」 on another machine → use `formatDate`, not `Intl.DateTimeFormat` directly.
- A "5 min ago" without `refresh: "minute"` → it stays at 5 min until some data changes.
- A `div` with `onClick` as a row → not reachable by keyboard; use `<button type="button">`.
- Settings with a value the schema does not allow in `defaults` → the defaults test fails; fix the defaults.
- A city's zone written as the city (`Asia/Chongqing`, `Australia/Canberra`) → use the canonical zone and put the city in the label.
- Opening things directly (`useApp.getState().openAgent`) → use `actions.openAgent` (foretell and confirmations apply).

## 7. Good next widgets (each fits this guide)

1. **额度表 (quota gauges)** — the active profiles' remaining quota as rings; data from the existing quota view hooks
   (`lib/quota`), refresh none (re-renders on data). Settings: which profiles, used / left.
2. ~~**正在运行的智能体 (running agents)**~~ — built: `modules/running-agents/` (a good second example: sidebar rows,
   per-agent step line, `refresh: "minute"`, a number and a select setting).
3. **项目状态 (project status)** — one project's agents, open delegations and last activity; settings: the project (select);
   click = `actions.openPage("projects.page", …) with the params that page reads`. Data from the projects module's existing hooks.
4. **委托 (my delegations)** — open delegations waiting for the owner, newest first; data from the delegations module.
5. **天气 (weather via a service)** — only once a weather service publishes a widget (§4.2); until then a pinned service tile.

## 8. Data you can read

What a widget may read, by kind of data. All are existing hooks / pure helpers; import them, do not copy their logic. Paths
are under `apps/desktop/src/renderer/src/`. "Every host in scope" = the hosts the owner's host switcher shows (all hosts, or
the focused one).

| Data | Use | Notes |
|---|---|---|
| The agents (rows) of every host in scope | `useScopedSidebar()` (`lib/scopedSidebarView`) → `.model.groups[].online`, `.model.chats`, `.scope.focus` | Each row is an `AgentRow` (`lib/sidebar`): `id`, `name`, `hostId` (absent = the focus host), `status` (`"running"`, `"needsInput"`, `"idle"`, `"offline"`, `"error"`, …), `lastActivity` (ms), `isDirector`, `color`, `initial`, `session` (the cutex resource). |
| Since when an agent's turn runs | `runningSince(row)` (`lib/agentAttention`) | ms, or null when the host did not say. Shown durations need `refresh: "minute"`. |
| A duration as text | `formatElapsed(ms)` (`lib/agentAttention`) → "8s", "4m", "1h05", "2d" | With `refresh: "minute"` the seconds form only changes once a minute; use minutes on the desktop (`modules/running-agents/runs.ts` `longElapsed`). |
| Who needs the owner (approvals, questions, failures) | `useScopedAttention(scoped.model, scoped.scope)` (`lib/scopedSidebarView`) → `{ rows, signals, needs, marks }`; `attentionChips(…)` and `signalLabel(t, …)` turn them into chips and words | As 需要你 (`modules/home/widgets.tsx` `NeedsWidget`) does. |
| What an agent is doing now, **any agent** | `useApp((s) => agentActivityOf(s, focus, row))` (`lib/activity`), then `runningStepOf(preview)` (a tool / retry line such as `$ cargo test`, or null) or `previewLine(preview, running)` (the sidebar's second line) | The focus host: live from host-wide events. Another host: the session resource's projection, refreshed with its sidebar snapshot (a little behind). |
| What an agent is doing now, more precisely, **only for a conversation open in this window** | `const view = useApp((s) => viewOf(s, hostId, sessionId))` (`store`), then `turnActivity(view.timeline)` (`lib/turnActivity`) → `"reasoning"`, `"approval"`, `"command"`, … (label key `turn.activity.<name>`) | `viewOf` is undefined for a conversation that is not open: fall back to the row above. Select a string, not the view (streamed tokens). |
| An agent's per-agent store maps (outbox, models, …) | `agentState(map, hostId, sessionId)` (`store`) | Never index `s.sessions[id]` or `s.outbox[id]` yourself (§10). |
| Quota gauges | `useHostQuotas(hostId)` / `useHostsQuotas(hostIds)` (`lib/targetHost`) → `{ [profile]: QuotaGauge[] }`; `useHostLoadQuota(hostId)` to load one | Re-render on data; no `refresh` needed unless you show "updated N min ago". |
| Delegations | `useHostDelegations(hostId)` (follows that host while mounted) or `useFocusDelegations()` (`lib/delegationStore`) → `{ [askId]: AskSummary }`; words: `useStatusWord()`, `useAgentNames()` (`lib/delegationsView`) | |
| Token usage by day (the 用量 card's) | `useHomeUsage()` (`modules/home/hooks`) | Home module data; another module's widget should ask the lead before importing it. |
| Hosts | `useApp((s) => s.hosts?.hosts)`, the focus host `s.hosts?.active ?? "local"` | |
| The time | the `now` prop with `refresh` | Never `Date.now()` in render. |
| A date as text | `formatDate(at, locale, { timeZone?, month, day, weekday, … })` (`lib/dateText`) → 「10月22日 周四」, "Thu, October 22" | Same options as `Intl.DateTimeFormat`, but some ICU builds write 「10 月 22 日」 with spaces; this removes them (zh / ja only; Korean keeps its own). Both clocks use it. |
| The machine's own time zone ("here") | `localTimeZone()` (`lib/dateText`) | Tests fake it with `test/helpers/timeZone.ts` (Step 7). |

Missing something (e.g. a per-agent signal cutex does not send)? Do not fetch it yourself: tell the lead; it is a cutex or a
module-service change first.

## 9. Preview and screenshots

**Start the preview** once (mock data in the browser, no Electron, no daemon), in `apps/desktop`:

```
npx vite --config vite.preview.config.ts --port 5241 --strictPort
```

Pick any free port (never 24260 / 24270 / 25360 / 25370: daemon ports). It reloads on save.

**URL parameters** (combine with `&`; all mock-only, `dev/`):

| Parameter | What you get |
|---|---|
| `?desktop` | The desktop shown (显示桌面) about 1.5 s after start; `homeAt=<ms>` changes the delay. |
| `?homeedit` | The desktop with 编辑主页 open (the widget list and settings panel). |
| `?homeprofile` | The 个人页 pane. |
| `?bigproject` | A big project (51 online members, several running): busy lists, long sidebars. |
| `?manydemo` | A dozen more demo agents sharing a name prefix. |
| `?longname` | Very long identity names (the owner's name on 名片, other users). |
| `?legacy` | An older cutex without newer features (fallback paths). |
| `?shelves`, `?ws=start` / `?ws=split` | Shelf and workspace layouts (not needed for widgets). |

The mock data includes running agents (with tool lines), agents needing the owner, quotas, delegations and pinned tiles.

**Waits and the introduction dialog.** The first load takes a few seconds (the preview compiles on first request), then the
desktop appears ~1.5 s later. A fresh browser shows the introduction (引导) dialog over everything; in your own browser click
跳过引导 once (it is remembered per browser). `scripts/shot.mjs` marks it as seen before the page loads.

**Adding a widget by hand**: right-click an empty part of the desktop → 添加小组件 → your widget. Its settings: right-click the
widget → 小组件设置…. Arranging: long-press the desktop, or right-click → 整理桌面.

**Screenshots: `scripts/shot.mjs`** (repo root; plain Node 22 + `google-chrome`, no puppeteer). It starts headless Chrome with a
throw-away profile, sets theme, language and viewport, waits, runs optional steps and writes a JPEG:

```
node scripts/shot.mjs --url 'http://127.0.0.1:5241/?desktop' --wait-for '[data-desk-widget]' \
  --out /home/ema/cutex-dev/shots/0.2-<name>/01-light.jpg
node scripts/shot.mjs --url 'http://127.0.0.1:5241/?desktop' --theme dark --size 900x800 --wait-for '[data-desk-widget]' \
  --out /home/ema/cutex-dev/shots/0.2-<name>/02-dark-narrow.jpg
```

Flags: `--theme light|dark`, `--locale zh-CN|en|zh-Hant-CN`, `--size WxH` (default 1600x940), `--wait-for <css>` (then
`--settle` ms, default 800) or `--wait <ms>`, `--click <css>` and `--eval <js>` (repeatable, in order; a promise is awaited and
its value printed — e.g. to add your widget through the menu as above, or to check what rendered), `--keep-onboarding`. Only
loopback URLs. Your widget's instances carry `data-desk-kind="<kind id>"`; wait for that.

Then **open the JPEGs and look at them** (cut-off text, the card at min / max size, dark mode contrast) before reporting.

## 10. Lint tests that will check your widget

These run in the full `npx vitest run`, not in your own test file. Run the full suite before the screenshots.

| Test (`apps/desktop/test/`) | Fails when | Fix |
|---|---|---|
| `terms.test.ts` | a zh-CN / en string says 智能体 / 代理 / 主管 / 主人 / agent(s) / director / owner as a word | `{{agent}}` / `{{agents}}` (plural), `{{director}}`, `{{owner}}`; `{{Agents}}` capitalised at the start of an English title. The owner can rename these words. |
| `i18nTermsAudit.test.ts` | a space between a `{{term}}` and Chinese (`正在运行的 {{agent}}`); Profile written lower-case in Chinese text | write it flush: `正在运行的{{agent}}`; `Profile`. |
| `settingsPunctuation.test.ts` | only if your module also adds a Settings page: a row hint ends with 。 / "." or a section hint is not a sentence | follow the file's header. Widget strings themselves are not checked; the house style is still no full stop on short hints. |
| `i18n-locales.test.ts` | a translation drops or renames a `{placeholder}` | keep `{n}` etc. in every locale. |
| `conversationScope.scan.test.ts` | code outside the store indexes the view map (`s.sessions[id]`, `getState().sessions[…]`) or a per-agent map (`s.outbox[id]`, `s.models[id]`, …) | `viewOf(s, hostId, sessionId)` / `agentState(map, hostId, sessionId)`: maps are keyed by host + agent since several hosts can share ids. |
| `tsc` (`npm run typecheck`) | a zh-Hant-CN entry missing | `python3 scripts/zh-hant.py --write modules/<id>/i18n.ts` (Step 2). |

