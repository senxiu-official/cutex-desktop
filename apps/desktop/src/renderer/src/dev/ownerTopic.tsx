// Variants topic 「所有者」 (dev preview only, owner 2026-10-19): a page 所有者 in 连接 — each host has one
// owner, a local identity (the only designated root identity); what you can do there (你的权限) is told
// apart from who owns it. A: one overview of every host; B: one host at a time (host picker), with who
// else has full control and changing the owner. C: how 设备 rows then read. Mock data only.
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Copy, Monitor, Server, ShieldCheck } from "lucide-react";
import { Button, Section, Segmented, SettingRow } from "../components/settings/Form";

const CHIP = "inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] whitespace-nowrap";
const T = {
  local: <span className={`${CHIP} bg-surface-2 text-muted`}><Monitor size={11} />本地桌面应用</span>,
  host: (picker: ReactNode) => <span className={`${CHIP} bg-accent/12 pr-0.5 text-accent`}><Server size={11} />cutex 后端 ·{picker}</span>,
  self: <span className={`${CHIP} bg-accent/12 text-accent`}>此设备</span>,
  you: <span className={`${CHIP} bg-accent/12 text-accent`}>你</span>,
  backend: <span className={`${CHIP} border border-dashed border-warn/60 text-warn-text`}>需后端</span>,
};

type HostId = "host-a" | "host-b" | "hachimi" | "lab-gpu";
interface MockHost {
  id: HostId;
  os: string;
  self?: boolean;
  owner: { name: string; fp: string; you?: boolean; source: string; when: string } | null;
  /** 你的权限 and where it comes from. */
  rights: string;
  via: string;
}
const HOSTS: MockHost[] = [
  { id: "host-a", os: "Windows", self: true, owner: { name: "Sam", fp: "9f3a 61c2 0b7e d415", you: true, source: "首次本机认领", when: "2026-09-12" }, rights: "完全控制", via: "本机" },
  { id: "host-b", os: "Linux", owner: { name: "Sam", fp: "9f3a 61c2 0b7e d415", you: true, source: "首次本机认领", when: "2026-09-20" }, rights: "完全控制", via: "SSH：sam@host-b" },
  { id: "hachimi", os: "Linux", owner: { name: "ema", fp: "41d0 9c8a 77e2 03bf", source: "首次本机认领", when: "2026-10-02" }, rights: "完全控制", via: "SSH：ema@hachimi" },
  { id: "lab-gpu", os: "Linux", owner: null, rights: "按授权", via: "设备令牌" },
];

const NOTES = [
  "「所有者」是一页（连接 → 所有者）：每台主机只有一个所有者，就是一个本地身份（个人身份密钥），也是唯一指定的 root 身份。",
  "所有者只决定设备归谁：在「设备」页里放进「我的设备」还是「我能访问的设备」。",
  "你的权限另算：完全控制 / 按授权 / 等待分配，后面写权限从哪来（本机、SSH 登录的系统账号、设备令牌）。",
  "能登录那个系统账号的人都有完全控制权；所有者不变。更换所有者只能在那台主机本机操作。",
];

function Header({ hint, tags }: { hint?: string; tags: ReactNode }) {
  return (
    <div className="mb-4 space-y-1.5 border-b border-border/60 pb-3">
      {hint && <p className="text-[13px] text-muted">{hint}</p>}
      <div className="flex min-h-6 flex-wrap items-center gap-1.5">{tags}</div>
    </div>
  );
}

