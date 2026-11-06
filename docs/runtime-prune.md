# Runtime cleanup

Owner hosts advertising `runtime-prune-v1` show explicit cleanup in each runtime
group. The daemon supplies the candidate inventory and all safety decisions.
Desktop sends opaque candidate IDs through main/preload; the renderer never
accesses runtime files. Native, Claude, DSH and Kimi use the same action.

The inline confirmation lists the exact versions and their total logical size.
Cancel sends no mutation. The details offer individual deletion as well as bulk
cleanup. A host or plan change invalidates the confirmation; a POST is never
automatically retried. Deleted, refused and failed results are shown together,
then runtime/component inventories refresh. A missing rollback proof or failed
inspection is visible beside the disabled action. Older hosts keep the existing
list and have no cleanup controls. All supported locales and runtime mocks are
covered, including partial success and stale-host replies.

Client API additions are optional/additive; no Waveline protocol migration is
required. Backend integration and the mandatory kit protection exporter are
documented in cutex `docs/management/runtime-prune.md`.
