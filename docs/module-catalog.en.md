# Module catalog

<!-- Generated, do not edit: node apps/desktop/scripts/module-catalog.mjs. apps/desktop/test/moduleCatalog.test.ts checks it matches the code. -->

Every module in Settings → Modules: what it does, where it shows up, whether it starts on, and whether Lean keeps it. Groups and order are the settings page's (shared/moduleGroups.ts); where a module shows up comes from the places it registers. Read this to answer "should module X be on".

Quick setup: Lean keeps only what day-to-day work needs; Recommended is each module's own default; Everything turns on every installed module. None of them changes core or optional modules.

## Work

### Delegations (`delegations`)

- What it does: Delegations between agents, shown in the status row and capsule
- Shows up in: Sidebar entry, Page, Shelf tab, Status row, Timeline, Project tab
- Default: on
- Lean: kept

### Subagents (`subagents`)

- What it does: Working subagents, shown in the status row and capsule
- Shows up in: Shelf tab, Status row, Timeline
- Default: on
- Lean: kept

### Goal (`goal`)

- What it does: The thread goal (/goal) as a status category: objective, time, budget, pause / resume
- Shows up in: Status row
- Default: on
- Lean: kept

### Plan (`plan`)

- What it does: The model's progress list (update_plan) as a status category
- Shows up in: Status row
- Default: on
- Lean: kept

### Background terminals (`background-terminals`)

- What it does: View agents’ background terminals, check CPU and memory use, and terminate terminals
- Shows up in: Status row
- Default: on
- Lean: kept

### Alarms (`alarms`)

- What it does: View and cancel reminders set by agents
- Shows up in: Status row
- Default: on
- Lean: kept

### Quick launch (`quick-chats`)

- What it does: The Quick launch entry and its draft page
- Shows up in: Sidebar entry, Page
- Default: on
- Lean: turned off

### Project view (`project-view`)

- What it does: View a project’s agent work, delegations, jobs and recent activity; open it from the Shelf, quick switcher or project menu
- Shows up in: Sidebar entry, Shelf tab, Project tab
- Default: on
- Lean: turned off

### Jobs (`jobs`)

- What it does: Background jobs on the host, shown in the status row and capsule; Linux hosts only
- Shows up in: Sidebar entry, Page, Status row
- Default: on
- Needed by: NCI remote jobs
- Lean: turned off

### Workflows (`workflows`)

- What it does: Orchestration scripts agents write when you ask for one: approve the run plan, follow each step's progress and result, stop or continue (needs cutex workflows)
- Shows up in: Sidebar entry, Page
- Default: off
- Lean: turned off

### Services (`services`)

- What it does: View and open web services started by agents
- Shows up in: Sidebar entry, Page, Project tab, Settings section
- Default: on
- Lean: turned off

### Personal assistants (`personal-assistants`)

- What it does: Personal assistants you set up: they arrange work in the projects you choose and pass requests to each project's director after you confirm
- Shows up in: Sidebar entry, Page, Shelf tab, Project tab
- Default: on
- Lean: turned off

### Safety check grants (`safety-grants`)

- What it does: Review commands blocked by Claude Code in full-access mode; the owner can approve one retry of the same command
- Shows up in: Timeline
- Default: on
- Lean: turned off

### Claude Science (`claude-science`)

- What it does: Run several Claude Science accounts side by side on a host: one cutex managed service per account, with its own directory and login, opened in the in-app browser
- Shows up in: Sidebar entry, Page
- Default: optional, included with the app, off

## Browsing & files

### Workspace (`workspace`)

- What it does: Files, changes and file previews in the Shelf, for local and remote hosts alike
- Shows up in: Shelf tab, Settings section
- Default: on
- Lean: kept

### Diff (`diff`)

- What it does: View workspace Git changes and file changes from individual turns in the Shelf
- Shows up in: Shelf tab
- Default: on
- Lean: kept

### Terminal (`terminal`)

- What it does: Open a terminal for the agent workspace in the Shelf, run by cutex on the host
- Shows up in: Shelf tab, Code block button
- Default: on
- Lean: kept

### Artifacts (`artifacts`)

- What it does: The project's artifact library: versions of files agents published or that were captured automatically, to preview, compare and cite
- Shows up in: Shelf tab, Timeline, Project tab, Settings section
- Default: on
- Lean: kept

### Browser (`browser`)

- What it does: Browse web pages and cutex services with separate browsing environments for each host
- Shows up in: Shelf tab, Timeline, Tray button, Settings page
- Default: on
- Needed by: Claude Science, WhatsApp
- Lean: turned off

### Search old tasks (`session-search`)

- What it does: Search old tasks on a page: filter, preview, then open the conversation at that turn
- Shows up in: Page
- Default: on
- Lean: turned off

### Search (`thread-search`)

- What it does: Search your messages and replies in the current agent conversation; click a result to jump to it
- Shows up in: Conversation toolbar
- Default: on
- Lean: turned off