const Avatar = ({ name, you }: { name: string; you?: boolean }) => (
  <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ${you ? "bg-accent/20 text-accent" : "bg-surface-2 text-muted"}`}>{name.slice(0, 1)}</span>
);

function Rights({ h }: { h: MockHost }) {
  return (
    <span className="text-xs text-muted">
      {h.rights}
      <span className="text-subtle">（{h.via}）</span>
    </span>
  );
}

// ---- A: overview ----

function MyIdentity() {
  return (
    <Section title="你的身份" hint="成为所有者时登记的就是这个身份。它只保存在这台电脑上。">
      <SettingRow label="Sam" hint="个人身份密钥 · 9f3a 61c2 0b7e d415">
        <Button onClick={() => {}}><span className="inline-flex items-center gap-1"><Copy size={12} />复制公钥</span></Button>
      </SettingRow>
    </Section>
  );
}

function OverviewA({ open }: { open(h: HostId): void }) {
  return (
    <>
      <Header hint="每台主机只有一个所有者。所有者决定设备归谁，你在上面能做什么另算。" tags={<span className={`${CHIP} bg-accent/12 text-accent`}><Server size={11} />cutex 后端 · 每台主机</span>} />
      <MyIdentity />
      <Section title="各主机的所有者" hint="只能在那台主机本机更换所有者。">
        <div className="-mx-4 grid grid-cols-[1.2fr_1fr_1.6fr_auto] items-center gap-x-3 border-b border-border/70 bg-win px-4 py-1.5 text-[11px] text-subtle">
          <span>主机</span>
          <span>所有者</span>
          <span>你的权限</span>
          <span className="w-16" />
        </div>
        {HOSTS.map((h) => (
          <div key={h.id} className="-mx-4 grid grid-cols-[1.2fr_1fr_1.6fr_auto] items-center gap-x-3 border-b border-border px-4 py-2.5 last:border-b-0">
            <span className="flex min-w-0 items-center gap-1.5 text-sm">
              <span className="truncate">{h.id}</span>
              {h.self && T.self}
            </span>
            <span className="flex items-center gap-1.5 text-sm">
              {h.owner ? (
                <>
                  {h.owner.name}
                  {h.owner.you && T.you}
                </>
              ) : (
                <span className="text-warn-text">未确认</span>
              )}
            </span>
            <Rights h={h} />
            <span className="flex w-16 justify-end">
              {h.self ? (
                <Button onClick={() => open(h.id)}>更换…</Button>
              ) : (
                <button type="button" title="查看" onClick={() => open(h.id)} className="text-subtle hover:text-foreground"><ChevronRight size={14} /></button>
              )}
            </span>
          </div>
        ))}
      </Section>
      <p className="-mt-3 text-xs text-subtle">能登录这个系统账号的人都有完全控制权；所有者只说明设备归谁。</p>
    </>
  );
}

// ---- B: one host ----

function HostPicker({ host, setHost }: { host: HostId; setHost(h: HostId): void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative">
      <button type="button" onClick={() => setOpen(!open)} className="inline-flex items-center gap-0.5 rounded px-1 hover:bg-accent/15">
        {host}
        <ChevronDown size={11} />
      </button>
      {open && (
        <span className="absolute top-6 left-0 z-10 flex w-36 flex-col rounded-lg border border-border bg-raised p-1 shadow-lg">
          {HOSTS.map((h) => (
            <button key={h.id} type="button" onClick={() => (setHost(h.id), setOpen(false))} className={`rounded px-2 py-1 text-left text-xs ${h.id === host ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"}`}>
              {h.id}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

function HostB({ host, setHost }: { host: HostId; setHost(h: HostId): void }) {
  const h = HOSTS.find((x) => x.id === host)!;
  const local = !!h.self;
  return (
    <>
      <Header hint="所选主机的所有者，以及谁对它有完全控制权。" tags={T.host(<HostPicker host={host} setHost={setHost} />)} />
      <Section title="所有者" hint="每台主机只有一个所有者，就是一个本地身份。">
        {h.owner ? (
          <div className="-mx-4 flex items-center gap-3 px-4 py-3">
            <Avatar name={h.owner.name} you={h.owner.you} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-sm">
                {h.owner.name}
                {h.owner.you && T.you}
                <span className="inline-flex items-center gap-0.5 text-[11px] text-ok-text"><ShieldCheck size={11} />已确认</span>
              </div>
              <div className="text-xs text-subtle">
                <span className="font-mono">{h.owner.fp}</span> · {h.owner.source} · {h.owner.when}
              </div>
            </div>
          </div>
        ) : (
          <div className="-mx-4 flex items-center gap-3 px-4 py-3">
            <span className="text-sm text-warn-text">还没有确认所有者</span>
            <span className="text-xs text-subtle">只能在 {h.id} 本机确认</span>
          </div>
        )}
      </Section>
      <Section title="你的权限">
        <SettingRow label={h.rights} hint={h.rights === "完全控制" ? `${h.via === "本机" ? "来自本机" : `来自 ${h.via.replace("SSH：", "SSH 登录 ")}`}；能登录这个系统账号就能完全控制它` : "由所有者授权；可以在「主机 → 用户」里看到具体授权"}>
          {h.via.startsWith("SSH") && !h.owner?.you && <Button onClick={() => {}}>改为以成员身份连接</Button>}
        </SettingRow>
      </Section>
      <Section title="有完全控制权的身份" hint="用过这台主机 root 凭据的身份：本机，或经 SSH 登录这个系统账号。除了所有者，其他身份都不改变设备归属。" actions={T.backend}>
        {h.owner && (
          <div className="-mx-4 flex items-center gap-3 border-b border-border px-4 py-2.5">
            <Avatar name={h.owner.name} you={h.owner.you} />
            <span className="flex-1 text-sm">{h.owner.name}</span>
            <span className="text-xs text-subtle">所有者 · 本机</span>
          </div>
        )}
        {h.id === "hachimi" && (
          <div className="-mx-4 flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0">
            <Avatar name="Sam" you />
            <span className="flex flex-1 items-center gap-1.5 text-sm">Sam{T.you}</span>
            <span className="text-xs text-subtle">经 SSH 登录 ema@hachimi · 今天 17:10</span>
          </div>
        )}
        {h.id === "host-a" && (
          <div className="-mx-4 flex items-center gap-3 px-4 py-2.5">
            <Avatar name="a" />
            <span className="flex-1 text-sm">alex 的笔记本</span>
            <span className="text-xs text-subtle">经 SSH 登录 sam@host-a · 10-17</span>
          </div>
        )}
      </Section>
      <Section title="更换所有者" hint="把这台主机的所有者换成另一个本地身份。原所有者的完全控制权不变。">
        {local ? (
          <>
            <SettingRow label="新所有者" hint="从有完全控制权的身份里选，或粘贴对方的公钥">
              <span className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs text-muted">选择身份 <ChevronDown size={12} /></span>
            </SettingRow>
            <SettingRow label="恢复为未确认" hint="下一个在本机认领的身份成为所有者">
              <Button onClick={() => {}}>恢复</Button>
            </SettingRow>
          </>
        ) : (
          <p className="py-3 text-xs text-subtle">只能在 {h.id} 本机更换所有者（在那台电脑上打开 Cutex，或运行 cutex human owner set-person）。</p>
        )}
      </Section>
    </>
  );
}

// ---- C: 设备 rows ----

function RowsC() {
  const row = (h: MockHost, text: ReactNode) => (
    <div key={h.id} className="-mx-4 flex items-center gap-2 border-b border-border px-4 py-2.5 last:border-b-0">
      <span className="text-sm">{h.id}</span>
      {h.self && T.self}
      <span className="min-w-0 truncate text-xs text-subtle">{text}</span>
      <span className="ml-auto text-xs text-ok-text">在线</span>
      <ChevronRight size={14} className="text-subtle" />
    </div>
  );
  return (
    <>
      <Section title="C1：设备页的行（所有者 + 你的权限）" hint="「我的设备」不写所有者（都是你），「我能访问的设备」写出所有者。">
        {HOSTS.filter((h) => h.owner?.you).map((h) => row(h, `${h.via} · 完全控制`))}
        <div className="-mx-4 border-b border-border/70 bg-win px-4 py-1 text-[11px] text-subtle">我能访问的设备</div>
        {HOSTS.filter((h) => !h.owner?.you).map((h) => row(h, `${h.owner ? `所有者 ${h.owner.name}` : "所有者未确认"} · ${h.via} · ${h.rights}`))}
      </Section>
    </>
  );
}

const NAV = ["你", "设备", "主机", "所有者", "网络代理"] as const;

export function OwnerTopic() {
  const q = new URLSearchParams(location.search);
  const [variant, setVariant] = useState<"a" | "b" | "c">((q.get("v") as "a" | "b" | "c" | null) ?? "a");
  const [host, setHost] = useState<HostId>((q.get("h") as HostId | null) ?? "hachimi");
  const open = (h: HostId) => (setHost(h), setVariant("b"));
  return (
    <>
      <ul className="my-4 list-disc space-y-0.5 rounded-xl border border-border bg-surface px-8 py-3 text-xs text-muted">
        {NOTES.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <div className="mb-3 flex items-center gap-3 text-xs text-muted">
        <Segmented
          value={variant}
          options={[
            { value: "a" as const, label: "A 总览" },
            { value: "b" as const, label: "B 按主机" },
            { value: "c" as const, label: "C 设备页的行" },
          ]}
          onChange={setVariant}
        />
        {variant === "a" && <span>点一行（或「更换…」）进入 B</span>}
      </div>
      <div className="flex items-start rounded-xl border border-border bg-background">
        <nav className="sticky top-0 w-36 shrink-0 self-start border-r border-border/60 p-2">
          <div className="px-2 pt-1 pb-1.5 text-[11px] text-subtle">连接</div>
          {NAV.map((n) => (
            <div key={n} className={`rounded-md px-2 py-1.5 text-sm ${(variant === "c" ? n === "设备" : n === "所有者") ? "bg-surface-2 font-medium text-foreground" : "text-muted"}`}>
              {n}
            </div>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          <div className="border-b border-border/60 px-4 py-2 text-sm text-muted">设置 › 连接 › <span className="font-semibold text-foreground">{variant === "c" ? "设备" : "所有者"}</span></div>
          <div className="mx-auto max-w-[760px] px-5 py-5">{variant === "a" ? <OverviewA open={open} /> : variant === "b" ? <HostB host={host} setHost={setHost} /> : <RowsC />}</div>
        </div>
      </div>
    </>
  );
}
