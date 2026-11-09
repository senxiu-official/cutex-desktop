# Writing a Cutex desktop module

A module adds something to the Cutex desktop app: a button in the tray, a page, a card in Settings, an action on a code block. This guide is everything you need to write one. You do not need to read the app's source.

## What you are writing

A module is one JavaScript file, built from your folder, that the app loads into its main window. It imports two things:

- `react`, `react/jsx-runtime` and `react-dom`, which are the app's own copies
- `@cutex-desktop/module-api`, which has three entries: the stable API, `/ui` for components that look like the app, and `/experimental` for things that may change

It may also bundle ordinary libraries (`lucide-react` for icons, for example). It may not import anything else of the app's, and the build stops if it tries.

**A module has the app's full power.** It runs in the same window as the app. It can see what you can see in the app, send messages to agents as you, and run commands on connected hosts. The app does not sandbox it and does not list "permissions", because in that window it could not enforce them. Before a module loads, the owner confirms this in a native dialog. Only install modules from a source you trust.

## Quick start

You need Node 24 and a checkout of the cutex-desktop repository, with its dependencies installed (`pnpm install` in the checkout). There is no npm package yet: the template points at your checkout. The commands below call that checkout `<repo>`.

```sh
node <repo>/packages/module-api/bin/cutex-module.mjs new my-thing
cd my-thing
npm install
npm run build
```

`npm install` may warn that esbuild's install script was not run (`install-scripts`). It is harmless: the build works without it.

