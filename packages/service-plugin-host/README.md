# @cutex-desktop/service-plugin-host (experimental)

Private, source-only workspace package preserving Kutex's experimental authorization controller
and its regression suite. This is not a stable desktop module API or a daemon protocol. The desktop
app does not import it. Future changes belong in this workspace; the historical Kutex package is
reference material.

`createServicePluginHost({ services, supervisor })` manages explicit owner grants, approved ready
capability subsets, dependency gating and immediate revocation. It receives an injected supervisor;
it never launches processes, schedules restarts, reads credentials, stores jobs or runs PRH commands.
The supervisor owns process containment, lifecycle deadlines and bounded restart policies.

The returned controller is owner-only. A service receives only the closure-bound `ServiceChannel`
issued for its authenticated process occurrence. An occurrence string is not a bearer credential.
A production transport still needs authenticated private bootstrap and a reviewed ownership and
recovery protocol. No PRH adapter or service process fixture is included in this package.

Revocation, dependency loss, disable, replacement occurrence and disposal invalidate old channels
and guarded callbacks. `guardAsync` supplies a cooperative `AbortSignal` and suppresses values or
errors after authority is lost; already-started side effects cannot be rolled back. A reconstructed
controller starts disabled and ungranted and cannot adopt an old run implicitly.

```sh
pnpm --filter @cutex-desktop/service-plugin-host typecheck
pnpm --filter @cutex-desktop/service-plugin-host test
```

The 31 inherited tests use injected in-memory supervisors only. They cover readiness, dependency
withdrawal, stale occurrences, owner changes, malformed claims, synchronous reentrancy, async
revocation and reconstruction. No operational account, network connection or model is used.
