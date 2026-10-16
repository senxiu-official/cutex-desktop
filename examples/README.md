# Desktop plugin examples

These packages are development examples. They are not part of the desktop packages and nothing is
installed by default; the desktop has no plugin installer, so you copy them by hand (below). Desktop plugins are separate from daemon-managed Agent plugins.

To try them in an isolated desktop profile:

1. Set `CUTEX_DESKTOP_USER_DATA` to a dedicated directory when starting the desktop.
2. Physically copy the desired complete directory from `examples/plugins/` to `<userData>/plugins/<id>/`. For example, `<userData>/plugins/desk-note/manifest.json` must sit beside its `index.html`, `main.js`, and `style.css`. Directory and manifest IDs must match. Symlinks and hard-linked assets are rejected.
3. In Settings → Modules, enable **Desktop plugins**. This module is off by default; enabling it does not grant plugin permissions.
4. Open **Desktop plugins** in the sidebar, review the requested permissions, select only those you want, and choose **Grant and enable**. `views` permits the isolated page; `entries` also shows its navigation entry. Use **Revoke all permissions** to withdraw the page and its frames.

`desk-note` stores a note through the plugin's own `settings` namespace. Select **Show isolated plugin pages**, **Show navigation entries**, and **Read and save this plugin's own settings** to use the complete example.

`nci-board` displays explicitly fake jobs. It submits no jobs or model requests and cannot control a scheduler. Its optional Agent list receives only identifiers, names, and status from the current host; opening a conversation requires both `agents.read` (to list that Agent first) and `agents.open`.

Plugin code runs in an opaque sandbox frame. The supported RPC methods are `agents.list`, `agents.open`, `settings.get`, and `settings.set`; permissions are enforced for every call. Settings stay local to the device and plugin. Replacing manifest or asset bytes invalidates prior consent after catalog refresh; review permissions again. Unchecking a plugin in Modules keeps its preferences while stopping it.
