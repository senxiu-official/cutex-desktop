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

> **Available from cutex 0.1.1** (Linux hosts, with the Job Service component). Tested against a
> real Gadi account on 2026-10-16: a finished job and a failed job were both tracked to their final
> state without a password or MFA prompt.
> 从 cutex 0.1.1 起可用（仅 Linux 主机，需要 Job Service 组件），已用真实 Gadi 账号测试通过。

For NCI Gadi users who want agents to submit PBS jobs and be told when they finish. cutex checks the
job with Gadi's own scheduler (`qstat`) over a dedicated SSH key that can do nothing else; PBS
notification mail is optional and only makes cutex check sooner. If you do not use Gadi, leave it
off. Full reference: `docs/NCI-REMOTE-JOBS.md` in the cutex repository.

### What you need

- **A Linux host.** The Job Service and the Gadi check exist only on Linux; a Windows or macOS host
  cannot run NCI jobs.
- **cutex with NCI support**: the desktop page says "this cutex has no support" otherwise; update
  cutex.
- **The Job Service component**: the page (or the Jobs page) offers **Install Job Service**; or run
  `cutex component install job-service` on the host.
- **Your Gadi username** and a project with SU.
- **Ordinary SSH access from the host to Gadi** for the agent that submits (`ssh <username>@gadi.nci.org.au
  qsub …` must work in the agent's shell, with your own key). The dedicated key below cannot submit.
- **Gadi's SSH host key fingerprints from NCI**, from NCI's user documentation or the NCI help desk,
  to check what `ssh-keyscan gadi.nci.org.au` prints.
- **Optional: a mailbox for PBS mail**: a dedicated mailbox with IMAP over TLS (port 993) and an app
  password (e.g. Gmail with 2-step verification). It must receive mail from `pbs.gadi@nci.org.au`
  directly, not forwarded (forwarding breaks the signature cutex checks). ANU / Microsoft 365
  mailboxes do not allow app-password IMAP and cannot be used. Without a mailbox cutex checks every
  6 hours by default (30 minutes at the shortest).

### Steps

1. Desktop: **Settings → Modules** → turn on **NCI remote jobs**. Then **Settings → Tools → NCI
   remote jobs**.
2. If the page asks for it, click **Install Job Service** and wait until it says it is ready.
3. **① Generate the key on the host.** Click **Generate key**. The private key stays in cutex on the
   host and is never shown.
4. **② On Gadi** (log in as usual: `ssh <username>@gadi.nci.org.au`):
   1. Run `echo $HOME` and type the result into the page (e.g. `/home/123/ab1234`).
   2. Copy the helper script from the page and save it on Gadi as `~/.cutex/nci-qstat-only.py`
      (`mkdir -p ~/.cutex`, then paste it into the file). Check it with `sha256sum
      ~/.cutex/nci-qstat-only.py` against the SHA-256 the page shows.
   3. Run `chmod 700 ~/.cutex ~/.cutex/nci-qstat-only.py`.
   4. Copy the `authorized_keys` line from the page and append it as one line:
      `nano ~/.ssh/authorized_keys` (or `cat >> ~/.ssh/authorized_keys`), then
      `chmod 600 ~/.ssh/authorized_keys`.
5. **③ Gadi host keys.** On any computer run `ssh-keyscan gadi.nci.org.au`, paste the output lines
   into the page, compare the fingerprints the page shows with NCI's published ones, and tick
   **Checked against NCI's official fingerprints** only if they match.
6. **④ Username.** Type your Gadi username and click **Save ③④**.
7. **⑤ Mailbox (optional).** Server (e.g. `imap.gmail.com`), port 993, login, app password; turn on
   **Receive mail** and **Receive NCI mail**. In the mailbox, add a "never send to spam" rule for
   `pbs.gadi@nci.org.au`. Skip this step if you do not want mail.
8. **⑥ Turn the check on.** With a mailbox, click **Test mailbox connection** first. Turn on **Gadi
   check** and pick the interval.
9. Ask a Codex agent to run a small Gadi job (the `nci-gadi` skill tells it how). It appears on the
   **Jobs** page with its PBS id; step ② turns green after the first successful check, and the agent
   gets one message when the job ends.

If something is wrong, the page shows the reason under ⑥ (for example "Gadi refused the key": check
the `authorized_keys` line; "Gadi presented a host key you did not pin": check the fingerprints
again). The private key and the mail password stay in cutex on the host and are never shown again.

To turn it off: **Delete check configuration** under ⑥ and delete the `cutex-qstat` line from Gadi's
`~/.ssh/authorized_keys`.
