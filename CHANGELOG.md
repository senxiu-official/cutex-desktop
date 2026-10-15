# Changelog

## 0.1.1 (2026-10-16)

The first release with downloadable, signed desktop packages. 第一个提供签名安装包的桌面端版本。

- One-click updates for installs from the release packages (Linux, Windows, macOS): the app checks
  the latest GitHub release, downloads it, verifies its minisign signature and SHA-256 inside the
  app, then switches and restarts. 发布包安装的桌面端可以在应用里一键更新。
- Updates use the computer's proxy settings, like Chrome (proxies that ask for a user name and
  password are not supported yet). 更新走系统代理设置。
- Profiles: change a profile's default model (and reasoning effort) right on the overview card,
  Claude profiles included (needs a cutex with `claude-profile-default-model`).
- Settings → 更新与诊断: links to the three repositories.
- Install guide: section B installs from the signed release binaries; the Claude Science and NCI
  modules are documented for everyone who can use them, not only ANU.

0.1.0 had no desktop packages: install 0.1.1 from the release page or build from source.

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
