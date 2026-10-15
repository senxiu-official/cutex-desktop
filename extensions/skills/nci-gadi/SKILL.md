---
name: nci-gadi
description: Submit and track PBS Pro batch jobs on NCI Gadi through cutex. Use when you are about to run qsub on Gadi (gadi.nci.org.au), need the qsub flags for a Gadi job, want cutex to report the job's completion back to you, or must explain a failed / killed Gadi job to the owner.
---

# NCI Gadi PBS jobs through cutex

cutex tracks Gadi jobs for you: you **prepare** a registration, **submit** with the
arguments cutex gives you, then **register** the PBS job id. cutex then follows the job
(NCI's PBS mail as a trigger, plus a slow periodic `qstat` verification) and delivers one
completion message to you when the job ends. You do not poll.

The tools come from the cutex Job Service MCP server (`cutex_job`). They only appear when the
owner enabled the `nci` source; if `prepare_remote` / `register_remote` are not in your tool
list, tell the owner and stop — do not invent a tracking scheme.

Submitting a job uses the owner's NCI allocation (SU). Only submit when the owner asked for it
or clearly authorized it.

## 1. Prepare

Call `prepare_remote` with `{"source": "nci"}`. It submits nothing. The receipt contains:

| Field | Meaning |
| --- | --- |
| `correlationToken` | 32 hex characters. Keep it; needed for `register_remote`. |
| `suggestedJobName` | `cx<correlationToken>` (34 characters). |
| `pbsArgs` | Complete qsub arguments: `-N <suggestedJobName> -m abe`, plus `-M <owner mailbox>` when configured. |
| `notificationStatus` | `configured`, `mailNotConfigured` or `mailConfigUnreadable`. |
| `notificationAddress` | The owner's mailbox or null. Informational only. |
| `ownerAction` | Plain-language text for the owner when there is no usable mailbox. |
| `expiresAt` | Unix seconds; the preparation expires after 24 h. Register before then. |

(`submissionArguments` and `notificationDestinationRequired` are older fields; use `pbsArgs`.)

Rules:

- Pass `pbsArgs` **verbatim** on the qsub command line, as separate arguments, in order.
- Do not rename the job. The job name must stay exactly as in `pbsArgs`; the `cx<token>`
  marker is how cutex matches mail and qstat results to your job. Never truncate it.
- Do not put `#PBS -N`, `#PBS -m` or `#PBS -M` in the job script.
- Never add, change or ask for a `-M` address. Never ask the owner for their email.
- If `notificationStatus` is not `configured`: relay the `ownerAction` text to the owner, and
  still submit with `pbsArgs` when the job is authorized. The job is then not tracked by mail;
  the owner checks it and marks the result manually (or cutex's periodic qstat check catches it,
  if the owner set that up).
- One preparation per job. Prepare again for each new qsub (limit: 16 open preparations).

## 2. Submit

On Gadi (however you reach it: your shell there, or a command the owner runs):

```bash
qsub <pbsArgs...> -P <project> -q normal \
     -l ncpus=48,mem=190GB,walltime=02:00:00,jobfs=100GB \
     -l storage=gdata/<project>+scratch/<project> \
     -l wd \
     job.pbs
```

Resource requests can also live in the script as `#PBS -P …`, `#PBS -l …` lines; only name and
mail must come from `pbsArgs`.

Common flags:

- `-P <project>` — the NCI project code that is charged.
- `-q <queue>` — `normal`, `express` (higher priority, higher SU charge rate), `hugemem` (large-memory
  nodes), `gpuvolta` (V100 GPUs), `copyq` (data transfer; the queue with external network access — check with NCI docs). Other
  queues exist (e.g. `normalbw`, `normalsr`, `dgxa100`; check with NCI docs). Each queue has its
  own per-node core / memory limits and maximum walltime (check with NCI docs).
- `-l ncpus=N,mem=XGB,walltime=HH:MM:SS` — required. On `normal`, jobs larger than one node
  should request whole nodes (multiples of 48 cores; check with NCI docs).
- `-l jobfs=XGB` — node-local scratch (`$PBS_JOBFS`), deleted at job end.
- `-l storage=gdata/<proj>+scratch/<proj>` — every `/g/data/<proj>` and `/scratch/<proj>` the
  job touches must be listed, or the path is not mounted inside the job.
- `-l wd` — start in the submission directory instead of `$HOME`.
- `gpuvolta`: `-l ngpus=G` with `ncpus` = 12 per GPU (e.g. `ngpus=1,ncpus=12`); GPU counts
  above one node's 4 GPUs go in whole nodes (check with NCI docs).

qsub prints the PBS id, e.g. `12345678.gadi-pbs`. A qsub error means nothing was submitted:
report the error text to the owner; the preparation can be reused for the retry.

## 3. Register

Immediately after qsub succeeds, call `register_remote`:

```json
{
  "source": "nci",
  "correlationToken": "<correlationToken from step 1>",
  "remoteId": "12345678.gadi-pbs",
  "remoteName": "<suggestedJobName>",
  "project": "<project>",
  "queue": "normal",
  "remoteOutputPath": "/scratch/<project>/<user>/run1"
}
```

- Required: `source`, `correlationToken`, `remoteId` (exactly as qsub printed it; digits or
  digits + `.gadi-pbs`).
- Optional: `remoteName` (must end with `cx<correlationToken>`), `project`, `queue`,
  `remoteOutputPath` (absolute path, characters `A-Za-z0-9/._-` only; a reference for the
  owner, cutex does not read it).
- Retrying the identical call is safe and returns the same job. Changing fields fails.
- The returned job is `registered`; it moves to `queued` / `running` / final when cutex
  verifies it.

## 4. Wait

- Do **not** poll `qstat` in a loop, `sleep` / `watch` until the job finishes, or keep a turn
  open waiting. cutex delivers the completion as a new message after your current turn.
- `query` on the Job Service is a one-off diagnostic, not a polling tool.
- A single `qstat <id>` (or `qstat -xf <id>` for a finished job) is fine when the owner asks
  for the current status.
- A completion says `exited` (exit code 0) or `failed` with a reason (`nonzero_exit`,
  `walltime_exceeded`, `aborted`) or `cancelled`. Scheduler success does not prove the results
  are correct: check the outputs before telling the owner it worked.
- A job with no news for 24 h is marked stale. That is not a failure; it may just be queued.

## 5. Explaining failures to the owner

Read the job's PBS output files first: `<jobname>.o<number>` and `<jobname>.e<number>` in the
submission directory (with `-l wd`), unless `-o` / `-e` say otherwise. The `.o` file ends with
NCI's resource usage summary (requested vs used CPU, memory, walltime, jobfs, SU).

| Symptom | Likely cause | What to tell the owner |
| --- | --- | --- |
| `walltime_exceeded`, `Exit_status = -29`, `.e` says the job exceeded its walltime | Walltime too short | Request more walltime, or checkpoint / split the job (respect the queue maximum). |
| Job killed, `.e` mentions memory limit / OOM, usage summary shows memory at the limit | `mem` too small | Raise `-l mem=` (or move to `hugemem`); note memory used vs requested. |
| Exit status 271 (= 256 + SIGTERM) | Job was deleted (`qdel`) or terminated | Ask whether someone cancelled it; otherwise look at `.e`. |
| Other positive exit status | The program itself failed | Quote the relevant `.e` lines. |
| `No such file or directory` for `/g/data/...` or `/scratch/...` | Storage not requested | Add `-l storage=gdata/<proj>+scratch/<proj>` for every project path used. |
| qsub refused: project has no / insufficient allocation | Project out of SU | `nci_account -P <proj>` shows the balance; the owner must pick another project or ask the project lead. |
| qsub refused with a queue / resource limit message | Request exceeds the queue's limits | Quote the message; fit `ncpus` / `mem` / `walltime` to the queue limits (check with NCI docs). |
| `jobfs` errors / disk full in `$PBS_JOBFS` | `jobfs` too small | Raise `-l jobfs=`. |

Keep reports factual: quote the exit status and the relevant output lines, state what you would
change, and do not resubmit without the owner's go-ahead.
