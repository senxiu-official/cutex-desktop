# Thread launch options: cute-codex inventory vs. cutex plumbing

> **Public repository note.** This is a maintainers' design record, kept as written during
> development. It cites internal notes and working checkouts that are not published with this
> repository (`docs/research/…`, `docs/reviews/…`, `docs/handoff/…`, `TODO.md`, `PROGRESS.md`,
> `PLAN.md`, `upstream/…`, `refs/…`, `.claude/…`); those references are history, not links.
> "The owner" is the project's maintainer. The current behaviour is in the code, `README.md`,
> `docs/install/AGENT-INSTALL.md` and the cutex repository's `docs/`.

Status 2026-10-06. Sources: `upstream/cute-codex` (`feat/desktop-slim`, ~v0.160) and `upstream/cutex`
(`feat/desktop-api` + `feat/quick-chat`). This file lists what can be set when a native thread starts,
and what cutex passes through when it creates or launches an agent or quick chat.

Permission audit, 2026-10-11 (internal note `docs/research/permissions-gpt-20261011.md`, not published).
The reviewer row and gap below reflect that audit; other inventory rows retain their dated scope.

## How cutex launches a thread

1. **Create**: `light_new::create_native` spawns a short-lived native app-server with
   `-c model=… -c model_provider=… -c approval_policy=… -c sandbox_mode=… -c model_reasoning_effort=…`
   plus `-c default_permissions=<profile>`. It then calls `thread/start {cwd, approvalPolicy, ephemeral:false,
   historyMode:"paginated"}` and adopts the saved thread. Adoption writes the session record.
2. **Run** (stock runtime, `stock_lifecycle::spawn`): the same `-c` args are recomputed from the **session
   record** each launch (`launch::stock::current_configuration`). The runtime then resumes with
   `thread/resume {model, modelProvider, cwd, approvalPolicy, [sandbox on legacy bundles], [permissions]}`.
3. Native `thread/settings/updated` notifications flow back into the record: cwd, model, effort,
   approvalPolicy and the active permission profile.

The session record is the source of truth for relaunches. These fields matter:

| Record field | Meaning |
|---|---|
| `profile` | Profile to use |
| `model_defaults` | Model |
| `reasoning_defaults` | Reasoning effort |
| `sandbox_mode` and `permission_defaults` | Sandbox mode, written as an alias pair |
| `approval_policy` | Approval policy |
| `sandbox_network_access` | New |
| `sandbox_writable_roots` | New |
| `managed_cwd` / `cwd` | Working directory |

## Inventory

**Legend**
- ✅ cutex plumbs it at create and launch.
- 🆕 Added in `feat/quick-chat`.
- ⚠️ Partial.
- ❌ Not plumbed; native default or the profile's `config.toml` applies.

The three middle columns show where the native side accepts the option.