The folder's name becomes the module's id, so use lower-case letters, digits and `-`. You now have a working module in `dist/`: a button in the tray (the strip under a conversation, not the operating system's tray) that opens a page with a counter. To see it, load it in the app:

The app's language may be Chinese, so button names below give both.

1. Open Settings → Modules (设置 → 模块) and click **Turn on developer mode…** (打开开发者模式…). The app asks you to confirm in a native dialog.
2. Click **Load from folder…** (从文件夹加载…) and choose `my-thing`. The app asks you to confirm again.
3. The button is in the tray, on the home screen and beside any conversation. The module's row in Settings has its switch; a module with `defaultEnabled: false` starts off, so turn it on there.

Then run `npm run dev` and edit `src/index.tsx`. Each save rebuilds, and the app swaps in the new build without restarting. If a build fails, or the new code throws while it starts, the last build that worked stays loaded. Build errors print in your terminal. Errors from loading or starting in the app show only in Settings → Modules, on the folder's row.

### Commands

| Command | What it does |
|---|---|
| `cutex-module new <folder>` | Starts a module from the template |
| `cutex-module build` | Builds into `dist/` |
| `cutex-module dev` | Builds, then rebuilds whenever `src/`, `i18n/` or `pack.json` changes |
| `cutex-module pack` | Builds and writes `dist/<id>-<version>.tar.gz` |

Inside the folder, `cutex-module` is `npx cutex-module`. `npm run build` and `npm run pack` run the type checker first. `cutex-module` itself checks imports and names but not types, so run `npm run typecheck` while you work if you use `npm run dev`.

## The folder

```
my-thing/
  pack.json        your module's id, version and API range
  src/index.tsx    the entry: export default defineModule({ … })
  i18n/en.json     messages, one file per language
  i18n/zh-CN.json
  package.json     dependencies and scripts
  tsconfig.json
```

`pack.json` has only these fields:

```json
{ "id": "my-thing", "version": "0.1.0", "moduleApi": "^1.31", "author": "you" }
```

- `id` is the same as the `id` in `defineModule`. Never change it after you publish: the owner's settings for your module are stored under it. It cannot be the id of a module built into the app.
- `version` is `major.minor.patch`.
- `moduleApi` is `^major.minor`: the oldest API version your module works with. If the app is older, the module does not load, and Settings says the app needs updating. Use the version you built against, unless you know an older one is enough.
- `author` is optional. The app shows it marked "unverified". The template says `Your name`: change it or remove it.

## The module definition

```tsx
import { Timer } from "lucide-react";
import { defineModule, pageTitle } from "@cutex-desktop/module-api";

export default defineModule({
  id: "my-thing",
  titleKey: "my-thing.title",              // its name in Settings → Modules
  descriptionKey: "my-thing.description",
  defaultEnabled: true,                    // default; false = the owner turns it on
  requires: { capabilities: ["some-host-feature"] },  // optional: stays off without it
  contributes: {                           // items that are there whenever the module is on
    "nav.primary": [{ id: "my-thing.nav", icon: Timer, titleKey: "my-thing.title", target: { page: "my-thing.page" } }],
    "main.page": [{ id: "my-thing.page", Page: MyPage, useTitle: pageTitle("my-thing.title") }],
  },
  activate(ctx) {                          // optional: subscriptions and items that depend on data
    const off = ctx.services.activity.subscribe((event) => { /* … */ });
    ctx.signal.addEventListener("abort", off);
  },
});
```

**Items.** A *slot* is a named place in the app. An *item* is what you put there. Every item's `id` starts with your module's id and a dot, and is unique in its slot. Put items that are always there in `contributes`. Add items that depend on data with `ctx.contribute(slot, item)`, which returns a function to take the item away.

**What runs when.** Your file runs once each time it loads, so variables at the top of the file are one copy for the whole window. A new build in developer mode is a new load with fresh variables. Components are different: the app can draw an item in several places and take it away at any time, so keep shared state at the top of the file or in prefs, not in a component.

**Lifecycle.** The app calls `activate` when the module turns on and again when a change of host means it should restart. When the module stops, `ctx.signal` aborts and everything you got through `ctx` ends by itself: subscriptions through `ctx.services`, `ctx.hosts` and `ctx.prefs`, and items from `ctx.contribute`. Your own timers and listeners are yours to stop on `ctx.signal`. Do not wait on the network in `activate`: the app gives it a limited time, and the module counts as failed if it takes too long or throws.

**Requirements.** `requires.capabilities` names features the host must have. The module is off, and Settings says why, on hosts without them. `requires.modules` names other modules that must be on.

**Hooks.** A field whose name starts with `use` (`useTitle`, `useStatus`, `useBadge`) is a React hook. The app calls it in a component of its own, so you can use other hooks inside it.

## Where items show up

- **`tray.entry`**: the tray is the strip of avatars at the edge of the window. It is on the home screen and beside conversations alike, and each app window has its own, so one item can be drawn more than once at a time.
- **`nav.primary`**: the window bar shows only pinned entries. A new entry starts in the bar's **⋯ More** (更多) menu, and the owner pins it from there. You cannot pin it for them. An entry whose `useBadge` returns `attention: true` shows in the bar until that clears.
- **`main.page`**: where a page opens is the owner's setting, **Where pages open** (页面打开位置). By default it is its own pane in the conversation's Shelf (the column beside the conversation), otherwise over the conversation. Draw it to work at a column's width. To ask for a place, use `services.panes.open("page:<your page id>", params, { beside: true })`.
- **`timeline.codeBlockAction`**: see [Trying a code block action](#trying-a-code-block-action).

## Services

Use `ctx.services` in `activate`. Its calls end when the module stops. In components, import `services` from the API. The full shapes are in the [reference](#services-and-the-module-definition).

```ts
import { services } from "@cutex-desktop/module-api";
services.ui.toast("Time is up");                   // at the bottom of the window, on any screen
services.ui.notice("Saved");                       // a line above the input; nobody sees it with no conversation open
await services.ui.confirm("Delete this?", true);   // a modal; true = a dangerous action
services.ui.openPage("my-thing.page", { tab: "a" });
services.ui.openSettings("my-thing");              // a settings.page by its `page` name
services.panes.open("core.conversation", { sessionId, hostId });
services.agents.list();                            // every agent on the connected hosts
services.activity.subscribe((e) => e.kind);        // "ownerMessage" | "command" | "tool"
```

To reach the owner, use `toast` unless the action came from a conversation. `notice` shows only above the input of the conversation in view, and with none open it goes nowhere, with no error. Neither one reaches the owner when the window is hidden.

In components, the hook `useAgents()` gives the agents and re-renders when they change. `useHosts()` gives the hosts. `useI18n()` gives `t` and the locale. `useModulePref(id, key, fallback)` reads and writes one of your settings.

### A timer shared by every item

There is no shared clock hook. Keep one interval at the top of your file, start it in `activate`, and let items subscribe. Every copy of the item then shows the same value:

```tsx
import { useSyncExternalStore } from "react";

let now = Date.now();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const useNow = () => useSyncExternalStore(subscribe, () => now);

// in activate(ctx):
const timer = setInterval(() => {
  now = Date.now();
  for (const l of listeners) l();
}, 1000);
ctx.signal.addEventListener("abort", () => clearInterval(timer));
```

## Messages

`i18n/<locale>.json` holds your strings. Each key starts with your id. `{name}` is replaced by the value you pass.

```json
{ "my-thing.title": "My thing", "my-thing.count": "Pressed {n} times" }
```

```ts
const { t } = useI18n();
t("my-thing.count", { n: 3 });
```

Languages the app has: `zh-CN`, `en`, `de-DE`, `es-ES`, `fr-FR`, `it-IT`, `ja-JP`, `ko-KR`, `pt-BR`, `ru-RU`, `zh-Hant-CN`, `zh-Hant-TW`. A missing language falls back to English, so always include `en.json`. `<id>.title` and `<id>.description` are also shown where the module's code is not loaded.

## Saving things

`ctx.prefs` and `useModulePref` keep small JSON values on this device, under your module's id. They survive restarts, updates and removal of the module.

```ts
const [minutes, setMinutes] = useModulePref("my-thing", "minutes", 25);
const [notes, setNotes] = useModulePref<Note[]>("my-thing", "notes", []);   // your own interfaces are fine
setNotes((previous) => [...previous, note]);                                // or pass an updater
```

- **Values.** Anything JSON can hold. Leave out a property rather than set it to `undefined`: writing `undefined`, `NaN`, a function or a class instance throws a `TypeError`.
- **Limits.** Prefs live in the window's local storage, shared with the whole app and every other module. The app sets no limit per module. The browser's limit for all of it was about 50 million characters when measured, and it is not a promise. The practical limit is lower: each write saves all of your module's prefs again and holds up the window while it does, so keep yours to tens of kilobytes and cap anything that grows. Past the browser's limit a write is lost with no error, and the value stays as it was.
- **Local storage directly.** Do not use other keys. They are the app's.
- **IndexedDB.** It works in the window today, but it is not supported: it is shared with the app, nothing separates or cleans up your data, and it may change.
- **Larger data.** Use your module's own folder: see [Files](#files).

## Files

Two services work with files: `data`, a folder of your module's own, and `files`, the system's open and save dialogs. They are only in `ctx.services`, not in the `services` you import, because they need to know which module asks. To use them in a component, keep them at the top of the file from `activate`:

```tsx
import type { ModuleContextServices } from "@cutex-desktop/module-api";

let io: Pick<ModuleContextServices, "data" | "files"> | null = null;

// in defineModule({ … }):
activate(ctx) {
  io = ctx.services;
  ctx.signal.addEventListener("abort", () => (io = null));
},

// in a component:
async function exportNotes(notes: Note[]) {
  await io?.data.write("backup/notes.json", JSON.stringify(notes));        // your folder
  await io?.files.save(JSON.stringify(notes, null, 2), { suggestedName: "notes.json", filters: [{ name: "JSON", extensions: ["json"] }] });
}

async function importNotes(): Promise<Note[] | null> {
  const file = await io?.files.pick({ filters: [{ name: "JSON", extensions: ["json"] }] });
  return file ? (JSON.parse(file.text()) as Note[]) : null;               // null: the owner cancelled
}
```

**Your folder: `data`.** It is `module-data/<your id>/` in the app's data folder on this device. `read`, `readText`, `write`, `remove`, `list` and `usage` take paths relative to it, with `/` between parts: `notes/today.json`.

- **Paths.** Each part starts with a letter, digit or `_`, and has only letters, digits, `.`, `_`, `-` and spaces. It cannot end in a dot or a space, or be a Windows device name such as `con` or `nul.txt`. At most 8 parts and 512 characters. Anything else, `..` included, is refused with `invalid`.
- **Limits.** 64 MB for the whole folder, 16 MB for one file, 4096 files and folders. Past them a write fails with `quota_exceeded` or `too_large` and changes nothing. `usage()` says what you have used.
- **Writes** replace the whole file in one step, and make the folders on the way. A string is saved as UTF-8.
- **Removing your module.** The app asks the owner whether to keep its data or delete it. Kept data is used again if the same id is installed later, and the owner can delete it in Settings → Modules → Module data (模块数据) at any time. Removing a folder from developer mode never touches the data.

**The owner's files: `files`.** `pick` opens the system's open dialog and gives you the one file the owner chose: its name, size and bytes, at most 16 MB. `save` opens the save dialog, and the app writes your bytes where they chose. You never learn where a file is, and you cannot open it again without asking. Both return `null` when the owner cancels. One dialog shows at a time: a second call while one is open fails with `busy`. While the app window is hidden or minimised they fail with `unavailable`.

**Errors.** A failed call rejects with an `Error` whose `code` is one of `invalid`, `not_found`, `too_large`, `quota_exceeded`, `busy`, `unavailable` or `unknown_module`. After your module stops, calls through its `ctx` reject with an `AbortError`.

**What this is not.** The app checks these calls in its main process, and they keep an honest module to its own folder. They are not a wall: a module runs in the app's window with the app's power (see [What you are writing](#what-you-are-writing)), and code there can reach other parts of the app.

## Looking like the app

Build with `@cutex-desktop/module-api/ui`: `Page`, `Section`, `SettingRow`, `Button`, `Toggle` and the rest, listed in the [reference](#components-cutex-desktopmodule-apiui). Their props are frozen, so they keep working when the app's look changes.

```tsx
<Page>
  <Section title="Timer" hint="Stays on this device.">
    <SettingRow label="Minutes"><NumberField value={minutes} range={[1, 120]} onCommit={(v) => setMinutes(v ?? 25)} /></SettingRow>
  </Section>
</Page>
```

A `main.page` draws its own `Page`. A `settings.page` draws only `Section`s: the app supplies the page around them, including its title and the `hintKey` line, so do not repeat those.

**In the tray.** Use `TrayButton`. For a live value such as a countdown, pass `text`, about 6 characters at most, rather than drawing your own span: the button widens to fit.

```tsx
<TrayButton label={t("my-thing.running", { time })} text={time} onClick={stop}><Timer size={16} aria-hidden /></TrayButton>
```

**On a code block.** Use `CodeBlockButton`, which matches the block's own Copy and Download. Disable it while `incomplete` is true.

```tsx
<CodeBlockButton label={t("my-thing.save")} disabled={incomplete} onClick={save}><Bookmark size={14} aria-hidden /></CodeBlockButton>
```

**Icons.** Any `lucide-react` icon fits `icon` fields and `TrayButton`. It is bundled into your module, and only the icons you import go in.

**Your own CSS.** Import a `.css` file from your code and it is built into `dist/index.css`. The template's `src/css.d.ts` lets TypeScript accept the import. Prefix your class names with your module's id. Your rules sit in a layer below the app's, so they fill gaps and do not override the app. Use the app's colours through its variables, so that themes work:

`--bg`, `--surface`, `--surface-2`, `--fg`, `--fg-muted`, `--fg-subtle`, `--border`, `--accent`, `--on-accent`, `--hover`, `--danger`, `--warn`, `--ok`

Do not rely on the app's utility classes (`flex`, `p-2` and so on). They are generated from the app's own source, so a class may be there today and gone after an update. Inline `style` and your own CSS are safe.

## Trying a code block action

`timeline.codeBlockAction` items show on the code blocks of an agent's reply, which normally needs a host and a model. To try one without any of that, turn on developer mode and click **Show a sample reply** (显示示例回复) in Settings → Modules. It draws a made-up reply with a `ts` block and a `sh` block, using the real toolbar. Your `match` and `Action` run as they will in a conversation, whether your module is loaded from a folder or installed.

**`sessionId`.** In a conversation, `CodeBlockActionProps.sessionId` is the agent's `AgentSummary.id`, so `services.agents.get(sessionId)` gives the agent and `services.agents.open(sessionId)` shows its conversation. Pass `hostId` too if you use `services.panes.open("core.conversation", { sessionId, hostId })`. In the sample reply it is `sample-session`, which is no real agent: `get` returns null there, and also for an agent that has since been deleted, so handle null.

## Trying it, then giving it to someone

| | Developer mode | Install from a file |
|---|---|---|
| For | You, while you write it | Anyone using it |
| Comes from | A folder, followed live | A `.tar.gz` from `cutex-module pack` |
| Where | Settings → Modules → Load from folder… (从文件夹加载…) | Settings → Modules → Allow local modules… (允许本地模块…), then Install from file… (从文件安装…) |
| Changes | Loads each new build | A changed file needs installing and confirming again |

The switches read differently by build. **Turn on developer mode…** is the same on every build, and off until you turn it on. Local modules are off on a public release, so Settings offers **Allow local modules…** first and **Install from file…** after you confirm. On a development build or one you built yourself they are already allowed, so Settings shows **Install from file…** and **Turn off local modules** (关闭本地模块) straight away. Each install still asks for confirmation.

Modules you added, either way, are at the top of the list in Settings → Modules, under these switches, with their own on/off switch.

**The two ways cannot run side by side for one module**, because they share its id. While an installed copy holds the id, the folder's row says so and the folder waits; remove the installed copy and the folder loads by itself. To go the other way, remove the folder from developer mode before you install.

Send the `.tar.gz` by any means you like. It is not signed, and the install dialog says the author is unverified. There is no store. Bump `version` for each release.

If a module breaks the window so badly that you cannot reach Settings, start the app with `--no-local-modules`. Nothing from a file or a folder loads for that run.

## What a module cannot do

- **No network.** The main window's content security policy does not allow it to reach other sites.
- **No Node, and files only through `data` and `files`.** A module runs in the page. No third-party Node code ever loads. See [Files](#files).
- **No windows of its own.**
- **No app files.** The build refuses `@cutex-desktop/app/*`, other private packages and files outside your folder, and release builds of the app refuse to load a module that reads them. (A dev build of the app loads such a module from this repository's own pack builder, tagged "Uses internal interfaces; may break with an app update". That is for the app's own packs, not a way around the public API.) There is no way to get a stable result from these: they change without notice.
- **No lazy loading.** A module is one file, loaded whole while it is on. Keep it small.

If you need host-side work, that is a cutex service plugin on the host, not a module. A module can check for the plugin's capability with `requires.capabilities`.

## Known gaps

These are not there today, so do not spend time looking for them:

- A popover anchored to a code block's button. Use `services.ui.confirm`, `openMenu` or a toast.
- A toast with an action button. `services.ui.toast` is text only.
- An event for the day changing. Check the date from your own timer.

## When something goes wrong

| You see | Meaning |
|---|---|
| Build: `imports @cutex-desktop/app/…: a module may import only …` | Use the public API instead. If it lacks what you need, that is a request for the API, not something to work around |
| Build: `@cutex-desktop/module-api has no X` | The name is wrong or newer than your package. Check the reference |
| Build: `imports react-dom/client: only react, react/jsx-runtime, react-dom are shared` | A second React breaks hooks. Render through slots |
| Build: `key "x.y" must start with "my-thing."` | Message keys are per module |
| Build: `pack.json says the id is "a", but defineModule … says "b"` | The two ids must be the same. Change one |
| Build: `the item "x" in the slot …: every item's id must start with "my-thing."` | Name it `my-thing.x`. The same mistake in `ctx.contribute` throws `Contribution ID must start with my-thing.` when it runs |
| Build: `src/index.tsx has no default export` | End the file with `export default defineModule({ … })`, as the message shows |
| Settings: `It needs a newer app` | Your `moduleApi` is above this app's version |
| Settings: `It reads what the public API does not have` | The build came from another version; rebuild it |
| Settings: `The id … is already used by the installed module "…"` | Remove the installed copy in Settings → Modules. The folder then loads by itself |
| Settings: `The id … belongs to a module built into the app` | Choose another id |
| Text shows as `my-thing.title` | The key is not in your `i18n` files, or you did not rebuild after adding it |
| `services.ui.notice` shows nothing | No conversation is open. Use `services.ui.toast` |
| The tray button does not show | The module is off (Settings → Modules), or its `Button` returned null |
| The module turned off with an error | `activate` threw or took too long. The error is in Settings → Modules |

## Versions

The API version is `major.minor`, the same as the app's `MODULE_API_VERSION`. A new minor version only adds things. A breaking change raises the major version, and a module's `^M.m` range then stops matching, so Settings says it needs updating instead of letting it fail. A name due for removal stays for at least one major version and warns in the console when used.

The `/experimental` entry has no such promise. Settings marks a module that imports it with "may break with an app update". Each change to it is listed below.

### Added to the stable entry

- 1.31: `ctx.services.data` and `ctx.services.files` ([Files](#files)). A module that uses them needs `"moduleApi": "^1.31"`.

### Changes to the experimental entry

- 1.29: first version.

## Reference

Everything below is generated from the package's source, so it matches what you are building against.

### The stable entry: `@cutex-desktop/module-api`

<!-- generated:stable -->

```ts
type * from "./types";

type * from "./slots";

type * from "./services";

/** The running app's API version. Compare with care: pack.json's `moduleApi` already decides whether you load. */
const MODULE_API_VERSION: string;

/** Type-checks a module definition. `export default defineModule({ … })` is what your entry file does. */
function defineModule(definition: ModuleDefinition): ModuleDefinition;

/** The services, for components. In `activate`, prefer `ctx.services`: its calls end with the module. */
const services: ModuleServices;

/** Hook. The UI's language and the message lookup. Messages are `{name}` templates. */
function useI18n(): { locale: string; t(key: MessageKey, vars?: Record<string, string | number>): string };

/** Hook. One key of a module's prefs. `fallback` must be a primitive or a stable reference. */
function useModulePref<T>(moduleId: ModuleId, key: string, fallback: T & Jsonable<T>): [T, (value: (T & Jsonable<T>) | ((previous: T) => T & Jsonable<T>)) => void];

/** A `main.page` `useTitle` for a page whose title is just its name. */
function pageTitle(key: MessageKey): (params: PageParams) => readonly PageCrumb[];

/** Hook. Every agent on the connected hosts; re-renders when they change. */
function useAgents(): readonly AgentSummary[];

/** Hook. The hosts the owner can pick from, the focus host first. */
function useHosts(): readonly { id: string; label: string; online: boolean; focus: boolean }[];
```

<!-- /generated:stable -->

### Basic types

<!-- generated:base -->

```ts
/** `^[a-z][a-z0-9-]{0,63}$`. Never changes once published: prefs and message keys are stored under it. */
type ModuleId = string;

/** `<moduleId>.<name>`, unique within a slot. */
type ItemId = `${string}.${string}`;

type HostKind = "local" | "ssh";

type HostPlatform = "windows" | "linux" | "macos";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Flat string params of a page; they live in memory only. */
type PageParams = Readonly<Record<string, string | undefined>>;

/** A message key in your own catalog: `<moduleId>.<name>`. */
type MessageKey = string;

/** Any `lucide-react` icon fits. */
type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

interface ModuleRequires {
  /** Every one must be in the host's capability list. */
  capabilities?: readonly string[];
  /** Must be active; they activate first, and this module stops when one stops. */
  modules?: readonly ModuleId[];
  /** Omitted = any. */
  hostKinds?: readonly HostKind[];
  /** Only the focus host counts. Default: any connected host satisfying the rest activates the module. */
  focusHost?: boolean;
  /** An optional host component your pages need; the app shows a card to set it up instead of the page while it is missing. */
  component?: string;
}

interface SlotItemBase {
  /** Must start with your module id and a dot. */
  id: ItemId;
  /** Ascending. The app's own items use multiples of 100. */
  order?: number;
  requires?: { capabilities?: readonly string[] };
  /** How the item shows while its requirements are not met. Each slot has its own default. */
  unavailable?: "hide" | "disable" | "notice";
}

/** `T` when it can be stored as JSON, so your own interfaces and arrays of them are fine; never for a function or the like. */
type Jsonable<T> = T extends Json
  ? T
  : T extends ((...args: never[]) => unknown) | symbol | bigint | undefined
    ? never
    : T extends readonly (infer U)[]
      ? readonly Jsonable<U>[]
      : T extends object
        ? { [K in keyof T]: Jsonable<T[K]> }
        : never;

/** Your module's own settings, kept on this device. Removing the module keeps them. A property set to `undefined` throws: leave it out. */
interface ModulePrefs {
  get<T>(key: string, fallback: T & Jsonable<T>): T;
  set<T>(key: string, value: T & Jsonable<T>): void;
  subscribe(listener: () => void): () => void;
}

interface ModuleHostContext {
  readonly id: string;
  readonly kind: HostKind;
  /** Empty until the capabilities have loaded. */
  readonly features: ReadonlySet<string>;
}

interface ModuleHostEntry extends ModuleHostContext {
  readonly featuresKnown: boolean;
  readonly focus: boolean;
  readonly inScope: boolean;
}

/** A live view of the connected hosts. Changes do not restart a module: subscribe. */
interface ModuleHostsContext {
  /** Connected hosts, the focus host first. */
  list(): readonly ModuleHostEntry[];
  get(id: string): ModuleHostEntry | undefined;
  /** Ends with the module. */
  subscribe(listener: () => void): () => void;
}
```

<!-- /generated:base -->

### Services and the module definition

<!-- generated:services -->

```ts
type AgentStatus = "needsInput" | "running" | "idle" | "offline" | "error" | "unknown";

/** One agent as a module sees it. */
interface AgentSummary {
  id: string;
  hostId: string;
  name: string;
  /** A colour hint for its avatar. */
  color: string | null;
  projectId: string | null;
  status: AgentStatus;
  /** Archived agents are in the list too. */
  archived: boolean;
}

/** "ownerMessage": the owner sent a message from this desktop. "command", "tool": an agent ran one on a connected host. */
interface ActivityEvent {
  kind: "ownerMessage" | "command" | "tool";
  hostId: string;
}

interface PaneOpenOptions {
  /** Beside the focused pane rather than in it. */
  beside?: boolean;
  /** Give it the keyboard focus. Default false. */
  focus?: boolean;
  /** Open without taking the view. Wins over `focus`. */
  background?: boolean;
}

/** Says why when it did not open. */
type PaneOpenResult =
  | { status: "opened"; kind: string; paneId: string | null; instanceId: string | null }
  | { status: "unavailable"; reason: string }
  | { status: "stale" };

interface ModuleServices {
  ui: {
    /** A short line above the input of the conversation in view. With no conversation open nobody sees it: use `toast`. */
    notice(text: string, tone?: "info" | "error"): void;
    /** A short message at the bottom of the window, on any screen, for a few seconds. One at a time: a new one replaces it. */
    toast(text: string): void;
    /** A modal dialog. Resolves true when confirmed. */
    confirm(message: string, danger?: boolean): Promise<boolean>;
    /** Shows a `main.page`. */
    openPage(page: ItemId, params?: PageParams): void;
    /** Back to the conversation. */
    closePage(): void;
    /** Opens a Settings page by its name. `anchor`: a card to scroll to; `sub`: one of its sub-pages. */
    openSettings(page: string, focus?: { anchor?: string; sub?: string }): void;
  };
  panes: {
    /** `core.conversation` (params `{ sessionId, hostId? }`) or `page:<main.page id>` (params = page params). */
    open(kind: string, params?: Json, options?: PaneOpenOptions): PaneOpenResult;
  };
  agents: {
    /** Every agent on the connected hosts. The same array until something changes, so it works with useSyncExternalStore. */
    list(): readonly AgentSummary[];
    get(id: string): AgentSummary | null;
    subscribe(listener: () => void): () => void;
    /** Shows the agent's conversation. */
    open(id: string): void;
  };
  activity: {
    /** Called once per event. Costs nothing until you subscribe. */
    subscribe(listener: (event: ActivityEvent) => void): () => void;
  };
}

/** One entry of `data.list`. `modified` is milliseconds since 1970. */
interface ModuleDataEntry {
  name: string;
  kind: "file" | "folder";
  /** Bytes; 0 for a folder. */
  size: number;
  modified: number;
}

/**
 * Your module's own folder on this device. Paths are relative, `/` between parts: `notes/today.json`. A part starts with
 * a letter, digit or `_`, and has only letters, digits, `.`, `_`, `-` and spaces. A failed call rejects with an Error
 * whose `code` says why: `invalid` (a bad path, or a link in the way), `not_found`, `too_large`, `quota_exceeded`,
 * `unknown_module`, `unavailable`.
 */
interface ModuleData {
  /** The file's bytes; null when there is no such file. */
  read(path: string): Promise<Uint8Array | null>;
  /** The file as UTF-8 text; null when there is no such file. */
  readText(path: string): Promise<string | null>;
  /** Writes the whole file, making folders on the way. A string is saved as UTF-8. Replaces the file in one step. */
  write(path: string, data: string | Uint8Array): Promise<void>;
  /** A file, or a folder with everything in it. Nothing happens when it is not there. */
  remove(path: string): Promise<void>;
  /** What is in a folder; `""` (the default) = the top. */
  list(folder?: string): Promise<readonly ModuleDataEntry[]>;
  /** Bytes used, the limit for the whole folder and the limit for one file. */
  usage(): Promise<{ used: number; limit: number; fileLimit: number }>;
}

/** Offered file types in a dialog: `{ name: "Notes", extensions: ["md", "txt"] }`. `"*"` = any. */
interface FileFilter {
  name: string;
  extensions: readonly string[];
}

/** The file the owner chose: its name (not where it is) and its bytes. */
interface PickedFile {
  name: string;
  size: number;
  data: Uint8Array;
  /** The bytes as UTF-8 text. */
  text(): string;
}

/** The system's open and save dialogs. Only the owner's choice reaches your module, and never where the file is. */
interface ModuleFiles {
  /** Asks the owner for one file. null when they cancel. */
  pick(options?: { filters?: readonly FileFilter[] }): Promise<PickedFile | null>;
  /** Asks the owner where to save, and saves there. The name they chose, or null when they cancel. */
  save(data: string | Uint8Array, options?: { suggestedName?: string; filters?: readonly FileFilter[] }): Promise<{ name: string } | null>;
}

/** `ctx.services`: the services, and the ones that belong to your module alone. */
interface ModuleContextServices extends ModuleServices {
  /** Your module's own folder (`userData/module-data/<id>/`). */
  data: ModuleData;
  /** Open and save dialogs. */
  files: ModuleFiles;
}

/** What a module's `activate` is given. Everything in it ends when the module stops. */
interface ModuleContext {
  readonly id: ModuleId;
  /** Aborted when the module stops. */
  readonly signal: AbortSignal;
  /** Goes up by one on each activation. */
  readonly generation: number;
  /** The host in focus. */
  readonly host: ModuleHostContext;
  readonly hosts: ModuleHostsContext;
  /** `data` and `files` are only here, not in the `services` you import: they know which module asks. */
  readonly services: ModuleContextServices;
  readonly prefs: ModulePrefs;
  /** Adds an item while the module runs. Returns a function to take it away. */
  contribute<S extends SlotId>(slot: S, item: SlotMap[S]): () => void;
  t(key: MessageKey, vars?: Record<string, string | number>): string;
}

interface ModuleDefinition {
  /** Your module's id, the same as in pack.json. */
  id: ModuleId;
  /** Its name in Settings → Modules. */
  titleKey: MessageKey;
  descriptionKey?: MessageKey;
  requires?: ModuleRequires;
  /** Default true. */
  defaultEnabled?: boolean;
  /** Items that are there whenever the module is on. */
  contributes?: { readonly [S in SlotId]?: readonly SlotMap[S][] };
  /** Subscriptions and items that depend on data. Do not wait on the network here. */
  activate?(context: ModuleContext): void | Promise<void>;
}
```

<!-- /generated:services -->

### Components: `@cutex-desktop/module-api/ui`

<!-- generated:ui -->

```ts
/** A page's scrolling column, with the app's gutters and width. `aside`: a panel beside it when there is room. */
function Page(props: { children: ReactNode; aside?: ReactNode }): ReactNode;

/** A row for filters and actions at the top of a page. */
function PageToolbar(props: { children?: ReactNode }): ReactNode;

/** A titled card holding rows. */
function Section(props: { title?: ReactNode; hint?: ReactNode; actions?: ReactNode; children: ReactNode }): ReactNode;

/** One setting: label and hint on the left, its control on the right. In a Section. */
function SettingRow(props: { label: ReactNode; hint?: ReactNode; children?: ReactNode }): ReactNode;

/** One thing in a list: a leading mark, a name, a grey line, actions on the right. In a Section. */
function ListRow(props: { leading?: ReactNode; title: ReactNode; detail?: ReactNode; actions?: ReactNode }): ReactNode;

/** Applies at once. */
function Toggle(props: { checked: boolean; onChange(checked: boolean): void; disabled?: boolean; label?: string }): ReactNode;

/** Applies at once. */
function Select<T extends string>(props: { value: T; options: readonly { value: NoInfer<T>; label: string; disabled?: boolean }[]; onChange(value: NoInfer<T>): void; disabled?: boolean; label?: string }): ReactNode;

/** A short row of choices. Applies at once. */
function Segmented<T extends string>(props: { value: T; options: readonly { value: NoInfer<T>; label: string; title?: string }[]; onChange(value: NoInfer<T>): void; disabled?: boolean; label?: string }): ReactNode;

/** Reports every keystroke. For a draft you save yourself. */
function TextInput(props: { value: string; onChange(value: string): void; placeholder?: string; mono?: boolean; disabled?: boolean; maxLength?: number; label?: string }): ReactNode;

/** Applies on Enter or when it loses focus. */
function TextField(props: { value: string; onCommit(value: string): void | Promise<unknown>; placeholder?: string; mono?: boolean; disabled?: boolean; maxLength?: number; label?: string }): ReactNode;

/** Applies on Enter or when it loses focus. `null` = emptied. */
function NumberField(props: { value: number | null; range: readonly [number, number]; unit?: string; step?: number; slider?: boolean; onCommit(value: number | null): void; disabled?: boolean; label?: string; placeholder?: string }): ReactNode;

function Button(props: { children: ReactNode; onClick?(event: MouseEvent<HTMLButtonElement>): void; variant?: "primary" | "secondary" | "ghost"; size?: "md" | "sm"; danger?: boolean; disabled?: boolean; title?: string }): ReactNode;

/** `label` is its tooltip and accessible name. `children` is the icon. */
function IconButton(props: { label: string; children: ReactNode; onClick?(event: MouseEvent<HTMLButtonElement>): void; variant?: "secondary" | "ghost"; size?: "md" | "sm"; danger?: boolean; disabled?: boolean }): ReactNode;

/** A button that fits the tray (`tray.entry`). `children` is the icon. `text` is a short live value such as a countdown, up to about 6 characters: it goes after the icon and the button widens to fit. Give at least one of the two. */
function TrayButton(props: { label: string; children?: ReactNode; text?: string; onClick?(event: MouseEvent<HTMLButtonElement>): void }): ReactNode;

/** A button that fits a code block's toolbar (`timeline.codeBlockAction`), beside its Copy and Download. `children` is a 14 px icon. */
function CodeBlockButton(props: { label: string; children: ReactNode; onClick?(event: MouseEvent<HTMLButtonElement>): void; disabled?: boolean }): ReactNode;

/** A small state mark. */
function StatusIcon(props: { kind: "blocked" | "review" | "active" | "closed" | "error" | "starting" | "running" | "stopped"; size?: number }): ReactNode;

/** Pick one of the owner's hosts; draws nothing with only one. Hosts that are not online cannot be picked. */
function HostPicker(props: { value: string; onChange(hostId: string): void; title: string }): ReactNode;

/** A short line for an empty list, with an optional action. In a Section. */
function EmptyState(props: { children: ReactNode; action?: ReactNode }): ReactNode;

/** A warning or a remark inside a card. */
function Notice(props: { children: ReactNode; tone?: "warn" | "info" }): ReactNode;

/** Placeholder rows while something loads. */
function Loading(props: { rows?: number }): ReactNode;

/** Opens the app's menu under an element, or at a point (for a right click). */
function openMenu(at: HTMLElement | { x: number; y: number }, entries: MenuEntry[]): void;
```

<!-- /generated:ui -->

## Slots

<!-- generated:slots -->

### `nav.primary`

An entry in the app's navigation that opens a page or runs something. While its requirements are not met it is `disable` unless the item says otherwise.

```ts
interface NavItem extends SlotItemBase {
  icon: Icon;
  titleKey: MessageKey;
  /** The top list (default) or the footer row. */
  area?: "top" | "footer";
  target: PageTarget | { run(): void | Promise<void> };
  /** Highlighted while one of these pages is open. Default: `target.page`. */
  activePages?: readonly ItemId[];
  /** Hook. A number, a dot or a warning on the entry. */
  useBadge?(): { text?: string; dot?: boolean; title?: string; attention?: boolean } | null;
  /** Hook. false = not drawn right now. */
  useShown?(): boolean;
  /** Hook. Highlighted while true (for an entry whose target is `run`). */
  useActive?(): boolean;
}
```

### `main.page`

A full page, opened with `services.ui.openPage` or from a nav entry. While its requirements are not met it is `hide` unless the item says otherwise.

```ts
interface PageItem extends SlotItemBase {
  Page: ComponentType<{ params: PageParams }>;
  /** Hook. The page's title. `pageTitle(key)` makes the usual one. */
  useTitle(params: PageParams): readonly PageCrumb[];
}
```

### `settings.page`

A page of Settings. While its requirements are not met it is `hide` unless the item says otherwise.

```ts
interface SettingsPageItem extends SlotItemBase {
  /** The name `services.ui.openSettings` opens it by. Use your module id: names are unique across modules. */
  page: string;
  group: SettingsGroupId;
  icon: Icon;
  titleKey: MessageKey;
  /** One line under the title saying what the page is for. */
  hintKey?: MessageKey;
  /** Where the page's settings live: on this device, on the host in focus, or nowhere. */
  source: "local" | "host" | null;
  Page: ComponentType;
  /** Parts on a page of their own, opened with `openSettings(page, { sub })`. */
  subPages?: Readonly<Record<string, { titleKey: MessageKey; hintKey?: MessageKey; Page: ComponentType }>>;
  /** Hook. A dot or text on the nav row. */
  useBadge?(): { dot?: boolean; text?: string } | null;
  /** Settings search: extra words that find this page. */
  keywords?: readonly MessageKey[];
}
```

### `settings.section`

A card added to a Settings page that places sections (including another module's). While its requirements are not met it is `hide` unless the item says otherwise.

```ts
interface SettingsSectionItem extends SlotItemBase {
  /** The target page's name. */
  page: string;
  /** Needed for search to find it. */
  titleKey?: MessageKey;
  keywords?: readonly MessageKey[];
  Section: ComponentType;
}
```

### `conversation.status`

A status category of the agent in view, in the row above the input and the capsule. While its requirements are not met it is `hide` unless the item says otherwise.

```ts
interface StatusItem<D = any> extends SlotItemBase {
  titleKey: MessageKey;
  defaultPlace: StatusPlace;
  /** Hook. The data and the collapsed line; null = nothing to show for this agent. `pulse`: bump it to highlight the capsule. */
  useStatus(sessionId: string): { data: D; line: StatusLine; pulse?: number } | null;
  Meta?: ComponentType<{ sessionId: string; data: D }>;
  Body: ComponentType<{ sessionId: string; data: D }>;
  /** The status row's part. "bar" and "both" need it. */
  Bar?: ComponentType<StatusBarProps>;
  /** Default "end". */
  barSide?: "start" | "end";
  icon?: Icon;
}
```

### `timeline.codeBlockAction`

A button on the toolbar of a fenced code block in an agent's reply. Not in the owner's own messages or archived agents. While its requirements are not met it is `hide` unless the item says otherwise.

```ts
interface CodeBlockActionItem extends SlotItemBase {
  /** Pure and cheap: it runs for every tagged block. */
  match(block: CodeBlockMatch): boolean;
  Action: ComponentType<CodeBlockActionProps>;
}
```

### `ref.action`

An action on anything referable (a message, an agent, a page), as an icon or a menu row. While its requirements are not met it is `hide` unless the item says otherwise.

```ts
interface RefActionItem extends SlotItemBase {
  /** Ref kinds this applies to. Omitted = all. */
  kinds?: readonly string[];
  excludeKinds?: readonly string[];
  icon: Icon;
  titleKey: MessageKey;
  /** Hook. Live state for this ref, such as "already bookmarked". */
  useState?(ref: CutexRef): { active?: boolean; titleKey?: MessageKey; tooltip?: string; disabledReason?: string } | null;
  /** Always an icon on a message's hover bar. Otherwise a row of its menu. */
  inline?: boolean;
  submenu?(ref: CutexRef): MenuEntry[] | Promise<MenuEntry[]>;
  run(ref: CutexRef): void | Promise<void>;
}
```

### `notify.method`

How a device delivers a notification. One item per method; the host's table decides when it runs. While its requirements are not met it is `hide` unless the item says otherwise.

```ts
interface NotifyMethodItem extends SlotItemBase {
  method: "desktop" | "sound" | "bigAlert";
  titleKey: MessageKey;
  /** Cheap and synchronous. */
  available(): NotifyMethodAvailability;
  /** Asks the OS, only when `available()` says "needsPermission". */
  requestPermission?(): Promise<void>;
  deliver(notification: NotifyDelivery): void;
}
```

### `tray.entry`

A button at the far end of the tray. The component decides when it shows: return null for nothing. Use `TrayButton` for its look. While its requirements are not met it is `hide` unless the item says otherwise.

```ts
interface TrayEntryItem extends SlotItemBase {
  Button: ComponentType;
}
```

### `identity.menu`

Rows in the menu of the user button, read each time it opens. While its requirements are not met it is `hide` unless the item says otherwise.

```ts
interface IdentityMenuItem extends SlotItemBase {
  entries(): MenuEntry[];
}
```

### `desktop.widget`

A kind of widget the owner can place on the desktop. While its requirements are not met it is `hide` unless the item says otherwise.

```ts
interface DesktopWidgetItem extends SlotItemBase {
  titleKey: MessageKey;
  descriptionKey?: MessageKey;
  icon: Icon;
  size: { units: WidgetUnitSizes; ratio?: number; resizable?: boolean };
  /** card (default): the desktop's glass card. round: a circle, keep `ratio` 1. bare: no chrome. */
  shape?: "card" | "round" | "bare";
  /** More than one instance allowed. Default false. */
  multiple?: boolean;
  settings?: readonly WidgetSettingField[];
  /** A new instance's settings; a function of the locale when they hold words. */
  defaults?: WidgetSettings | ((locale: string) => WidgetSettings);
  /** Re-render cadence through the shared ticker. Default: never. */
  refresh?: "minute" | "second";
  Widget: ComponentType<DesktopWidgetProps>;
}
```

### Types the slots use

```ts
/** A page a link opens: a `main.page` id and its params. */
interface PageTarget {
  page: ItemId;
  params?: PageParams;
}

/** One breadcrumb of a page's title. The last one is the page's name. */
interface PageCrumb {
  text: string;
  /** Clickable. Not on the last crumb. */
  to?: PageTarget;
  lead?: ReactNode;
  trail?: ReactNode;
}

/** The group of Settings a page sits in. The app fixes their order. */
type SettingsGroupId = "app" | "connection" | "agents" | "tools" | "data" | "system";

/** Where a status category shows: the row above the input, the floating capsule, both, nowhere. */
type StatusPlace = "bar" | "capsule" | "both" | "off";

/** One collapsed-capsule line. */
interface StatusLine {
  icon: ReactNode;
  text: ReactNode;
  /** Tooltip. */
  title: string;
  trailing?: ReactNode;
}

/** What a status item's `Bar` is given. */
interface StatusBarProps {
  sessionId: string;
  /** Your placement includes the status row: draw your chip. Otherwise draw only what a request opens. */
  inline: boolean;
}

/** What a code block's language and host are. */
interface CodeBlockMatch {
  /** The fence tag, lower-cased. Blocks without one never reach items. */
  language: string;
  hostId: string;
  /** null = unknown. */
  platform: HostPlatform | null;
}

interface CodeBlockActionProps extends CodeBlockMatch {
  sessionId: string;
  /** Trailing newlines trimmed. */
  code: string;
  /** The fence is still streaming: the action should be unavailable. */
  incomplete: boolean;
}

/** A stored pointer to something referable. Data only. */
interface CutexRef {
  hostId: string;
  /** Agent, turn, note and so on. */
  kind: string;
  /** Equal keys in a (hostId, kind) mean the same target. */
  key: string;
  title: string;
  params: Readonly<Record<string, string>>;
  snapshot?: { icon?: string; agentName?: string; snippet?: string; at: string };
}

/** One row of a menu. `"separator"` draws a line; a falsy entry is skipped, so `cond && {…}` works. */
type MenuEntry = MenuAction | "separator" | null | false | "" | 0 | undefined;

interface MenuAction {
  label: string;
  icon?: ReactNode;
  /** Right-aligned text, such as a shortcut. */
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Tooltip, for example why it is disabled. */
  title?: string;
  /** Asks in a dialog before running. */
  confirm?: string;
  /** Asks in place instead: the first select turns the row into this text, a second one runs it. */
  armed?: string;
  /** A row that opens these entries beside it. `onSelect` is then not used. */
  submenu?: MenuEntry[] | (() => Promise<MenuEntry[]>);
  /** What it does. Leave it out on a disabled row. */
  onSelect?(): void | Promise<void>;
}

/** Whether a notification method can run here. */
type NotifyMethodAvailability = "ok" | "unsupported" | "needsPermission";

/** One delivery to a notification method. */
interface NotifyDelivery {
  /** Stable per occurrence: replaces an earlier notification with the same key. */
  key: string;
  event: string;
  eventTitle: string;
  level: "urgent" | "needsYou" | "inform" | "record";
  title: string;
  body: string;
  agentId: string | null;
  agentName: string | null;
  sound: boolean;
  onClick?(): void;
}

/** A widget's per-instance settings. */
type WidgetSettings = { readonly [key: string]: Json };

interface WidgetFieldBase {
  key: string;
  labelKey: MessageKey;
  hintKey?: MessageKey;
}

/** One field of a widget's settings form. The app draws the form. */
type WidgetSettingField =
  | (WidgetFieldBase & { type: "text"; maxLength?: number; placeholderKey?: MessageKey })
  | (WidgetFieldBase & { type: "number"; min: number; max: number; step?: number; unit?: string })
  | (WidgetFieldBase & { type: "toggle" })
  | (WidgetFieldBase & { type: "select"; options: readonly { value: string; labelKey: MessageKey }[] })
  | (WidgetFieldBase & { type: "timezone" });

/** What a widget may do beyond itself. Each returns false when it did not happen. */
interface WidgetActions {
  openAgent(hostId: string, sessionId: string): Promise<boolean>;
  openPage(page: ItemId, params?: PageParams): boolean;
  /** Only after the owner confirms the text in a dialog. */
  sendToAgent(hostId: string, sessionId: string, text: string): Promise<boolean>;
}

interface DesktopWidgetProps {
  instanceId: string;
  /** The box in px. */
  width: number;
  height: number;
  /** The box in grid units (40 px, 16 px apart). */
  units: { w: number; h: number };
  theme: "light" | "dark";
  settings: WidgetSettings;
  setSettings(next: WidgetSettings): void;
  reducedMotion: boolean;
  /** The desktop is being arranged: draw the content inert. */
  arranging: boolean;
  /** The shared ticker's time in epoch ms. Use it instead of your own timer. */
  now: number;
  actions: WidgetActions;
}

/** Sizes in grid units (40 px, 16 px apart). A box is at least 2 × 2. */
interface WidgetUnitSizes {
  min: readonly [w: number, h: number];
  max: readonly [w: number, h: number];
  default: readonly [w: number, h: number];
  presets?: Readonly<Record<string, readonly [w: number, h: number]>>;
}
```

<!-- /generated:slots -->

## The experimental entry: `@cutex-desktop/module-api/experimental`

<!-- generated:experimental -->

```ts
/** Slots that have no stable shape yet. */
type ExperimentalSlotId =
  | "side.component"
  | "pane.kind"
  | "pane.desktop"
  | "timeline.received"
  | "timeline.tool"
  | "timeline.turnAttachment"
  | "timeline.intro"
  | "conversation.gutter"
  | "customize.region"
  | "window.search";

type ExperimentalItem = SlotItemBase & { readonly [field: string]: unknown };

/** The whole daemon API of one connected host. Untyped here. A call after your module stopped is refused. */
type ExperimentalDaemonApi = { readonly [method: string]: (...args: never[]) => Promise<unknown> };

/** `defineModule` with experimental slots as well. */
function defineExperimentalModule(definition: ModuleDefinition & { experimental?: { readonly [S in ExperimentalSlotId]?: readonly ExperimentalItem[] } }): ModuleDefinition;

/** Adds an item to an experimental slot while the module runs. */
function contributeExperimental(context: ModuleContext, slot: ExperimentalSlotId, item: ExperimentalItem): () => void;

/** Daemon calls bound to one connected host's current connection. */
function daemonFor(context: ModuleContext, hostId: string): ExperimentalDaemonApi;

/** The right side and the tool area. */
const side: {
  open(kind: ItemId, params?: Json, options?: Record<string, unknown>): { status: string };
  close(instanceId: string): void;
  list(kind: ItemId): readonly { id: string; kind: ItemId; state: Json; pinned: boolean }[];
};

/** Jump to a turn in the timeline. */
function focusTurn(hostId: string, sessionId: string, turnId: string): Promise<{ status: string }>;
```

<!-- /generated:experimental -->
