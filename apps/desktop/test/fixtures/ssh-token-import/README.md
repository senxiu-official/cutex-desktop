# Private token-import integration check

`serve.py` starts two **debug** cutex daemons and their buses in distinct marked private homes, listening only on free loopback ports 24650–24699 / 24750–24799. Both have two empty projects; the test user sees only `ema-project`. No provider login or model call is needed. The script refuses an existing root and removes its secret fixture on shutdown.

Start it as a background process, with a fresh root under the current user's profile and an absolute path to a debug cutex binary:

```text
python apps/desktop/test/fixtures/ssh-token-import/serve.py --root <private-root> --cutex <debug-cutex>
```

Once its log says `READY`, set `CUTEX_TOKEN_IMPORT_FIXTURE=<private-root>/fixture.json`, set TEMP/TMP to your own scratch directory, and run from `apps/desktop`:

```text
pnpm exec vitest run test/sshTokenImport.test.ts
```

The gated case runs the real HostManager import and DaemonService sidebar through a loopback TCP forwarding stub, with SSH remote commands forbidden. It checks the other daemon's owner view contains both projects, and the imported member connection contains exactly the granted project. All other cases run without daemons, testing reflected-secret errors, encrypted persistence, rotation, identity mismatch, forwarding denial and forgetting credentials.

Create `<private-root>/STOP` afterward. The fixture server terminates only its owned process handles and unlinks `fixture.json` in `finally`; it also stops after 20 minutes. Never print that fixture or copy its private tokens into a report. The default full vitest run skips the gated integration case.