| Option | Native: CLI | Native: app-server v2 | Native: config.toml | cutex |
|---|---|---|---|---|
| Model | `-m` | `thread/start.model`, `turn/start.model`, `thread/settings/update` | `model` | ✅ Per profile (`new_session_defaults.<profile>.model`) or per create (🆕 `launch.model`). Record `model_defaults`. |
| Model provider | `--oss`, `--local-provider` | `modelProvider` | `model_provider`, `model_providers` | ✅ Derived from the profile, never per thread |
| Reasoning effort | — | `config.model_reasoning_effort` at start; `turn/start.effort`, `thread/settings/update.effort` | `model_reasoning_effort` (`none…max/ultra/persistent`) | ✅ Per profile or per create (🆕 `launch.reasoningEffort`). Record `reasoning_defaults`. |
| Reasoning summary | — | `turn/start.summary`, `thread/settings/update.summary`, `config.model_reasoning_summary` | `model_reasoning_summary` (`auto/concise/detailed/none`) | ❌ Profile `config.toml` only |
| Verbosity | — | `config.model_verbosity` | `model_verbosity` (`low/medium/high`) | ❌ Profile only |
| Sandbox mode | `-s read-only\|workspace-write\|danger-full-access` | `thread/start.sandbox` (mode enum only); `turn/start.sandboxPolicy` (full policy) | `sandbox_mode` | ✅ Record `sandbox_mode`, emitted as `-c sandbox_mode` and `-c default_permissions`. 🆕 Per-kind defaults and per-create override. |
| Permission profile | `-c default_permissions=…` (no dedicated flag) | `thread/start.permissions` (experimental; can't be combined with `sandbox`) | `default_permissions` (`:read-only`, `:workspace`, `:danger-full-access`, or a named profile); `[permissions.<name>]` (`extends`, `workspace_roots`, `filesystem`, `network`) | ✅ Built-in id from the sandbox mode. 🆕 `cutex-workspace` profile when extras are set (see below). |
| Network access (workspace-write) | — | `sandboxPolicy.networkAccess` (turn / settings); `config["sandbox_workspace_write.network_access"]` | `[sandbox_workspace_write] network_access`; profile `network.enabled` | 🆕 Record `sandbox_network_access`. Per-kind default plus override. Desktop 「自动」 sets it on at every entry point (new-agent page, pending quick chat, running switch; `LAUNCH_FOR_MODE` / `permissionPatch`, 2026-10-16); the toggle can turn it off afterwards. A running change is mirrored back from `thread/settings/updated` (cutex `app_server_state_sync.rs`), so resume keeps it. |
| Extra writable roots | `--add-dir DIR` | `sandboxPolicy.writableRoots`, `runtimeWorkspaceRoots` (experimental), `config["sandbox_workspace_write.writable_roots"]` | `[sandbox_workspace_write] writable_roots`; profile `workspace_roots` | 🆕 Record `sandbox_writable_roots`. Per-kind default plus override. Project memory dirs are added separately as runtime workspace roots (existing). |
| `exclude_tmpdir_env_var`, `exclude_slash_tmp` | — | `sandboxPolicy.excludeTmpdirEnvVar` / `excludeSlashTmp` | `[sandbox_workspace_write]` | ❌ Native default false |
| Approval policy | `-a on-request\|never` (TUI); `codex exec` forces `never` | `approvalPolicy`: `untrusted\|on-request\|never\|{granular:{…}}` | `approval_policy` (`on-failure` is a deprecated alias of `on-request`; `untrusted` in config is rejected by the loader) | ✅ Record `approval_policy`. 🆕 Per-kind default plus override. cutex accepts **`never` and `on-request` only**. |
| Granular approval | — | `{granular:{sandbox_approval, rules, skill_approval?, request_permissions?, mcp_elicitations}}` | `approval_policy = {granular = …}` | ❌ |
| Approvals reviewer (auto review) | `--approve-for-me` / `--not-so-yolo` | `approvalsReviewer: user\|auto_review` | `approvals_reviewer`, `[auto_review]` | ✅ (cutex `launch-approvals-reviewer`, 2026-10-16) Record `approvals_reviewer`, sent on thread start / resume and as `-c approvals_reviewer` for owner launches; mirrored from `thread/settings/updated`. Per-kind default (built-in `auto_review`) plus `launch.approvalsReviewer`. Desktop 「自动」 = workspace-write + on-request + `auto_review`, 只读 = on-request + `user`; a workspace on-request thread reviewed by `user` shows as 自定义. On an older cutex the desktop leaves the field out of `launch` and sets it with `thread/settings/update` once the new thread runs. |
| Bypass everything | `--yolo` | — | — | Equivalent to danger-full-access plus never (the agent default) |
| Web search | `--search` (TUI) | `config.web_search` | `web_search = disabled\|cached\|indexed\|live`, `[tools] web_search` | ❌ Profile or shared config only |
| Service tier | — | `serviceTier` (thread), `serviceTierForTurn` | `service_tier` (`default/priority/flex`) | ❌ |
| Base instructions | — | `baseInstructions` | `instructions`, `model_instructions_file` | ❌ |
| Developer instructions | — | `developerInstructions` | `developer_instructions` | ⚠️ Project memory and file-reference augmentation only (`memory::attach_launch_augmentation_*`); no user field |
| Personality | — | `personality` (deprecated) | `personality` (`none/friendly/pragmatic`) | ❌ |
| Collaboration mode (plan / default) | — | `turn/start.collaborationMode`, `thread/settings/update.collaborationMode` (experimental) | `plan_mode_reasoning_effort` | ❌ Per-turn concept; would belong to the composer, not creation |
| cwd | `-C` | `cwd` | — | ✅ Exact cwd; quick chats get a scratch dir when none is given (🆕) |
| Images on first prompt | `-i` | Turn input items | — | Composer concern, not launch |
| Dynamic tools | — | `thread/start.dynamicTools` (experimental) | — | ❌ (cutex uses MCP: `mcp_servers.cutex`, scoped MCP) |
| MCP servers | — | `config` | `mcp_servers` | ✅ cutex facade plus scoped MCP injection. The cutex facade is disabled for owned sessions. |
| Ephemeral / history mode | `codex exec --ephemeral` | `ephemeral`, `historyMode` | — | ✅ Always persistent, `paginated` |
| Profile overlay | `-p NAME` (profile v2 = `$CODEX_HOME/<name>.config.toml`) | — | Legacy `[profiles.*]` is inert | N/A: cutex profiles materialize their own `config.toml` and auth |
| Arbitrary overrides | `-c key=value` | `config` map (merged after process `-c`) | — | ❌ Stock launches reject durable arbitrary CLI args (`default_cli_args` must be empty) |
| Project trust | — | — | `[projects."<path>"] trust_level` | ❌ Explicit sandbox and approval make trust irrelevant for defaults |
| Fork-specific | `--auth-file`; app-server `--external-input-binding-file` | — | — | ✅ Used internally (profile auth projection, ExternalInput) |

### Gaps that remain (not plumbed by cutex)

- Reasoning summary, verbosity, service tier, web search mode, personality, base/developer instructions.
  These come from the profile's materialized `config.toml` or the shared native config.
- Granular approval and `untrusted`. Auto review (`approvalsReviewer`) is partially plumbed;
  creation/defaults, durable sync, effective capability discovery and desktop selection remain incomplete.
- `exclude_tmpdir_env_var` / `exclude_slash_tmp`.
- Per-turn options (collaboration mode, per-turn effort and summary). The desktop can send these on
  `turn/start` / `thread/settings/update` through the native request bridge.

## Permission semantics (important details)

- Explicitly selecting the built-in `:workspace` profile **ignores** the legacy `[sandbox_workspace_write]`
  table (`core/src/config/mod.rs` ~3654).
  - So when a workspace-write thread needs network access or extra roots, cutex defines its own profile
    with `-c permissions.cutex-workspace={extends=":workspace", network={enabled=…}, workspace_roots={"<root>"=true}}`
    and selects it with `-c default_permissions="cutex-workspace"`.
  - On resume the runtime passes `permissions:"cutex-workspace"` explicitly, because a valid persisted
    thread profile otherwise wins over the `-c` default.
  - Without extras, cutex uses the built-in ids (`:workspace`, `:read-only`, `:danger-full-access`) exactly as before.
- Older (non profile-mode) bundles get the legacy `-c sandbox_workspace_write={network_access, writable_roots}`.
  The generic app-server runtime path (`app_server::runtime`) uses `sandbox` plus `config.sandbox_workspace_write`.
- Native settings sync maps the active profile `cutex-workspace` back to `permission_defaults=":workspace"`.
  The extras stay in their own record fields.
- On Windows, workspace-write and read-only use the native's unelevated restricted-token sandbox: the
  executor upgrades `Disabled` to `RestrictedToken` for Windows paths, so no UAC is needed. cutex never sets
  `windows.sandbox="elevated"`, which needs a one-time admin setup.
- Smoke-verified on the dev daemon: a quick chat with `networkAccess:true, writableRoots:[…]` reported
  `activePermissionProfile {id:"cutex-workspace", extends:":workspace"}` and
  `sandboxPolicy {type:workspaceWrite, networkAccess:true, writableRoots:[…]}`, both at first start and
  after offline→online. A default quick chat reports `:workspace` with `approvalPolicy:"on-request"`.

## New-thread defaults (cutex config)

`config.json` → `new_thread_defaults`. Every field is optional; an absent field uses the built-in default.

```json
"new_thread_defaults": {
  "agent":      { "sandbox": "danger-full-access", "approval": "never" },
  "quick_chat": { "sandbox": "workspace-write", "approval": "on-request",
                  "network_access": false, "writable_roots": [] }
}
```

Built-in defaults:

| Kind | Built-in default |
|---|---|
| Agents | danger-full-access + never (unchanged historical behaviour) |
| Quick chats | workspace-write (writes confined to the chat's cwd, no network) + on-request (the model asks before running anything outside the sandbox) |

- `on-request` is the closest safe equivalent of "ask first". `untrusted` cannot be launched: the native
  config loader rejects it.
- Model and effort stay per profile (`new_session_defaults`).
- Defaults are resolved **at creation** and persisted on the record, so later edits do not change existing threads.
- They apply to `cutex human new` / TUI agent creation / `POST /v2/human/agents` (agent) and to
  `cutex new` / TUI New session / `POST /v2/human/sessions` (quick chat).

Management: `GET|PATCH /v2/settings` field `newThreadDefaults` (feature `new-thread-defaults`). See the
cutex `src/management/v2/settings_api.rs`.
