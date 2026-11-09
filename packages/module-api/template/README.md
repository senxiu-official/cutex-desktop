# my-module

A Cutex desktop module: a button in the tray that opens a page counting how many times you pressed it.

```sh
npm install
npm run build     # type-checks, then builds into dist/
npm run dev       # builds again whenever a source changes
npm run pack      # writes dist/my-module-0.1.0.tar.gz
```

To see it in the app, use Settings → Modules → "Turn on developer mode…", then "Load from folder…" on this folder. To give it to someone, send them the `.tar.gz`; they install it from the same page.

`docs/module-authoring.md` in the Cutex desktop repository describes everything a module can do.