### Notes (`notes`)

- What it does: Keep independent notes beside their source turns, outside the main chat.
- Shows up in: Shelf tab, Conversation toolbar, Timeline
- Default: on
- Lean: turned off

### Bookmarks (`bookmarks`)

- What it does: Save references to peek at content or focus existing tools; stored in the desktop app.
- Shows up in: Shelf tab, Conversation toolbar, Timeline, Desktop widget, Tray button, Settings section
- Default: on
- Lean: turned off

### Downloads (`remote-copies`)

- What it does: Files saved to this computer: artifact versions and files from remote hosts; open, show in folder, delete
- Shows up in: Shelf tab, Settings section
- Default: on
- Lean: turned off

### Baidu Netdisk (`baidu-pan`)

- What it does: Browse and search Baidu Netdisk and download files to a folder on the chosen host; no upload or delete
- Shows up in: Shelf tab
- Default: optional, included with the app, off

## Messages & notifications

### Agent bus (`agent-bus`)

- What it does: Manage messaging between agents and review undelivered messages
- Shows up in: Settings section
- Default: on
- Lean: kept

### Owner notifications (`owner-notify`)

- What it does: Messages agents send you: who may send, delivery and rate limits
- Shows up in: Settings section
- Default: on
- Lean: kept

### Side chat (`side-chat`)

- What it does: Start temporary side chats with the current context; their content stays out of the main conversation
- Shows up in: Shelf tab, Settings section
- Default: on
- Lean: turned off

### Service notifications (`service-notify`)

- What it does: Notifications services send you: per-service switch, desktop and phone alerts, quiet hours and history
- Shows up in: Settings page, Settings section
- Default: on
- Lean: turned off

### WhatsApp (`whatsapp`)

- What it does: Keeps WhatsApp Web open in this computer's Cutex browser and sends a service notification for new messages. Leave it off if you don't use WhatsApp
- Shows up in: Settings page
- Default: optional, included with the app, off

## Input

### Feature Profiles (`feature-profiles`)

- What it does: Model endpoints only app features (such as prompt enhance) use; managed in Settings → Profiles, agents can't see or use them
- Shows up in: Settings section
- Default: on
- Lean: turned off

### Input Refinement (`input-refinement`)

- What it does: Rewrite the draft or the selection in the input with a template: prompt enhance, correction learning or your own
- Shows up in: Composer button, Settings page, Settings section
- Default: on
- Lean: turned off

## Hosts & runtimes

### Installed runtimes (`runtimes`)

- What it does: View runtime versions and the agents using each version
- Shows up in: Settings section
- Default: on
- Lean: kept

### Agent runtime upgrades (`runtime-packages`)

- What it does: Upgrade idle agents to the new runtime
- Shows up in: Settings section
- Default: on
- Lean: kept

### Backend updates (`backend-upgrade`)

- What it does: View, download, install and roll back the cutex release on a host
- Shows up in: Settings page
- Default: on
- Lean: kept

### Desktop updates (`updater`)

- What it does: Check desktop app updates and view error logs
- Shows up in: Settings page
- Default: on
- Lean: kept

### Usage (`usage`)

- What it does: Quota, token ledger and price table
- Shows up in: Settings page
- Default: on
- Lean: kept

### Claude accounts (`claude-accounts`)

- What it does: Settings → Profiles → Claude accounts: independent Claude logins and API keys, login guide and quota; add a subscription right beside a profile's account select (cutex claude-accounts)
- Shows up in: Settings section, Profile field button
- Default: on
- Lean: kept

### Kimi accounts (`kimi-accounts`)

- What it does: Manage Kimi subscription logins; each account keeps a separate login on the host for Kimi profiles
- Shows up in: Settings section
- Default: on
- Lean: turned off

### Host links (`peers`)

- What it does: Pair with other cutex hosts: invite / join, per-peer export and review policy, remote agents, audit; delegations show the peer origin and sync state
- Shows up in: Settings section
- Default: on
- Lean: turned off

### Access (`remote-access`)

- What it does: Manage host listen addresses, allowed web origins (CORS) and device pairing
- Shows up in: Settings section
- Default: on
- Lean: turned off

### Network proxy (`proxy`)

- What it does: Set proxies for the desktop app's updates and network requests on the selected host; profiles can override the host proxy
- Shows up in: Settings page, Settings section
- Default: on
- Lean: turned off

### Users (`users`)

- What it does: Settings → Hosts: this host's users and grants (which projects and agents they see, whether they may send), who each device and linked host belongs to; non-owner connections hide host pages, the timeline says who sent a message
- Shows up in: Project tab, Settings section
- Default: on
- Lean: turned off

### Import from CC Switch (`profile-import`)

- What it does: Import Claude Code and Codex provider configurations from CC Switch on the host as profiles, keeping the original configurations
- Shows up in: Settings section
- Default: on
- Lean: turned off

