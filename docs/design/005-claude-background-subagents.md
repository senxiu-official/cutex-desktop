# Claude background tasks

Supporting hosts and Claude runtimes expose background task progress and stop controls. Completion or loss is delivered to the parent agent through a visible host-managed message. Background children cannot request owner approvals, ask questions or call cutex agent-management tools. Claude Code autonomous notification turns remain separate from host-managed turns and cannot use tools. Restart and model-setting changes can terminate background tasks; the host reports the loss.

See [Architecture](../DESIGN.md) and [Module contracts](../desktop-modules.md) for related interfaces.
