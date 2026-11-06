# Cutex Desktop architecture

Cutex Desktop is an Electron client for persistent coding agents managed by cutex.
The 0.2 release series is named **Beautiful World**; the 0.1 series is **First Take**.
Feature availability follows the capabilities advertised by each host and runtime.

## 1. Product scope

The desktop connects to local and remote hosts, displays conversations and host resources,
and submits explicit user actions. Windows and Linux support both the desktop and cutex
host services. macOS provides the desktop client connected to a supported host.

The client supports multiple hosts and separate users on a shared host. A host connection
has its own identity, device scope and user permissions. Access to a project or agent is
always enforced by the host.

## 2. Process architecture

```text
cutex daemon
  ├─ persistent sessions, projects and Profiles
  ├─ managed agent runtimes
  ├─ messages, delegations, approvals and alarms
  └─ Management v2 HTTP and event streams
                  │
         Electron main process
           ├─ host connections and credentials
           ├─ SSH tunnels and authenticated requests
           ├─ update verification and native dialogs
           └─ narrow preload IPC bridge
                  │
             React renderer
```

cutex owns business state and continues running when desktop windows close. Reconnecting
clients reload authoritative state and resume event reads. The desktop does not reproduce
host queue, delegation, lifecycle or permission logic in TypeScript.

On Linux, managed cutex installations use systemd user units. On Windows, they use the
cutex supervisor in a per-user Task Scheduler task. Persistent Runtime Host is a separate,
source-only project and is not a Cutex dependency.

## 3. Agents, projects and runtimes

An agent is one durable cutex session bound to one native thread. Forking creates a new
agent; reverting retains the agent identity. Formal names can change on supporting hosts
without changing session identity, and earlier names remain available for lookup.

Projects group agents around a workspace and can assign a Director and operators. Project
links and individual grants control which agents can communicate across project boundaries.
The host checks these permissions for every operation.

A Profile represents provider and credential configuration. Supported Profiles can expose
multiple runtime variants. Creating an agent selects a variant; later Profile edits do not
silently switch an existing agent to another runtime. Runtime upgrades use explicit selection
and preserve existing pins until the user upgrades them.

Codex agents use cute-codex. Claude agents use the optional Claude runtime component.
DSH and Kimi source adapters require separately installed upstream CLIs and their declared
dependencies. Component archives are immutable per identity and platform.

## 4. Workspace and navigation

A workspace groups conversation columns and their Shelves. A Shelf contains pages; pages
contain panes, and panes contain tabs. The Rail selects Shelf pages. The tray provides
pinned items and recent workspaces. Layout actions support placement previews and undo.

The sidebar lists agents by project, with active work separated from online idle and offline
agents. Independent agents and quick chats remain available beside project folders. Ordering
is configurable and can wait until the pointer leaves the roster. Remote lists populate
progressively. Cached lists are marked as synchronizing and are bound to the host identity
and access context. Archived agents load on demand, and hosts outside the active view poll
less frequently.

Device appearance and layout preferences remain separate from host business state. Optional
user-layout synchronization follows the host capability and user setting. It does not transfer
project ownership, credentials or local workspace contents.

## 5. Message and event authority

Message admission, delivery and settlement come from the host. A client request has a stable
identity. Queued, held, delivered, failed and uncertain states are displayed from authoritative
records. An uncertain result is not automatically resent as a new operation.

Timeline and Next up display the records assigned to each surface by the host contract.
Eligible notices can accompany a user message on supporting hosts while keeping their own
canonical identities. An approval permits a request; it is not proof that execution completed.

Conversation history and host catalogs are read incrementally. Attachment references avoid
repeating large image payloads where supported; older inline media remains readable. Streaming
Markdown aligns block geometry to the device-pixel grid at fractional display scales.

## 6. Host access and files

Local connections and SSH-forwarded remote connections use the same Management API.
Credentials remain in main. The renderer receives the data and methods required for its UI,
not host tokens or unrestricted network access.

Files, tree navigation, diffs and terminals use daemon APIs so remote hosts behave consistently.
The host validates workspace containment, permissions and symlink boundaries. The renderer does
not access the local filesystem or PTY directly as a fallback.

## 7. Browser and external content

Owner-created browser tabs and agent-created tabs use separate host-level browser partitions.
An explicitly granted owner tab retains its logins, and the grant interface states that access.
Granting a tab can permit account actions; it is not a read-only guarantee.

External browser traffic uses the main-controlled browser egress proxy and the external-page
setting. Admission is per tab and origin. Renderer sessions, plugins and artifact frames remain
network-locked. Host control ports are never browser targets. Main decides popups, downloads
and site permissions.

External code runs in opaque sandboxed frames with `allow-scripts` and without
`allow-same-origin`, preload, Node or credentials. Artifact pages have no network access,
including loopback. The fixed page bridge supports only per-artifact storage, submission to
the page's agent after native confirmation, and user-gesture clipboard copy. Main validates
frame identity and request schemas. Storage is 5 MB per artifact with a 200 MB soft aggregate
limit and no automatic eviction.

## 8. Modules and contracts

The module registry supplies slots, lifecycle, settings and capability gates. The SDK and host
packages contain the source-exported module contract and lifecycle only; they do not contain
React, Electron, daemon protocol logic or another module engine. External plugin execution uses
the opaque-frame sandbox.

Contract revisions include versioned declarations and slot snapshots. Protocol types are
generated from the native app-server schema. See [Desktop modules](desktop-modules.md),
[Module development](module-dev-guide.md) and the [design references](design/README.md).

## 9. Persistence, compatibility and updates

cutex uses SQLite for migrated mutable business stores, JSONL for suitable append-only logs and
JSON for small configuration. Each store has one authoritative representation. Retained import
files can be stale after migration. API input is strict; persisted records preserve forward
compatibility as specified by their store contract.

The desktop detects capabilities per host and retains supported behavior on older hosts.
Desktop and backend versions advance independently and are updated separately. Signed release
metadata identifies migration boundaries; one-way migrations require explicit confirmation and
an offline backup.

Release packages are built by project Actions pipelines and verified with the embedded minisign
release keys. Updates verify signatures and hashes before installation. Existing runtime pins
are not silently reassigned by a desktop update.

## 10. Documentation

- [UI terminology](GLOSSARY.md)
- [Install and update](install/AGENT-INSTALL.md)
- [Quick start](QUICKSTART.md)
- [Known issues](KNOWN-ISSUES.md)
- [Changelog](../CHANGELOG.md)
- [Security policy](../SECURITY.md)
- [Module contract](desktop-modules.md)

Third-party source attribution and license terms are maintained in the repository LICENSE,
NOTICE and LICENSES files.