### Runtime configuration (`codex-config`)

- What it does: Plugins, MCP servers, skills and hooks of each runtime; skills can be copied between Codex and Claude
- Shows up in: Settings page
- Default: on
- Lean: turned off

### NCI remote jobs (`nci`)

- What it does: Jobs agents submit to NCI Gadi (PBS): the NCI tag, PBS job id and manual result marking on the Jobs page, and the setup guide in Settings. Leave it off if you don't use NCI.
- Shows up in: Settings page
- Default: optional, included with the app, off

## Personal

### Desktop (`home`)

- What it does: Show your identity card, clocks, Needs you, usage and pinned tiles on the desktop, and manage your personal page; sync home content to other devices through the host
- Shows up in: Sidebar entry, Shelf tab, Desktop widget, Settings section
- Default: on
- Lean: turned off

#### Running agents (`running-agents`)

- What it does: Lists the agents working right now on the desktop: what they are doing and for how long; click to open one
- Part of: Desktop (Desktop widget)
- Default: on
- Lean: turned off

#### World clock (`world-clock`)

- What it does: The time in a few cities on the desktop, bare like the desktop clock (Canberra and Chongqing by default); hover shows how far each is from here
- Part of: Desktop (Desktop widget)
- Default: on
- Lean: turned off

### Opening (`intro`)

- What it does: The opening above a conversation's first turn: the profile's portrait and greeting; also the portraits on the New agent and Quick start pages
- Shows up in: Timeline
- Default: on
- Lean: turned off

### Desk pet (`desk-pet`)

- What it does: A small character on your desktop: it types while agents use tokens, shows today's token count below it, and shows a mark over its head when something waits for you. Drag it anywhere on screen
- Shows up in: Tray button, Settings page, Avatar menu
- Default: optional, not downloaded, off

## Developer tools

### Task Service (`task-service`)

- What it does: Shows deliveries and tool calls of the removed Task Service (cutex task-service) in old transcripts
- Shows up in: Timeline
- Default: on
- Lean: turned off

### Status capsule (`status-capsule`)

- What it does: The floating status capsule over the conversation, optional. While it is off, items placed in the capsule show in the status row; its position, size and each item's choice are kept
- Shows up in: Settings page
- Default: off
- Lean: turned off

## Core modules

### Projects (`projects`)

- What it does: The Projects page and its sidebar entry: overview, agents, delegations, memory, settings
- Shows up in: Sidebar entry, Page, Timeline, Settings section
- Default: required, always on: Project settings, members, memory and director rotation open from here

### Approvals (`approvals`)

- What it does: Review agent actions awaiting the owner’s approval
- Shows up in: Sidebar entry, Page, Timeline, Settings section
- Default: required, always on: Everything waiting for your approval is handled here

### Archive (`archive`)

- What it does: View and restore archived agents and set archive behavior
- Shows up in: Settings page
- Default: required, always on: Finding and restoring archived agents needs it

### Storage (`storage`)

- What it does: See host data sizes and retention rules
- Shows up in: Settings page
- Default: required, always on: Clean-up confirmations, receipts and retries must stay in reach

### App shell (`shell`)

- What it does: Manage general settings, appearance, notifications and other desktop app preferences
- Shows up in: Sidebar entry, Page, Settings page, Settings section
- Default: core, always on

### Conversation (`conversation`)

- What it does: Timeline and composer
- Shows up in: Shelf tab, Timeline, Settings page
- Default: core, always on

### Connection (`connection`)

- What it does: Manage host connections, startup connections and connection diagnostics
- Shows up in: Settings page
- Default: core, always on

### Agent config (`agent-config`)

- What it does: Manage profiles, creation defaults, shared instructions and collaboration
- Shows up in: Sidebar entry, Page, Settings page
- Default: core, always on

### Notifications (`notifications`)

- What it does: Set event levels, delivery methods and desktop app alerts
- Shows up in: Settings page, Notification method
- Default: core, always on

### Quick switcher (`quick-switch`)

- What it does: its shortcut searches and opens agents, services, artifacts, pages and Shelf pages from anywhere, without depending on any pane
- Shows up in: Quick switch
- Default: core, always on

### Performance log (`perf-log`)

- What it does: One entry whenever the UI stalls for more than 100 ms: when, what was on screen, what you just did and which code took longest. Kept on this computer only, never sent
- Shows up in: Settings section
- Default: core, always on

### About & known issues (`about`)

- What it does: View known issues, release notes, project links and licenses
- Shows up in: Settings section
- Default: core, always on

### Introduction and update summaries (`onboarding`)

- What it does: Get to know Cutex and see what's changed in each release.
- Shows up in: Settings page, Settings section
- Default: core, always on

### Get started (`start`)

- What it does: The first-run steps (connect a host, set up a Profile, send the first message), Try next, Customize your desktop and the sample project.
- Shows up in: Page, Settings section
- Default: core, always on
