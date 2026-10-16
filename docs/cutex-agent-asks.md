# cutex agent asks, child agents and approvals — design

> **Public repository note.** This is a maintainers' design record, kept as written during
> development. It cites internal notes and working checkouts that are not published with this
> repository (`docs/research/…`, `docs/reviews/…`, `docs/handoff/…`, `TODO.md`, `PROGRESS.md`,
> `PLAN.md`, `upstream/…`, `refs/…`, `.claude/…`); those references are history, not links.
> "The owner" is the project's maintainer. The current behaviour is in the code, `README.md`,
> `docs/install/AGENT-INSTALL.md` and the cutex repository's `docs/`.

Status: **proposed, revised after review** (2026-10-07). The decisions in §2 are owner-approved. The
Fable 5.1 and Astra reviews are consolidated (§14); the contract changes they asked for are written
in. §13 marks each remaining default as *adopted (review)* or *decided (owner)*.

Scope: cutex (daemon, agent-facing tools, Management v2), cute-codex (the few native hooks in
§12.2), claude-adapter, and the desktop. This design **replaces the Task Service and the current
agent-facing cutex tools**. The owner authorized a full refactor on 2026-10-07.

Builds on `feat/tool-security`, now merged into `upstream/cutex` `feat/desktop-api` (78ce754). Its
design note, `upstream/cutex/docs/agent-tool-security.md` (cited below as **TS §n**), is the source
of truth for what already exists: per-agent bus credentials, the project boundary
(`AgentBoundary::may_interact`, `isolated|host` + owner links), the role → tool table
(`CUTEX_TOOL_RULES`), child ⊆ creator (`clamp_or_refuse`), the owner approval store
(`ApprovalStore::gate`, `/v2/approvals`) and the managed-service approval gate. This document does
not re-specify those; it says how asks use them and what they still lack.

Related documents:
- `docs/research/cutex-tools-review.md`: the findings S1–S5, C1–C7 and U1–U4 referenced below.
- `docs/DESIGN.md`: §3.1 projects, §4.11 MCP layering, §4.16 native subagents, §4.18 tasks page.
- `docs/reviews/cutex-agent-asks/`: the reviews summarised in §14.

---

## 1. Why

cutex agents exist for two things native Codex subagents can't do:

- **Work across providers and models.** Different models are good at different things, and models
  with different biases catch different mistakes when they review each other. A native subagent
  runs in the same app-server as its parent, with the same login and provider.
- **Direct interaction with the owner.** The owner opens a cutex agent, talks to it, steers it and
  approves for it. cute-codex rejects direct user input to native subagents (DESIGN §4.16).

With long-context models, an agent that persists and accumulates project knowledge is an asset, not
overhead.

Working *with* cutex agents is still much clumsier than working with subagents. The convenience of
subagents comes from a handful of mechanisms, and none of them depends on being short-lived:

| Mechanism | Native subagents (cute-codex 0.160, multi-agent v2) | cutex agents today |
|---|---|---|
| The result comes back | The child's final answer is delivered to the parent automatically, as a queue-only message (it does not start a parent turn). | The recipient must call `send`, and models forget or reply in the wrong place. |
| Waiting inside a turn | `wait_agent` / mailbox `wait`, owned by core, which also ends early on a user steer | None. A reply arrives later as an `external_event`. |
| Work vs note | `followup_task` (starts a turn if idle, otherwise mailbox) vs `send_message` (no turn) | A single `send` for both. |
| Ownership | A tree with canonical task names (`/root/task1/task_3`); the parent interrupts and closes children | Flat groups; only the Director manages agents. |
| One step | `spawn_agent(task_name, message, model?, reasoning_effort?, fork_turns)` | A Director-only create, then a separate send. |
| Context | `fork_turns` none / all | Session fork (same provider only; added in r196). |
| Approvals | At spawn, a child copies the parent's live approval policy, sandbox and `approvals_reviewer`. Approvals go to the user or to the Guardian, never to the parent. | All cutex tools were auto-approved (S2); TS §7 adds server-side owner gates. |

Goal: give persistent, cross-provider, owner-interactable cutex agents the same ergonomics, and
rebuild the task board on the same primitive.

## 2. Owner decisions (2026-10-07)

1. **The trust boundary is the project.**
   - Inside a project (Director ↔ members, parent ↔ the children it created), agents cooperate like
     a main agent and its subagents.
   - Across projects they are isolated, unless the owner links the projects.
   - Independent agents and quick chats: their own creator tree is the boundary.
2. **Identity is always verified.** Each agent has its own credential, and no shared bus token is
   visible in an agent's environment. This is authentication, not distrust, and it can't be
   switched off.
3. **Authority follows roles.** Membership changes, Director rotation, and managing agents you don't
   own are reserved for the Director or the owner.
4. **permissions(child) ⊆ permissions(creator).**
5. **The owner is involved only when an action:**
   - exceeds the caller's own permission envelope,
   - crosses the project boundary, or
   - uses a profile the owner gated.

   Plus logins and quota, and questions routed to the owner (§7.1).
6. **Native subagents stay.** They are configurable per profile and per agent, with the default
   unchanged.
7. **Asks are the core primitive:** subagent-style call/return between persistent agents. An ask
   to a busy target **waits until the target's current turn ends** by default.
8. **Any agent may create child agents**, within limits (§8). Members, meaning agents with standing
   in the project, are created only by the owner or the Director.
9. **Approval of a child's escalation never goes to the requesting chain** (the child, its creator,
   or the Director). It goes to the project's reviewer: 「自动审查」 (**default**) or 「我」. The
   owner can always decide first, and can override an auto-review denial.
10. **No role → model routing table.** Requesters pick concrete agents, profiles and models. Agent
    notes are soft guidance.
11. **A full refactor** of the Task Service and every cutex tool is authorized. Old tool shapes
    don't need to be kept.

## 3. Concepts and words

| Term | Meaning | UI (zh) |
|---|---|---|
| agent | A cutex session, i.e. one native thread (DESIGN §3). | agent |
| project | Workspace + agent team (DESIGN §3.1). | 项目 |
| member | An agent with standing in a project: membership, Director seat, operator grants, project memory. | 成员 |
| child agent | Created by another agent with `agent_start`. Belongs to its creator's domain and has no standing. | 子 agent |
| creator tree | An agent and its children, recursively (by immutable provenance, §8.2). | — |
| capabilities | What an agent can do with nobody reviewing: sandbox, writable roots, network, profiles, service ceiling, reach (§4.4). | — |
| ask | A unit of work from a requester (an agent or the owner) to a target agent, answered automatically. Immutable once created. | 委托 (§13 item 8) |
| attempt | One execution of an ask = one native external-input occurrence = one turn on the target. | — |
| answer | The final agent message of the attempt's turn, plus metadata (§5.6). | 回复 |
| question | A model question raised inside an attempt, with its own id (§5.9). | 提问 |
| artifact | A daemon-stored, access-controlled blob (handoff context, long answers, long briefs) (§8.6). | — |
| reviewer | Who decides approval requests in a project: auto review, or the owner. | 审批方 |
| subagent | A native cute-codex multi-agent thread (unchanged, DESIGN §4.16). | subagent |

## 4. Trust and permissions

### 4.1 Identity

Implemented by TS §3; asks rely on it as is.

- Every runtime authenticates to the bus with a per-agent credential (`cxa1.…`, an HMAC bound to
  its runtime agent id and durable session). `x-cutex-agent-id` alone is never trusted.
- No bus token reaches the shell or exec environment of an agent's commands (S1): stock runtimes
  blank it with `shell_environment_policy.set.CUTEX_AGENT_BUS_TOKEN=""`.
- There is no production switch. **Debug builds only** honour `CUTEX_DEBUG_SHARED_AGENT_BUS_TOKEN=1`
  (hands out the root token again, for debugging old adapters); release builds ignore it. Tests use
  a debug dev daemon, not an operational bypass.
- Known residuals (TS §11), not fixed by this design: the root token is on disk in `config.json`
  and on the bus command line; `/api/federation/*` is unauthenticated; credentials can't be revoked
  one by one (rotate the root). **v1 asks are local-host only**: `agent_list` omits federated agents
  and asks can't target them.

### 4.2 Boundary

Implemented by TS §4 (`AgentBoundary`, domains `project:<id>` / `agent:<root>`, owner links,
`crossProjectAccess = isolated|host`). Asks add:

| | Same domain | Linked domains | Other domains |
|---|---|---|---|
| Appears in `agent_list` (with status) | yes | yes | no |
| Can ask / tell | yes | yes | no (`recipient_outside_boundary`) |
| Can see services | yes | yes (TS §4 redaction) | no (S4) |
| Can see project memory | members only | no | no |
| Requester profile/model shown to target | yes | no, unless the link says so | — |

