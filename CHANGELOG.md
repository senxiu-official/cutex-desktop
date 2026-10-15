# Changelog

## 0.1.0 "First Take" (2026-10-15)

The first public release of Cutex desktop. 第一个公开版本。

It needs a cutex daemon that has Management v2. Older daemons still work: features they lack show a
"needs upgrade" notice instead of failing.

- Persistent agents with live timelines. You can queue, steer, interrupt, fork and revert turns.
  Agents can delegate work to each other and ask you questions.
- Projects, and several hosts over SSH with automatic pairing. You can view all hosts at once.
  Users and devices let you share a host.
- Profiles for ChatGPT, Claude and OpenAI-compatible APIs, with quota and plan where the provider
  reports them.
- Usage and cost across all hosts, merged by Profile. Claude Code, Codex and ZCode usage
  directories can be added.
- Modules: files, diffs, terminal, artifacts, services, in-app browser, side chat, notes, bookmarks,
  alarms, workflows. Each can be turned off. Plugins are off by default.
- Self-updating portable installs on Windows, Linux and macOS (macOS as a front end only).
- Chinese and English UI, plus AI translations into other languages.
