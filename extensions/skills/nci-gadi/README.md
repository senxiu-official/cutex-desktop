# nci-gadi skill pack

An agent skill that teaches cutex agents to submit PBS Pro jobs on NCI Gadi and have cutex's Job
Service track them (`prepare_remote` → `qsub` with `pbsArgs` → `register_remote`). The skill
itself is [`SKILL.md`](SKILL.md) (standard `SKILL.md` format with YAML frontmatter, readable by
Codex and Claude Code).

This directory is a temporary home: the pack is meant to move to a separate skills / plugins
repository later. Nothing in the desktop app imports or installs it.

## Requirements

- A cutex host whose Job Service runs with the `nci` external source enabled
  (`--external-source nci`); otherwise the agent has no `prepare_remote` / `register_remote`
  tools on its `cutex_job` MCP server.
- For automatic tracking: the desktop's 「NCI 远程作业」 module set up on that host — the
  qstat check (a dedicated, `qstat`-only SSH key for Gadi; Settings → 工具 → NCI 远程作业, steps
  ①–④ and ⑥) and, optionally, the PBS mailbox (step ⑤; also the address `prepare_remote` puts in
  `-M`). The qstat check alone completes jobs (at its interval, default 6 h); mail only makes it
  look sooner and never completes a job by itself. Without a mailbox, agents get
  `mailNotConfigured` and relay the owner hint. Without the qstat check, the owner marks results
  manually on the 作业 page.
- The agent needs some way to run `qsub` on Gadi (its own shell there, or the owner runs it).

## Installing it for an agent

cutex has **no install command or UI for skills yet**. Copy the `nci-gadi/` directory (both files)
into a directory the agent's runtime already scans. Running agents pick new skills up on a new
thread / relaunch, not mid-conversation.

### Codex agents (cute-codex) under cutex

Codex loads skills from `$CODEX_HOME/skills/<name>/SKILL.md` (deprecated location, still read),
`~/.agents/skills/<name>/` and repo-level `.agents/skills/<name>/` between the project root and
the cwd (`codex-rs/ext/skills/src/host_roots.rs`).

Each cutex-managed Codex agent has its own `CODEX_HOME` at
`~/.cutex/runtime/light/agents/<native_id>/`. Its `skills/` is a link to the shared home's
`~/.cutex/codex-home/skills`, created **only if that directory existed when the agent was
materialized** (`src/launch/local_deployment.rs`). So:

- Easiest, one project: put it in the agent's working directory,
  `<cwd>/.agents/skills/nci-gadi/`.
- All Codex agents on the host: `~/.cutex/codex-home/skills/nci-gadi/`. Agents created before
  `~/.cutex/codex-home/skills` existed have no link; for those copy into
  `~/.cutex/runtime/light/agents/<native_id>/skills/nci-gadi/` instead.
- Plain Codex outside cutex: `~/.codex/skills/nci-gadi/` (or `$CODEX_HOME/skills/`).

### Claude agents under cutex

cutex's Claude adapter does not read `~/.claude/skills` (it starts Claude Code without user
settings or plugins). Adapters that declare the `managedSkills` feature get these roots instead
(`src/runtime/claude/structure.rs`, `managed_skill_roots`):

- `<cwd>/.agents/skills/nci-gadi/` or `<cwd>/.claude/skills/nci-gadi/` (one project), or
- `<claude account home>/cutex-skills/nci-gadi/` (every session on that Claude account; the
  account's Claude config dir, e.g. `~/.cutex-claude-compatible/.claude/cutex-skills/`).

Plain Claude Code outside cutex: `~/.claude/skills/nci-gadi/SKILL.md`.

### Example

```bash
mkdir -p <cwd>/.agents/skills
cp -r extensions/skills/nci-gadi <cwd>/.agents/skills/
```

`<cwd>/.agents/skills/` works for both Codex and (managedSkills-capable) Claude agents in that
project.