- `may_interact` is checked when an ask is created **and again at admission** (§5.3): a link
  revoked while an ask is queued fails it with `recipient_outside_boundary`.
- Links are unordered pairs (TS §4) and not transitive. A link authorizes communication only; it
  never grants transcript, memory or execution access.
- Children get no project memory (they have no standing); the creator passes what they need as
  context. Promotion to member adds memory.

### 4.3 Authority (roles)

The role → tool table is in §6.3; every new tool gets one row in `CUTEX_TOOL_RULES` (TS §5).

- **Lifecycle authority** (start, close, restart, change members) is role-based. Reserved for the
  Director: membership changes, Director rotation, lifecycle of members it doesn't own. A child has
  lifecycle authority only over its own creator tree.
- **Communication access** (list, ask, tell) follows the boundary (§4.2), not lifecycle authority:
  a child may ask any agent in its domain.
- Role-filtered tool lists are presentation, not enforcement. Every bus call re-checks the
  authenticated caller's **current** role, grant and boundary. (Listing is evaluated at launch;
  after a role change the agent is restarted to refresh its list, TS §5.)

### 4.4 Capabilities, envelope, managed services

- **Capabilities** = what an agent can do without anyone reviewing it: sandbox mode, writable roots
  (launch cwd + `sandbox_writable_roots`), network access, the profiles it may launch (§8.5), its
  managed-service ceiling (below), and its reach (domain + links).
- **Approval policy is not a capability.** It says how out-of-sandbox actions are decided, and
  those decisions go to the project reviewer anyway (§7). It can't be ranked as "more or less
  power" (`never` refuses escalation; `on-request` lets a reviewer allow it).
- **Envelope** (TS §6) = capabilities + approval policy. Child creation keeps TS §6 as is:
  `clamp_or_refuse` refuses `permission_exceeds_creator {field, requested, limit}`, never silently
  narrows, and checks approval policy "no less strict" too. Asks use the capability comparison only
  (§4.5).
- **Managed services: execution ceiling** (S3, Astra F5). cutex spawns service processes
  unsandboxed (job objects / process groups are cleanup, not confinement). Until a sandboxed
  service runner exists:
  - A managed service runs unrestricted as the owner. That is allowed without approval only when
    the registrant's own capabilities are unrestricted (`danger-full-access`, approval `never`;
    the TS §7 rule).
  - Any other registrant gets a `managed_service` owner approval (TS §7, kind C in §7.1). The card
    states what is being granted: **unrestricted execution as the owner**, not "this command looks
    fine". The approval is bound to the command/cwd/env digest; restarts of the same digest are
    covered; a change of command/cwd/env needs a new approval. The card also warns that a script
    the command runs can change later.
  - The service record stores its ceiling and provenance (registrant, and the ask if registered
    inside an ask's turn).
  - A sandboxed runner, which would let restricted callers register services within their own
    ceiling without approval, is later work.

### 4.5 Escalation through an ask: gate, don't attenuate (decided 2026-10-07)

A requester could ask a more capable agent to do what it may not do itself. (Native children
start with their parent's live policy, so the pair starts equal; independent cutex agents don't.)

**Gate condition.** An ask from an agent requester **needs one review** before admission when
`caps(target) ⊄ caps(requester)`. This covers strictly wider targets *and* incomparable ones (A can
write X, B can write Y). Unknown capabilities count as not-a-subset. Asks from the owner, and from
requesters whose capabilities include the target's, are not gated. The comparison is a sibling of
`clamp_or_refuse` (same lexical, case-insensitive root comparison).

**What is reviewed.** An approval record of kind `ask_delivery` in the TS §7 approval store,
decided per §7.1 row A. Its `requestSha256` is the digest of an **immutable snapshot**:
- ask id, body digest, attachment artifact ids, the `context` option;
- authenticated requester and target session ids;
- the authorization-evidence ids (§7.5);
- versions of: requester capabilities, target capabilities + profile + approval policy, the
  project's policy (reviewer, gates), and the link state.

Ask bodies and attachments can't change after creation; a different request is a new ask (a
follow-up), with its own review.

