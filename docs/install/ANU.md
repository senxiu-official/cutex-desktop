# Optional modules: Claude Science and NCI remote jobs

Two optional modules, written up for ANU users but not limited to them:

- **Claude Science** is useful to anyone with a Claude Science account.
- **NCI remote jobs** is for users of NCI, Australia's National Computational Infrastructure
  (e.g. the Gadi supercomputer).

If neither applies to you, skip this page. Both modules are off by default and nothing else depends
on them.

Turn modules on in the desktop under **Settings → Modules** (zh-CN: 设置 → 模块). The switch applies
to the desktop on this computer; what each module needs runs on the **host**, the computer whose
cutex you are connected to (your own machine after [AGENT-INSTALL.md](AGENT-INSTALL.md)).

## Claude Science

Runs one or more Claude Science accounts side by side on the host. Each account is a cutex managed
service with its own directory and its own login, opened inside the desktop's browser.

Turn on, in this order:

1. **Browser**: Claude Science opens in the in-app browser. Without it the module says "Opening
   needs the Browser module".
2. **Claude Science**.

The host needs:

- **Linux.** cutex runs the account's service command with `sh`, so a Windows host does not work.
- A cutex with the `services` and `services-login-link` capabilities. Without them the Claude
  Science entry stays hidden in the sidebar; update cutex.
- The `claude-science` program installed on the host, by default at `~/.local/bin/claude-science`
  (each account can name another path). Install it the way Claude Science's own instructions
  describe; cutex only starts it (`claude-science serve`).

Then open **Claude Science** in the sidebar → **Add account**: a name, an ID, an account directory
on the host (at most 41 characters; created if missing) and optionally "Share ~/.ssh". Each account
signs in once, in its own directory, following the page's "First sign-in" steps. Do **not** sign in
with the login of a cutex Claude Profile: the two would keep invalidating each other's tokens.

## NCI remote jobs

Only for NCI Gadi users who want jobs that agents submit to Gadi (PBS) to show up on the Jobs page
and to notify the agent when they finish. The host learns about job ends from PBS's notification
mail, so you need a mailbox that receives that mail. If you do not use Gadi, or do not want inbound
mail, leave it off.

Turn on: **NCI remote jobs**. Its setup page appears under Settings → Tools → **NCI remote jobs**.

The host needs:

- **Linux.** The Job Service and cutex's inbound mail exist only on Linux hosts.
- A cutex with the `inbound-mail` capability (and `nci-verification` / `nci-host-keygen` for the
  key and check steps). Without them the page says this cutex has no support; update cutex.
- A Gadi account and its username.
- Gadi's SSH host keys, checked against the fingerprints NCI publishes in its user documentation
  (`ssh-keyscan gadi.nci.org.au` alone is not enough).
- A mailbox that receives PBS mail directly (not through forwarding, which breaks the signature
  cutex checks), reachable over IMAP with TLS, with an app password. Use a mailbox only for this,
  not your everyday one.

Follow the six steps on the page in order: ① generate a dedicated key on the host, ② on Gadi,
install the small helper script and the `authorized_keys` line the page gives you (the key can then
run only `qstat`), ③ Gadi host keys, ④ username, ⑤ mailbox, ⑥ test and turn on the check. The private
key and the mail password stay in cutex on the host and are never shown again.