**Revalidation.** The snapshot is recomputed at admission (§5.3) and after a daemon restart. If
anything changed (target switched profile or widened, link revoked, policy changed, approval
lapsed after the store's 24 h), the approval is stale and the ask returns to `pendingReview` with
the difference shown. A stale approval is never inherited.

**What a yes grants.** Delivery of that one ask snapshot, once, to run under the **target's
existing envelope**. Each action inside the turn still follows the target's own approval policy
(row B). Nothing durable changes.

**Rejected: per-turn attenuation** (Fable C2): `turn/start` approval/sandbox overrides are sticky
(they also apply to later turns), the external-input submit path has no policy fields, and an ask's
influence leaves its turn anyway (tells read later, children, background terminals, services,
memory and handoff files).

**What the gate does not cover.** It controls tracked asks, not all information flow between
cooperating agents inside a trust boundary. Mitigations, not guarantees:
- `agent_tell` notes from a sender whose capabilities don't include the recipient's are tagged
  "from <sender> (narrower capabilities)";
- actions in an ask's turn carry the ask's provenance for the reviewer and the timeline;
- children started and services registered inside a gated ask's turn record the ask;
- §7.7's "data, not instructions" rule.

## 5. Asks

### 5.1 Records and identities

All records are durable in cutex and survive restart.

| Record | Identity | Notes |
|---|---|---|
| Ask | `askId` (server) + `action_id` (client-known, §6.1) | Immutable body/attachments/options. Links: `followUpOf`, requester, target. |
| Attempt | `askId#n` | One per execution. Holds the native message id (chosen by cutex **before** submission), runtime generation, receipt `turn_id`, profile/model snapshot at turn start. |
| Answer | `answerId` + revision | Content in the artifact store; inline preview capped (§5.4). |
| Question | `questionId` | Bound to attempt + runtime generation + native pending request (§5.9). |
| Delivery | per (answer or question, requester) | `pending → claimedByWait | queuedAsEvent → acknowledged` (§5.7). |

Recovery reuses existing machinery instead of a new queue: the bus bridge's pre-submission native
status query and lost-ACK reconciliation (`src/app_server/bus_bridge_external.rs`), the
`OutcomeUnknown` handling of `src/management/v2/native_requests.rs` (an uncertain outcome is kept,
never blindly re-forwarded), the response claims of `src/management/v2/server_requests.rs`, and the
cutex queue revisions. cutex does not promise exactly-once filesystem effects after an uncertain
execution; it promises never to re-run silently.

### 5.2 States

Three independent dimensions instead of one list with sub-states.

**Execution** (per ask, driven by its current attempt):

`pendingReview` → `queued` → `admitted` → `running` → `answered` | `failed` | `interrupted` |
`cancelled` | `rejected`

- `pendingReview`: gated (§4.5), waiting for the reviewer. `rejected`: review denied.
- `admitted`: submitted to the runtime, turn not yet observed. `running`: the turn is observed.
- `interrupted{reason}`: `stopped` (requester), `ownerStopped`, `runtimeRestart`,
  `outcomeUnknown`. Terminal **for the attempt**; the ask can get a new attempt (§5.10).

**Hold reason** (zero or one, on `queued` / `admitted` / `running`):

| Reason | Meaning | Exit |
|---|---|---|
| `targetBusy` | Another turn is running; position in queue shown. | The turn ends. |
| `paused(owner)` | The owner stopped the target or paused its queue. | Owner resumes. |
| `paused(planMode)` | Native external input is held in Plan mode. | Owner leaves Plan mode. |
| `heldByRuntime` | The native gate is closed or the message is `Held(…)` for a reason cutex didn't cause. | §5.10. |
| `blocked(login|quota|runtimeDown|budget)` | The target can't run. | Fixed, or `blockedTimeoutMs` (default 10 min) notifies the requester, who may cancel and re-route. |
| `waitingForApproval` | A native operation approval is pending in the turn (row B). | Decided. |
| `waitingForInput` | A question is open (§5.9). | Answered. |

**Review** (only with `review: true`): `awaitingAcceptance` → `accepted` | `changesRequested` (a
follow-up was sent) | `abandoned`.

**Closed.** A non-review ask closes automatically when execution reaches a terminal state (an
interrupted one stays open until the requester retries or closes it). A review ask closes at
`accepted` or `abandoned`.

### 5.3 Admission (one scheduler per target)

ExternalInput does not give one turn per ask: at every safe boundary core drains **all** eligible
pending items into the current turn, and an idle thread auto-starts a turn for them, racing cutex's
own owner-queue flush (Fable C1, Astra F1). cutex therefore owns admission.

- **One scheduler per target session, in cutex**, arbitrates everything that can start or join a
  turn: owner queued input (the existing cutex queue), asks, ANSWER/QUESTION events (§5.7), alarms,
  tells, legacy bus messages.
- **Admission lease.** At most one turn-starting admission per session at a time. Taken when cutex
  submits; held through the turn; released at the turn's terminal event (or by reconciliation).
  Owner input arriving while the lease is held is queued, not started.
  *Scope (lead, 2026-10-12):* the lease arbitrates **turn starts** only. Steering owner input into a
  turn that is already running (`auto` submit, `cutex/userInput/queue/steer`) starts nothing, so the
  lease blocks it only when the running turn may be an ask's turn:
  - holder **Ask** (whatever its `turn_id`: bound to the active turn, not bound yet, or different):
    `queue/steer` refuses `steer_unavailable{delegationTurn}` and `auto` queues (conservative; the
    explicit 「加入此委托」 path below is unchanged);
  - holder **Event** (ANSWER / QUESTION delivery, §5.7) or **Owner** with an active turn: the turn is
    the session's own work, so `queue/steer` and `auto` steer into it as usual;
  - no active turn (idle, or between turns): any holder still blocks a start; owner input queues and
    the scheduler flushes it after the lease ends. An Event lease never lets two turns start.
- **Asks wait in cutex**, never in the native pending list. An ask is admitted only when the target
  is idle, has no unfinished native turn-triggering obligation, the native gate is open, it is not
  paused, its review (if gated) revalidates (§4.5), the boundary still allows it, the budget allows
  it (§8.3), and no profile switch is pending (§5.11).
- **Order.** FIFO across owner queued input and asks, by enqueue time. The owner can hold or move
  items in the queue panel (the queue reorder API is still a TODO).
  *Shared admission order (owner decision 2026-10-12, replaces handoff decision A6 "a move never
  changes the interleaving with asks"):*
  - Every waiting turn-starting item of a session — owner queued input, asks waiting for this target,
    and any other turn-starting delivery the scheduler admits (ANSWER / QUESTION events §5.7, alarms,
    tells, bus messages: whatever the queue panel shows as "about to be delivered") — has one durable
    **order key**. New items get a key after every existing one (= enqueue time order, as before).
    The scheduler admits strictly in key order; the old "owner head time vs ask head time" comparison
    goes away.
  - Clients read **one merged list** in admission order (kind, id, position, state, enqueue time), so
    the queue panel shows the real order instead of separate sections.
  - The owner moves **only owner items**, to any position among all items (before / after any ask or
    delivery). Asks and deliveries never change order relative to each other; a move rewrites only
    the moved owner item's key (CAS on the queue revision, one event for clients).
  - Setting `queue.ownerMayPassAsks` (default **true**): when false, a move may place an owner item
    later, never earlier than an item that is currently ahead of it (`passing_not_allowed`).
  - Holds and pauses are unchanged: a held / paused item keeps its key; an ask that becomes admissible
    later does not jump the line.
- **One ask per turn.** The attempt is submitted with the native exclusive admission hook (N1,
  §12.2): the turn contains that ask, plus any passive notes the scheduler submitted with it (tells,
  listed in the answer as `includedNotes`), and no other turn-triggering item. If a receipt shows
  that a turn carried other user or turn-triggering input anyway (crash recovery, a bug), the
  answer gets `sharedTurn: true` and is flagged, not silently returned.
- **Binding.** The attempt record (with its native message id) is written before submission; the
  receipt's `turn_id` binds attempt ↔ turn. "Handled" is the native `Output` phase for that message
  id. After a crash between submit and record, cutex queries native status by message id first and
  never resubmits blindly.
- **Owner input during an ask's turn.** Default: Enter queues it as a separate owner turn after the
  ask. 「加入此委托」 steers it into the ask's turn as **shared task input**: the desktop says that
  text may be returned to the requester, and the answer is marked `ownerSteered: true`. (Setting,
  default "queue".)
- **`ifBusy`:** `"queue"` (default, decision 7) or `"fail"` (returns `busy` at once, so the
  requester can pick another agent).
- **Offline target:** brought online only under the auto-wake policy (§8.4); otherwise the ask
  waits `blocked(runtimeDown)`.

### 5.4 What the target receives, and size caps

An `external_event` of type `ASK` on the ExternalInput channel, carrying:
- the ask id and attempt, "follow-up to #id" with the previous answer verbatim for follow-ups;
- the requester (name; profile and model unless hidden across a link, §4.2), with a
  "narrower capabilities" tag if the ask was gated;
- the brief;
- context and attachment **references** (artifact ids, §8.6), not their contents;
- a short, labelled summary of the authorization evidence (the authoritative copy goes to the
  Guardian via N3, §7.5);
- one instruction line: "Your final message in this turn is returned to <requester> as the
  answer; make it self-contained."

Caps (all configurable):
- The receiver's canonical byte policy defaults to 10,000 bytes, and an over-limit item fails
  admission. cutex launches raise it to 32 KiB (a launch-review field in `src/launch/stock.rs`), and
  cutex keeps every ASK/ANSWER/QUESTION event below it.
- Inline brief: up to 4 KiB. Longer briefs go to an artifact.
- Inline answer: up to **8 KiB** (byte cap, not tokens; providers tokenize differently). A longer
  answer gets an explicit marker: `[truncated: 8 KiB of 31 KiB · answer <id> rev <r> ·
  ask_read(<id>, cursor)]`.
- Queued asks per target: at most 50 (`target_overloaded`). This is well below the native limit of
  100 obligations and the Claude inbox cap.

### 5.5 What the requester sees while it waits

- **Immediately:** the execution state and hold reason, with queue position and since-when.
- **While running:** the activity of **that turn only**: tool-call count, the current activity line,
  and any hold reason. Never the target's other turns, owner messages, or other requesters' asks.
  (An owner steer marked shared task input is the one exception, and it is labelled.)
- **Before asking:** `agent_list` shows each agent as idle, busy, paused or offline, with its queue
  length.

### 5.6 Answer capture

- **The answer** is the **final agent message** of the attempt's turn: the last `AgentMessage` whose
  phase isn't `Commentary`. A turn with no such message gives `answer: null` with its status.
- **Metadata:** status, attempt, turn id, duration, token usage, last error, `ownerSteered`,
  `sharedTurn`, `includedNotes`, the target profile/model at turn start, and `nativeDiff` (from
  `turn/diff/updated`). The native diff is labelled as such; it is not an audit of every filesystem
  or external effect.
- **Interrupted or failed** attempts give that status plus the partial last message.
- **`agent_reply(ask, text)`** on the target side posts a progress note only. **v1 has no
  cross-turn deferral** and no tool-driven closing; the end of the attempt's turn is the answer.
  If the target needs the owner first, it asks a question routed to the owner (§5.9) or answers
  saying so, and the requester follows up. Deferral can be added later with an explicit
  resume/bind contract.

### 5.7 Returning answers (one continuation per answer)

- Each answer (and each question, §5.9) has a delivery record per requester.
- **Requester inside `agent_wait` on that ask:** the wait atomically claims it and returns it as the
  tool result. If that result is lost, a retried wait with the same `action_id` returns it again.
- **Otherwise,** when the requester's current turn ends (or at once if it is idle), unclaimed
  answers become **one coalesced** `external_event` of type `ANSWER`, admitted through the
  requester's own scheduler (§5.3). It is acknowledged when the receipt shows the turn. A wait can't
  claim an answer that is already queued as an event, and the other way round.
- `notify: "turn"` (default) starts a requester turn for that event; `"passive"` keeps it for the
  next `agent_wait` / `agent_list`. Auto-started turns count against the budget (§8.3). Over budget,
  the event degrades to passive and the owner is notified.
- **Requester offline:** kept durably; delivered when it is online (auto-wake per §8.4).
- **Requester is the owner:** a desktop notification and the card updates; no external event.
- **Requester paused by the owner:** no auto-started turn; events wait.

### 5.8 Waiting

- `agent_wait(asks? = all mine, mode: "any" | "all", timeoutMs)` returns answers, questions and
  state changes.
- **Short and re-callable.** Default 30 s, max 120 s per call (native v2 defaults to 30 s), so it
  stays below the 300 s MCP tool timeout. The per-server `tool_timeout_sec` is not raised.
- **Concurrent and cancellable.** The cutex MCP facade handles requests concurrently (today it is
  a single-threaded stdio loop, so a long wait would block a parallel `agent_tell`). The daemon keeps
  a wait registry per session; cutex's own `turn/steer`, owner `auto` input and `turn/interrupt`
  paths cancel outstanding waits for that session. That is how "ends early on owner steer" works
  (core can't wake an external MCP call). For Claude, each call is a short-lived `cutex-mcp`
  subprocess, which the cap bounds.
- **Wakes** (both modes): an answer satisfying the mode, an actionable question on any awaited ask,
  owner input to the waiting agent, interruption, or an awaited ask entering `paused`, `blocked`,
  `heldByRuntime`, `rejected` or `interrupted`. These return **immediately with the reason**
  instead of burning the timeout.
- **Deadlock guard.** Only waits block; asks queue and never deadlock, so `agent_ask` is never
  refused for cycles. The graph has an edge X → T when X is inside `agent_wait` on an unanswered ask
  to T, and T is occupied while its running turn is itself inside a wait. On `agent_wait`:
  - `all`: refused with `would_deadlock` if any awaited ask's target reaches X;
  - `any`: refused only if **every** awaited ask does; otherwise the cyclic ones are reported and
    the wait proceeds on the rest.

  The hint says to send a question or end the turn instead.
- **Self-asks** are refused (`invalid: self_ask`; use `alarm_set`).

### 5.9 Questions

- Inside an attempt, `request_user_input`, plan-mode clarifying questions and Claude's
  AskUserQuestion become **question records** bound to the attempt, runtime generation and native
  pending request (thread/turn/item, as in `ToolRequestUserInputParams`).
- **Route:** the requester by default (`questions: "requester" | "owner"`). It falls through to
  the owner when the requester is offline or hasn't answered within `questionTimeout` (default
  10 min). The owner always sees open questions and can always answer.
- **Delivery to the requester:** wakes any wait. If the requester isn't waiting, it arrives as a
  QUESTION event through its scheduler, coalesced with answers.
- **`agent_respond(question, answers)`:** the first accepted response wins (the
  `server_requests.rs` claim). A later one gets `already_resolved`, and one for a superseded
  attempt or generation gets `stale`.
- **Never an approval channel.** A requester's answer is task input. Actions still go through the
  target's approval routing (§7.1), and approval requests are never turned into questions.

### 5.10 Stopping, interrupts and recovery

Any interrupt closes the native external-input gate until a *human* turn (Fable C3); a cutex stop
must not strand other requesters.

- **Requester stop** (`ask_close(ask, "stop")`): if queued, the ask is removed. If running, cutex
  interrupts with the gate-preserving interrupt (N2) and the attempt ends `interrupted{stopped}`
  with the partial message. Other asks to the target are unaffected.
- **Owner stop** on the target (owner 2026-10-08, supersedes the earlier "always records a pause"):
  a stop or interrupt **never pauses delegation**. It pauses only the owner's own input queue
  (`queue-pause`), and cutex reopens the native gate, so queued asks start as usual. If the stopped
  turn was an ask attempt, the attempt ends `interrupted{ownerStopped}` and the requester gets an
  actionable (non-passive) `ownerStopped` state item, even for `notify=passive`. Revert is an owner
  stop plus §5.11.
- **Owner pause** (`asks-pause-v2`, owner 2026-10-08): an asks pause exists only through an explicit
  owner action, `cutex/asks/pause` (desktop: 暂停委托). Queued asks show `paused(owner)` until
  `cutex/asks/resume` (继续) or the owner's next submitted message (started, steered or queued).
  The state is exposed as `asksPaused` in `cutex/userInput/queue/list` and bootstrap, and changes
  emit `cutex/asks/pauseChanged`. Pauses left by older releases read `origin: "legacy"` and clear
  the same way. A paused target's requesters see `delegation_paused` with a hint in `agent_list`.
- **Target cutex cannot start** (explicit launch without a live runtime, or a non-retryable wake
  failure): the requester gets one actionable `blockedOwnerAction` state item and the owner one
  `cutex/ask/ownerActionRequired` notice. `agent_delegate` reports `target_offline`, `auto_wake` and
  `wake_blocked` at once.
- **Runtime alive in another process** (started by the Agent Bus process, no connection here): cutex
  reconnects to it instead of waking it, and the ask shows `heldByRuntime(reconnecting)`.
- **Compaction mid-attempt:** the attempt is flagged, the target gets one `ASK_REMINDER` steer with
  the brief, and the answer carries `compacted` (metadata and requester flag).
- **Runtime holds cutex didn't cause** (`Held(Interrupted)` from another path,
  `Held(RequestUncertain)` after a crash): the attempt shows `heldByRuntime` to the requester and
  the owner at once.
- **Crash / restart mid-attempt:** the attempt is reconciled against native status and terminal
  history. If the turn completed, the answer is captured. Otherwise the attempt ends
  `interrupted{runtimeRestart | outcomeUnknown}`, and the requester gets the partial message.
- **Retry = new attempt.** Retry is offered to the requester and the owner, as a new native
  message ("attempt 2 of ask #n; attempt 1 was interrupted") with a fresh revalidation (§4.5),
  **never** the native `thread/externalInput/retry`, which stays a root-human forensic tool.

### 5.11 Fork, revert, profile switch

- **Fork / revert** of an agent are refused natively while it has unfinished external-input
  obligations. cutex checks first and names the blocking asks, offering to fail them. A
  `context: "fork"` handoff whose source is blocked falls back to `recent:N`, with a notice.
- **Revert** of a turn that answered an ask: the ask is flagged `targetReverted`, the requester is
  told, and the answer text stays. Follow-ups always carry the previous answer verbatim, so a
  reverted target still has the context.
- **Profile switch `afterTurn`** is an admission barrier: the switch applies before the next ask is
  admitted, and the gate revalidates against the new profile. Requester and target profile/model are
  snapshotted at **turn start**, not at ask creation.

### 5.12 Asks are the task board

- **Every ask is a durable task record:** requester and target, title (its first line), the three
  states, attempts, answer, questions, timestamps and turn ids, tokens.
- **Review mode:** `agent_ask(..., review: true)` makes the answer arrive as `awaitingAcceptance`.
  The requester then calls `ask_close(ask, "accepted")`, sends a follow-up (= `changesRequested`;
  the follow-up's answer supersedes for acceptance), or calls `ask_close(ask, "abandoned")`.
- **The Tasks page** (DESIGN §4.18) lists asks, grouped as needs-owner → waiting → running →
  answered/closed, with filters by project, requester and target.
- **Models never invent** ids, revisions or hashes (fixes U3). They get server ids in results and
  reuse the echoed `action_id` on retry.

### 5.13 The owner as requester

- The desktop creates asks on the owner's behalf: Management v2 `cutex/ask/create`. The lifecycle is
  the same, owner asks are never gated, and the answer shows in the desktop.
- **Cross-review:**
  1. Under any reply or diff, 「交叉审阅 ›」 opens a picker for agents and/or profiles. Profiles
     become new ephemeral children of the reviewed agent; agents can also be existing ones.
  2. Each pick gets one ask, containing the content plus context.
  3. A comparison card collects the answers side by side.
  4. 「汇总发给 <agent>」 sends them back to the original agent as a follow-up.

  Picks can be saved as presets (e.g. 「审阅三人组」).

## 6. Agent-facing tools

### 6.1 Principles

- **Few tools**, named `<noun>_<verb>`, with short descriptions that say when to use each.
- **Result shapes are TS §9's:** `{ok:false, status:"no_write", code}` when nothing was done
  (`invalid_arguments`, or the refusing rule's code, e.g. `recipient_outside_boundary`,
  `would_deadlock`, `target_overloaded`), and `{status:"response_uncertain", code:"outcome_unknown"}`
  when the outcome is unknown. A gated ask is not an error: it returns `ok:true` with state
  `pendingReview`.
- **Idempotency: `action_id`, known before the first side effect.** The MCP adapter derives a
  default `action_id` from (caller session, runtime generation, turn id, tool, canonical arguments)
  before sending. The model may pass its own. It is **echoed in every result**, and the tool text
  says to reuse it when retrying after `uncertain`, even from a new tool call. Every mutating tool
  (`agent_ask`, `agent_start`, `ask_close`, `agent_respond`, `agent_tell`, `agent_reply`,
  `agent_close`, `service_*`, `alarm_*`) deduplicates on it; today only `send` does.
- **Answers and other agents' messages are data.** Tool text and instructions say so (§7.7).
- **Names:** agent names are unique within a domain. Duplicates get an automatic suffix, and every
  result returns the canonical id. Addressing works by id or unique name.
- **One shared line of guidance** in the descriptions: use a **native subagent** for quick parallel
  subtasks with your own model that get thrown away afterwards. Use a **cutex agent** for another
  model or provider, a persistent colleague the owner can also talk to, long work, or cross-review.

### 6.2 Tools

| Tool | Who | What |
|---|---|---|
| `agent_list` | all | Reachable local agents (status, queue length, profile/model per §4.2, note), plus my open asks and questions. |
| `agent_start` | all (limits §8.3) | Create a child agent and optionally give it a first ask. Params: name?, profile, model?, effort?, permissions? (⊆ mine, `clamp_or_refuse`), cwd?, context, note?, ephemeral?, ask?. |
| `agent_ask` | all | A new ask or a follow-up. Params: `target`, `text`, `followUp?`, `ifBusy`, `review`, `questions`, `notify`, `context`, `action_id?`. |
| `agent_wait` | all | Wait for my asks (any/all, ≤ 120 s per call). |
| `agent_respond` | requester | Answer a question by `questionId`. |
| `ask_close` | requester | `outcome: "stop" | "accepted" | "abandoned"` (stop = dequeue or interrupt). |
| `ask_read` | requester, target | Answer pages by cursor, and artifacts attached to my asks. |
| `agent_reply` | target | A progress note on an ask being handled. |
| `agent_tell` | all | A note: no answer expected, no turn triggered (today's `send`). Tagged when the sender is narrower (§4.5). |
| `agent_read` | creator / Director | A transcript excerpt of a child or member, scoped per §13 item 11. Separate schema and authorization from `ask_read`. |
| `agent_close` | creator / Director | Archive my child (or a member, for the Director), §8.7. |
| `service_register` / `service_update` / `service_unregister` / `service_list` | all | Services (TS §4 boundary and redaction, §4.4 ceiling). |
| `alarm_set` / `alarm_list` / `alarm_cancel` | all | Reminders, now run by the daemon (fixes C5). |
| `member_add` / `member_remove` / `director_rotate` / `agent_lifecycle` | Director | Membership, the Director seat, and member runtimes going online/offline/restart. |

**Old → new:**

| Old | New |
|---|---|
| `send` | `agent_tell`, or `agent_ask` when an answer is expected |
| `cutex_task_service*` | asks |
| `query_managed` + `cutex_agent_list` | `agent_list` |
| `cutex_agent_management` | `agent_start` (children) / `member_add` + `agent_lifecycle` / `agent_close` / `director_rotate` |
| `set_alarm` etc. | `alarm_*` |
| `cutex_service_*` | `service_*` |

Target: about 3–3.5k tokens of tool schemas for a member (today about 4.4k for every agent). If that
isn't met, defer `service_*` / `alarm_*` behind cute-codex `tool_search`.

### 6.3 Role → tools

| | member | Director | child | independent / quick chat |
|---|---|---|---|---|
| `agent_list/start/ask/wait/respond/reply/tell`, `ask_close`, `ask_read` | ✓ | ✓ | ✓ | ✓ (own tree) |
| `agent_read` | own children | own children + members | own children | own children |
| `agent_close` | own children | own children + members | own children | own children |
| `service_*`, `alarm_*` | ✓ | ✓ | ✓ | ✓ |
| `member_*`, `director_rotate`, `agent_lifecycle` | — | ✓ | — | — |

Tools a role can't use aren't listed (decision 3); every call is still authorised per call (§4.3).

## 7. Approvals

### 7.1 Routing table

| | Kind | Trigger | Decided by | A yes grants |
|---|---|---|---|---|
| A | **Ask delivery** (`ask_delivery`) | An agent's ask with `caps(target) ⊄ caps(requester)` (§4.5) | Project reviewer (「自动审查」 default, or 「我」). Until the cutex reviewer lands (P2): the owner. | Admission of that one ask snapshot, once, under the target's existing envelope. Nothing durable. |
| B | **Native operation** | The target's approval policy asks (command, file, network, MCP tool) in any turn | Project reviewer: native Guardian (Codex) or the cutex reviewer (Claude), §7.4–7.6 | That one action. |
| C | **Durable authority change** | `managed_service` outside the caller's ceiling (§4.4); a gated profile (`agent_profile`, §8.5); project links; member / Director / operator grants; broader transcript access (§13 item 11); auto-wake policy | The owner only | That grant, bound to its digest, recorded, revocable. |
| D | **Refused, not approvable** | Child wider than creator (`permission_exceeds_creator`); ask outside the boundary; profile 「不允许」 | — | — |
| E | **Question** | `request_user_input` etc. in an attempt (§5.9) | Requester (default) or owner | Task input only, never an approval. |
| F | **Account** | MCP elicitation / OAuth, expired login, exhausted quota | The owner | Shown as `blocked`. |

Decision 5 ("the owner is involved when an action exceeds the caller's envelope") maps to rows A
and C. Row A is the decided exception (§4.5): the project reviewer may admit the ask, because every
action in its turn stays under the target's own approval policy (row B). Anything that changes
standing authority is row C and needs the owner.

With 完全访问 (approval `never`), a target never raises row B; rows A, C, E and F remain.

### 7.2 Decisions

- One pending record per request. **The first decision wins atomically** (the approval store's
  compare-and-set; Management v2 already answers `409 approval_not_pending`). The owner can decide
  any pending item before the reviewer.
- **Owner override of an auto-review denial** is bound to the exact ask snapshot (row A) or the
  exact native action (row B: `thread/approveGuardianDeniedAction {threadId, event}`, with the full
  `GuardianAssessmentEvent` the desktop kept from `item/autoApprovalReview/completed`). It never
  widens the session or later asks.
- An approval that has already executed can't be vetoed retroactively. The owner's tools after the
  fact are stop and revert. (This replaces the earlier "the owner's decision always wins".)
- **Reviewer failure** (quota, login, timeout) escalates to the owner. It never fails open.
- The requester learns the outcome of row A through the ask's state (wait result or event). Row C
  outcomes are pushed as an event too. This closes the TS §7 gap where the agent isn't notified.

### 7.3 Reviewer setting

- Per project, 「子 agent 的审批」: 「自动审查」 (**default**) or 「我」.
- The Director and its children use the same reviewer, like Codex children inheriting
  `approvals_reviewer`.
- Optionally, some categories always go to the owner (e.g. network, writes outside the workspace,
  deletions, all row A). The list is empty by default.

### 7.4 Codex runtimes: the native Guardian (row B)

- When the project says 自动审查, cutex launches the runtime with
  `approvals_reviewer = "auto_review"` (cute-codex `ApprovalsReviewer`, alias `guardian_subagent`).
- The Guardian is an isolated reviewer session (`codex-rs/core/src/guardian/*`), with its own
  policy prompt and risk framework, request/input budgets and timeouts.
- Desktop: render `item/autoApprovalReview/started|completed` and `guardianWarning`. Offer
  「仍然批准」 on a denial (§7.2).

### 7.5 Authorization evidence across sessions

The native Guardian treats `external_event` content as **untrusted tool output**, not authorization.
Sender evidence is captured only for `send_message_to_thread` in the `codex_app` / `codex_tui`
namespaces, and root evidence only for a V2 worker whose root is another thread
(`sender_context.rs`, `user_authorization.rs`). A child that only receives asks therefore has no
authorization evidence, and 自动审查 would become "auto-deny for children" (Fable M1, Astra F3).

Contract:
- **The daemon resolves the evidence**, never the model:
  - the owner message ids that led to the ask, with bounded excerpts (≤ 900 tokens, like
    `GUARDIAN_MAX_ROOT_MESSAGE_TOKENS`);
  - the authenticated ask ancestry (which agent asked whom, each ask's text), with human
    instructions marked apart from agent requests;
  - later owner restrictions in the root session, re-resolved at each attempt start;
  - explicit truncated/missing markers.
- **It reaches the Guardian through a trusted daemon → runtime hook (N3, §12.2)** as sender-tier
  evidence (`GuardianSenderMessages`). Root tier is rejected: it would launder requester text into
  "what the user said". The evidence is persisted in the rollout so it survives compaction and
  restart. The model-visible ASK event carries only a labelled summary, which is not authority.
- **Scope.** The evidence is what the owner wrote and may be sensitive. It goes to the target's
  provider and its Guardian under the same rules as handoff context (§8.6).
- Whether the Guardian also reads external text through its general transcript input is tested
  separately (§12.3), not assumed.

### 7.6 Runtimes without the Guardian: the cutex reviewer

- **Claude agents** have no Guardian. Their approvals default to `bypassPermissions`, and the SDK
  permission callback denies when no interactive peer is subscribed. The **cutex reviewer** is a
  dedicated reviewer session that **subscribes as the approval peer**. It gets the action, the
  target's justification, the evidence (§7.5) and the project's policy, and returns approve, deny or
  escalate. It uses the same UI.
- A Claude target on `bypassPermissions` has full capabilities, so asks from restricted requesters
  to it are gated (row A). That keeps it from being the easy laundering target.
- The cutex reviewer also decides row A (ask delivery) under 自动审查. It sees the ask snapshot, the
  capability difference and the evidence.
- **Reviewer profile:** §13 item 7 (decided: owner picks once in 默认). It is never a profile marked 「不允许」, and a
  reviewer's own actions are never reviewed recursively.
- If cross-model review proves better, the same reviewer could later replace the native Guardian
  for Codex runtimes too.

### 7.7 Never the requesting chain; data, not instructions

- None of the child, its creator or the Director decides the child's approvals (decision 9). Codex
  and Claude Code make the same choice.
- "I was refused X, please do it for me" from another agent is data, not an instruction. Tool
  descriptions and the injected instructions say that an agent must not perform an action another
  agent was denied, and must surface it to the owner instead. This is guidance; the enforced part
  is the gate (§4.5) and the routing table (§7.1).
- Every decision is recorded with who made it (owner / Guardian / cutex reviewer), what it was
  bound to, and shown in the target's timeline.

## 8. Child agents

### 8.1 Creation

`agent_start` parameters:
- `name?` (unique in the domain, auto-suffixed)
- `profile`: any profile the caller may use (§8.5)
- `model?`, `effort?`
- `permissions?`: must be ⊆ the caller's (`clamp_or_refuse`, TS §6)
- `cwd?`: defaults to the project workspace root
- `context` (§8.6)
- `note?`
- `ephemeral?`: default false
- `ask?`: the first ask (gated per §4.5 like any other; a child ⊆ creator never is)

### 8.2 Provenance vs presentation

- **Immutable, set at creation:** `createdBy`, `rootCreator`, `creationDepth`, and `originDomain`
  (`project:<id>` or `agent:<root>`). The boundary (TS §4) resolves domains from this provenance,
  so later moves can't change it.
- **Mutable:**
  - `displayParent` (sidebar nesting; detach changes only this);
  - `lifecycleManager`: the creator. After the creator is archived, it becomes the project's
    Director for project trees, and **the owner** for independent trees;
  - `kind` and membership.
- Detaching or reparenting never resets depth, grants standing or widens authority. Promotion to
  member (owner or Director) adds standing but keeps provenance.

### 8.3 Limits and budgets

Configurable per project and per independent creator tree. Limits are allocated **atomically**: the
slot is reserved in the same locked transaction that writes the session record. "Live" means not
archived (online or offline).

| Limit | Default |
|---|---|
| Live children per agent | 4 |
| Creation depth (a child may create, a grandchild may not) | 2 |
| Live children per project / per independent tree | 12 |
| Agent-started online runtimes per project / tree (separate from retention) | 6 |
| Auto-started turns per hour per project / tree (ANSWER/QUESTION events, auto-wakes, alarms) | 60 |
| Token budget per ask tree | off |

- Over a creation limit, the call is `refused`, with the existing children listed and a hint to
  reuse one.
- Over a runtime or turn budget, offline targets show `blocked(budget)`, auto-turns degrade to
  passive, and the owner is notified.

### 8.4 Auto-wake

An ask to an offline target brings it online only under the **owner-configured auto-wake policy**
(§13 item 5). It always re-checks:
- the profile gate,
- role and boundary,
- the budget,
- that the target isn't archived, owner-stopped or owner-paused.

A target that crashed or was idle-reaped is different from one the owner took offline on purpose;
the latter is never woken.

### 8.5 Profile gate

Per profile: 「agent 可直接使用」 (default), 「需要我批准」 (TS `agentUseRequiresApproval`, row C), or
「不允许」 (new; row D). It is shown on the profile page and applies to `agent_start`, auto-wake and
reviewer selection.

### 8.6 Context handoff and the artifact store

Handoff content is **not written into the workspace** (a read-only review must not write into the
repository). It goes to a daemon-owned, access-controlled **artifact store**:
- private under the cutex runtime dir;
- content-addressed ids, never display names;
- readable through `ask_read` by the requester, the target and the owner;
- pruned with the ask.

An explicit `outputPath` inside the requester's writable roots is allowed when asked for.

| Option | What the child gets |
|---|---|
| `none` | Nothing. |
| `brief` | Only the ask text. |
| `recent:N` | The daemon renders the requester's last N turns (byte-capped) into an artifact and references it. |
| `fork` | Same provider only: `cutex/session/fork` at the requester's last turn. If the source has unfinished obligations it falls back to `recent:N` (§5.11). |

- Forking across providers is impossible, because reasoning state isn't portable. `recent:N` is the
  long-context substitute.
- **Data scope.** `recent:N` and the authorization evidence carry the owner's conversation,
  including anything sensitive in it, to the target's provider. The ask card says what was included
  and which provider receives it. A project setting 「交接上下文可发往其他服务商」 controls this
  (default on, since cross-provider work is the point). The profile gate still applies.

### 8.7 Lifecycle and archival

- Children are normal persistent agents. They show nested under their creator (`displayParent`) and
  can be detached to the top level.
- **Ephemeral** children are archived after `ephemeralIdleMinutes` (default 30), and only when there
  is no running turn, queued work, open question or approval, and no open ask either way. Once the
  owner talks to an ephemeral child directly, it is no longer auto-archived.
- **`agent_close`** is refused while the child has open work, unless `force`, which cancels its
  asks. It closes grandchildren first and unregisters the child's services (session delete refuses
  sessions that own services).
- **Creator archived or deleted:** its children stay. `lifecycleManager` changes (§8.2), and the
  sidebar shows "由 Eva 创建（已归档）".

## 9. Desktop

- **Requester side:** an ask card in the timeline: the target's avatar and model, the task, the
  live state with hold reason or position, an activity line, an answer preview, 打开. While the
  requester is in `agent_wait`, its turn shows 「等待 Kimi、Claude…」, and the status capsule shows
  the waits.
- **Target side:**
  - incoming asks appear as 「来自 Eva 的委托」 bubbles;
  - answers are marked 「↩ 已回复 Eva」;
  - queued asks show in the queue panel;
  - the composer shows when the running turn is an ask, with Enter = queue and 「加入此委托」 =
    shared task input (§5.3).
- **Approvals:** the approval dock shows the routing row (ask delivery / operation / grant), who
  asked, for which ask, the capability difference for row A, who reviews (自动审查 / 我), the
  verdict, and 「仍然批准」.
- **Questions:** open questions with their route and timeout, answerable by the owner.
- **Cross-review:** §5.13. **Tasks page:** §5.12.
- **Sidebar:** children nested, with badges. The tray counts items that need the owner.
- **Settings:**
  - on the project page: reviewer, limits and budgets, auto-wake policy, cross-provider handoff,
    project links;
  - on the profile page: the profile gate;
  - under 默认: the reviewer profile and the inline caps.

## 10. Management v2 (cutex ↔ desktop)

- **Session fields:** `createdBy`, `rootCreator`, `creationDepth`, `displayParent`,
  `lifecycleManager`, `kind: "member" | "child" | "independent" | "quickChat"`, `note`.
- **Resources:**
  - `GET /v2/asks?project=&requester=&target=&state=`;
  - `GET /v2/asks/{id}`, with attempts, the three states, questions, answer metadata and the
    activity summary;
  - `GET /v2/asks/{id}/answer?cursor=`;
  - `GET /v2/artifacts/{id}`.
- **Commands:** `cutex/ask/create` (owner as requester), `cutex/ask/stop`, `cutex/ask/close`,
  `cutex/ask/retry` (new attempt), `cutex/ask/respond` (by question id).
- **Approvals:** row A and C records live in the existing `/v2/approvals` store (TS §7). Kinds:
  `ask_delivery`, `managed_service`, `agent_profile`, plus later grant kinds.
- **Events:** `cutex/ask/created|stateChanged|answered|closed` and `cutex/ask/question`, on both
  sessions' streams. Approvals use the existing `cutex/approvals/changed`.
- **Settings / project / profile fields** for §7.3, §8.3, §8.4, §8.5 and §8.6, and links via
  `agentSecurity` (TS §4).
- **Capability flags:** `agent-asks`, `ask-gate`, `child-agents`, `approval-reviewer`,
  `ask-artifacts`.

## 11. Migration

- **The Task Service is retired.** Existing records stay readable, in a legacy section on the
  Tasks page. At deploy, the activation script lists open assignments, and they are finished or
  cancelled first (the owner decides).
- **Held bus messages.** The activation script also lists `Held(Interrupted)` and
  `Held(RequestUncertain)` external inputs on every runtime (today's bus has the same gate problem),
  and the owner resolves them.
- **The old tools are removed** in the same release. Running agents get the new tool list when they
  relaunch; activation already cycles online runtimes. The MCP facade is pinned in the reviewed
  bundle manifest (TS §10), so it must be upgraded together.
- **Alarms** move into the daemon (C5), with their store migrated.
- **Claude agents** (coordinate with `feat/claude-sdk-upgrade`, now merged on `feat/desktop-api`):
  - ASK / ANSWER / QUESTION over `claude/input/submit` with ask and attempt ids;
    `fifo-separate-turns` already gives one ask per turn;
  - an attempt ↔ turn mapping from the adapter's receipt;
  - the cutex reviewer as the approval peer (§7.6);
  - the per-agent filtered tool descriptor (`cutex-mcp-tools.json`, TS §5), regenerated for the
    new tools;
  - short waits (each tool call is a fresh `cutex-mcp` subprocess).

## 12. Phases

### 12.1 Phases

| Phase | What | Depends on |
|---|---|---|
| P0 ✓ | `feat/tool-security`, merged (78ce754): per-agent credentials, boundary, role table, `clamp_or_refuse`, approval store, managed-service gate, native-subagent toggle. | — |
| P1 | **Asks core, starting with feasibility.** (a) A spike on the dev daemon: the scheduler and lease with today's APIs, receipt binding, interrupt/held behaviour, crash windows, Guardian visibility of external text. (b) Native hooks N1, N2 (§12.2). (c) cutex: the records and outboxes (§5.1), the scheduler (§5.3), the gate with `ask_delivery` decided by the owner (§4.5), caps and the artifact store, answer capture and return, short concurrent waits plus the registry, the deadlock guard, questions, stop/recovery, fork/revert/switch rules, provenance + limits + budgets, the managed-service ceiling rule, the tools of §6 in `CUTEX_TOOL_RULES`, Management v2 §10. (d) Claude adapter: ASK/ANSWER/QUESTION with ids, receipt mapping, descriptor. | P0 |
| P2 | Approvals: reviewer setting, Guardian config, N3 evidence hook, the cutex reviewer (row A under 自动审查, Claude row B as peer), routing table, overrides. | P1 |
| P3 | Desktop (§9). | P1 (P2 for the approvals UI) |
| P4 | Retire the Task Service and the old tools; migration (§11); deploy. | P1–P3 |
| P5 (optional) | Native `spawn_agent` with another provider's model, backed by a cutex child (a cute-codex fork change). | P4 |

**P0 acceptance** (checked before P1 starts; Fable M9):
- a credential is valid only with its own runtime id and session;
- no bus token in the exec environment;
- `tools/list` is role-filtered and every call is enforced;
- `clamp_or_refuse` runs on every agent launch;
- the approval store fails closed;
- `may_interact` filters list, send and services.

### 12.2 Native hooks (cute-codex `feat/desktop-slim`)

Each hook is callable only by the app-server client (cutex), never by the model, and is kept as
small as the existing ExternalInput fork patches.

| Hook | What | Phase |
|---|---|---|
| **N1 Exclusive admission** | A `thread/externalInput/submit` option, e.g. `admission: "exclusiveTurn"`. It is accepted only if the thread is idle with no unfinished turn-triggering obligation; otherwise it is refused with `busy` and not queued. It starts the turn at once, and that turn drains this item plus any passive items submitted with it, and no other turn-triggering item. It returns the receipt with `turn_id` synchronously. Native `StartIfIdle` never merges anything into it. | P1 (required unless the spike proves the lease alone is atomic, crash recovery included) |
| **N2 Gate control** | `thread/externalInput/resume` reopens the gate without a human turn. An interrupt variant (`turn/interrupt` with `holdExternalInput: false`) doesn't close it, for requester stops. | P1, required |
| **N3 Trusted sender evidence** | Daemon-supplied evidence (§7.5), on N1 or as its own method. Core maps it to `GuardianSenderMessages` (extending `sender_context.rs` capture) and persists it in the rollout. | P2, required for 自动审查 on asks |
| — | Receiver byte policy raised for cutex launches. A cutex launch-config field, not a fork change. | P1 |

### 12.3 Acceptance tests

A dev daemon with two providers (e.g. DeepSeek and a ChatGPT profile). Each item is one scenario;
the review ids are in brackets.

1. **Admission.** Two asks plus a queued owner message on a busy target: deterministic FIFO, exactly
   one ask per turn, exact answer ↔ turn binding, and any required review done first. Owner Enter in
   the admit window queues. [C1, F1]
2. **Gate.** A strictly narrower requester, an incomparable requester, an equal requester and the
   owner: only the first two are reviewed, once each. Approve, then change the target's profile or
   permissions, or restart the daemon, before admission: the approval is stale and the ask goes back
   to review. A revoked link fails the queued ask. [F2, C2]
3. **Evidence.** Real owner evidence vs forged quoted owner text in a brief; a later owner
   restriction; a multi-hop ask chain; compaction and restart. The Guardian accepts only N3
   evidence. [M1, F3]
4. **Crash windows.** Kill cutex or the runtime before/after native submit, receipt, attempt
   binding, answer persistence and the ANSWER acknowledgement. Reconciliation never reruns work
   blindly, and a retried `agent_ask` with the same `action_id` from a new call id finds the same
   ask. [F6, M4, m1]
5. **Interrupts.** Owner Esc with an empty queue, then an ask: it shows `paused(owner)` and runs
   after resume. A requester stop of a running ask: the other asks to that target still run. Stop
   while `admitted`. An incoming ANSWER or auto-wake doesn't undo an explicit pause. [C3, F6]
6. **Waits and questions.** `wait(all)` woken by a question; two questions on one ask; simultaneous
   owner and requester responses (one wins, one gets `already_resolved`); a self-ask; a two-agent
   wait cycle; `wait(any)` with one cyclic and one independent branch; a 120 s wait with a parallel
   `agent_tell` (not blocked); owner steer ends the wait. [M2, M3, F7]
7. **Answers.** A turn with no final message; several messages; owner shared input (`ownerSteered`);
   an answer over 8 KiB paged by cursor; an ASK event over 10 KB without the raised policy (fails
   cleanly, no retry loop). [M6, m6, m10]
8. **Fork / revert / switch.** Fork with an open ask (refused with names, or `recent:N` fallback);
   revert of an answering turn; profile switch between queue and admission. [M5]
9. **Lifecycle.** An ephemeral child with an owner turn or queued work isn't archived; an independent
   creator is archived (the owner becomes manager); simultaneous child creation at the limit (exactly
   one wins); detach keeps the depth. [F8, F11, m4]
10. **Budgets.** An ask storm over the auto-turn budget degrades to passive and notifies the owner;
    auto-wake respects the policy and an owner-stopped target. [M8, F11]
11. **Services and handoff.** Managed-service register, update and restart from a restricted
    envelope (owner approval naming unrestricted execution); `recent:N` for a read-only repository
    writes nothing into it; the cross-provider handoff setting is off. [F5, F9]
12. **Claude.** The same as 1, 4 and 6 against a Claude target; a Claude bypass target from a
    restricted requester is gated. [M7]
13. **Cross-review card**, end to end.

## 13. Defaults and open items

Status: **adopted (review)** = the reviewers' recommendation is taken (veto in review still
possible); **decided (owner)** = the owner's call, recorded with its date.

1. **Limits** 4 / depth 2 / 12. *Adopted (review):* kept as creation limits; atomic allocation,
   depth kept across detach, independent-tree aggregate, plus runtime and auto-turn budgets
   (§8.3).
2. **Questions go to the requester.** *Adopted (review):* falls through to the owner after 10 min
   or when the requester is offline; wakes both wait modes; question ids (§5.9).
3. **Children nested in the sidebar.** *Adopted (review):* nesting is presentation only (§8.2).
4. **ANSWER starts an idle requester's turn** (`notify: "turn"`). *Adopted (review):* coalesced,
   one continuation per answer, under the auto-turn budget, respects pause (§5.7).
5. **Auto-wake of offline targets.** **Decided (owner, 2026-10-07).** The unconditional "children always may" is
   removed (§8.4). Default: on for the requester's own children and for same-project
   peers that went offline by crash or idle shutdown; never for owner-stopped, owner-paused or
   archived agents; always within the runtime budget.
6. **Inline answers.** *Adopted (review):* a byte cap of 8 KiB, configurable, with a truncation
   marker and an answer revision/cursor; the receiver policy is raised to 32 KiB for cutex launches
   (§5.4).
7. **Reviewer profile** (cutex reviewer: row A, and Claude row B). **Decided (owner, 2026-10-07).**
   Default: the native Guardian for Codex row B. For the cutex reviewer, a profile the owner picks
   once in 默认; until picked, row A and Claude row B go to the owner. "A different provider than
   the target" is only a tie-breaker suggestion. It is never a 「不允许」 profile, and it fails
   closed to the owner.
8. **UI words.** 子 agent is adopted (native stays "subagent", DESIGN §4.16). **Decided (owner, 2026-10-07):**
   委托 for asks (任务 also names native plan steps and legacy Task Service rows); 任务页 keeps its name.
9. **Guardian and `external_event`.** *Adopted (review):* settled. It is untrusted tool output, so
   the trusted sender-tier hook N3 is required (§7.5, §12.2).
10. **Project links.** *Adopted (review):* mutual (unordered pairs, as TS §4 implements them), not
    transitive, communication only, rechecked at admission (§4.2).
11. **Transcript access for `agent_read`** (Director over members, creators over children).
    **Decided (owner, 2026-10-07).** Default: answers plus the ask's own attempt turns. Full
    transcripts stay owner-only unless the owner grants broader access per project (row C,
    audited).
12. **Attenuation vs gate.** Decided by the owner on 2026-10-07 (§4.5): gate, one review
    per ask, no attenuation. *Adopted (review):* the gate condition is `caps(target) ⊄
    caps(requester)`, bound to a snapshot and revalidated (§4.5).
13. **Owner input during an ask's turn.** *Adopted (review):* queue by default, explicit shared
    task input as the alternative, configurable (§5.3).
14. **Cross-provider handoff.** *Adopted (review):* allowed by default, disclosed on the card, with
    a project setting (§8.6).
15. **Cross-turn deferral.** *Adopted (review):* not in v1 (§5.6).

**Owner decisions 2026-10-07:** items 5, 7, 8 and 11 take the recommended defaults above. No open
items remain.

## 14. Review log

- 2026-10-07 **Fable 5.1** (`docs/reviews/cutex-agent-asks/fable-5.1.md`), against cute-codex
  `feat/desktop-slim` and cutex a7ce011. The direction holds. ExternalInput merges pending items
  into one turn, and two dispatchers race (C1). Interrupts close the native gate until a human turn
  (C3). Attenuation is unsound (C2, which led to the owner's gate decision, §4.5). External events aren't Guardian
  evidence (M1). Plus waits, deadlock, recovery, fork/revert, payload, Claude and budget gaps. It
  noted P0 was unverifiable at the time; P0 has since been merged (78ce754).
- 2026-10-07 **Astra** (`docs/reviews/cutex-agent-asks/astra.md`), reviewed after the gate decision.
  It agrees on admission (F1 ≈ C1) and evidence (F3 ≈ M1). It adds the partial-order gate condition
  and immutable approval binding (F2), the managed-service execution ceiling (F5), durable
  identities and recovery (F6), question ids (F7), separate states and archival (F8), handoff scope
  (F9), routing races (F10) and provenance vs presentation (F11). F4 was retired by the gate decision.

| Finding | Resolution | Section |
|---|---|---|
| Fable C1 / Astra F1 — no one-ask-per-turn; racing dispatchers | A cutex scheduler per session with an admission lease over owner input, asks and events; asks held in cutex; N1 exclusive admission; receipt `turn_id` binding; `sharedTurn` flag | §5.3, §12.2 N1 |
| Fable C2 — attenuation unsound | Rejected; gate per ask (owner decision); provenance tags; the gate's limits stated | §4.5 |
| Fable C3 — interrupt closes the native gate | Gate-preserving requester stop and resume (N2); owner stop always records a pause; `heldByRuntime`; retry = new attempt | §5.10, §12.2 N2 |
| Fable M1 / Astra F3 — ASK text isn't Guardian evidence | Daemon-resolved evidence through the trusted N3 hook, sender tier, persisted; model text never authoritative | §7.5, §12.2 N3 |
| Fable M2 — long blocking wait | Concurrent facade, wait registry cancelled by steer/interrupt, 30 s default / 120 s max | §5.8 |
| Fable M3 — deadlock guard | Wait-only graph with occupancy; `any` vs `all`; immediate return on pause/block/hold; self-asks refused | §5.8 |
| Fable M4 — crash mid-ask | `interrupted{runtimeRestart|outcomeUnknown}`, reconciliation, retry as new attempt | §5.10, §5.1 |
| Fable M5 — fork/revert/switch | cutex pre-check with `recent:N` fallback, `targetReverted`, follow-ups carry the answer, switch as admission barrier, snapshot at turn start | §5.11 |
| Fable M6 — payload limits | Receiver policy raised to 32 KiB; 4 KiB brief and 8 KiB answer caps; artifacts; `target_overloaded` at 50 | §5.4 |
| Fable M7 — Claude adapter gaps | Work items listed; reviewer as peer; bypass targets gated | §11, §7.6, §12.1 P1(d) |
| Fable M8 — no budgets | Runtime, auto-turn and token budgets per project and independent tree | §8.3 |
| Fable M9 — P0 unverifiable | P0 merged; acceptance criteria listed | §12.1 |
| Fable m1 — idempotency contradiction | Client-known `action_id`, echoed, deduped on every mutating tool | §6.1 |
| Fable m2 — name collisions | Unique per domain, auto-suffix, canonical id | §6.1, §8.1 |
| Fable m3 — `blocked` has no exit | `blockedTimeoutMs`, wait returns immediately | §5.2, §5.8 |
| Fable m4 — ephemeral archival | Idle-based archival with no open work; `agent_close` order | §8.7 |
| Fable m5 — Plan mode | `paused(planMode)` | §5.2 |
| Fable m6 — owner steer | Queue by default; `ownerSteered` | §5.3, §5.6 |
| Fable m7 — memory for children | None (no standing); promotion adds it | §4.2 |
| Fable m8 — cross-host | Local host only in v1 | §4.1 |
| Fable m9 — token target | 3–3.5k target; `agent_stop` merged into `ask_close`; `tool_search` fallback | §6.2 |
| Fable m10 — no agent message | `answer: null`; final message defined | §5.6 |
| Fable m11 — metadata across links | Profile/model hidden across links | §4.2, §5.4 |
| Fable m12 — test gaps | Acceptance tests | §12.3 |
| Fable m13 — held bus messages | Listed and resolved at activation | §11 |
| Fable nits | §1 table reworded; `approveGuardianDeniedAction` takes the full event; `stateChanged` event; 任务 vs 委托 raised | §1, §7.2, §10, §13 item 8 |
| Astra F2 — partial order and binding | `caps(target) ⊄ caps(requester)`; capabilities apart from approval policy; snapshot digest; revalidation | §4.4, §4.5 |
| Astra F4 — retired | The gate's limits stated | §4.5, §7.7 |
| Astra F5 — managed-service ceiling | Unrestricted only for unrestricted registrants or an explicit owner grant of that authority; ceiling and provenance stored | §4.4 |
| Astra F6 — recovery and retry identity | Ask/attempt/answer/question/delivery records; outboxes; reuse of `native_requests` and bus bridge reconciliation | §5.1, §5.7, §5.10 |
| Astra F7 — questions | Question ids, wake both modes, first response wins, fall-through, not an approval channel | §5.9 |
| Astra F8 — states and archival | Execution / hold / review dimensions; auto-close; no v1 deferral; archival rules | §5.2, §5.6, §8.7 |
| Astra F9 — handoff and disclosure | Artifact store; no-secrets claim removed; shared task input label; ask-scoped transcript default | §8.6, §7.5, §5.3, §13 item 11 |
| Astra F10 — routing and races | Routing table A–F; atomic first decision; bound overrides; no retroactive veto | §7.1, §7.2 |
| Astra F11 — provenance vs presentation | Immutable provenance, `lifecycleManager`, atomic limits, tree budget, auto-wake policy | §8.2–§8.4 |
| Astra smaller corrections | Debug-only escape hatch stated accurately; lifecycle vs communication; per-call enforcement; reuse of existing reconciliation; `ask_read` vs `agent_read`; no v1 deferral; native diff label; native inheritance stated precisely | §4.1, §4.3, §5.1, §6.2, §5.6, §4.5 |
| Astra acceptance cases 1–8 | Merged with Fable m12 | §12.3 |
