// Variants topic 「连接：新结构」 (dev preview only): the redesigned 连接 group — 你 · 设备管理 ·
// 访问管理 · 网络代理 — drawn with mock data (Sam on host-a; hosts host-a / host-b / hachimi).
// A mini-nav inside the topic switches the mock page. `?p=me|devices|access` opens a page,
// `&h=host-a|host-b|hachimi` picks the 访问管理 host. Mock state only, no prefs.
import { useState, type ReactNode } from "react";
import { Check, ChevronDown, Copy, Laptop, MoreHorizontal, Server, Smartphone, Monitor, Plus } from "lucide-react";
import { Button, LinkRow, ListRow, Section, Segmented, Select, SettingRow, TextField, Toggle } from "../components/settings/Form";

const CHIP = "inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] whitespace-nowrap";
const T = {
  local: <span className={`${CHIP} bg-surface-2 text-muted`}><Monitor size={11} />本地桌面应用</span>,
  host: (picker: ReactNode) => <span className={`${CHIP} bg-accent/12 pr-0.5 text-accent`}><Server size={11} />cutex 后端 ·{picker}</span>,
  self: <span className={`${CHIP} bg-accent/12 text-accent`}>此设备</span>,
  owner: <span className={`${CHIP} bg-surface-2 text-muted`}>主人</span>,
  member: <span className={`${CHIP} border border-border text-muted`}>成员</span>,
};

const MAPPING = [
  "「连接」组改为四页：你 · 设备管理 · 访问管理 · 网络代理。",
  "你 = 现在的「你」+「用户」页里的「你在这台主机上」，并列出你在每台主机上的身份和授权。",
  "设备管理 = 现在的「主机」+ 各主机上归你的设备；设备按主人分组，这台设备标「此设备」。",
  "访问管理 = 现在的「用户」+「接入」+「互联」，按页头选的主机显示：人、设备、别的主机、接入方式。",
  "你在所选主机上不是主人时，访问管理只显示你在那台主机上的身份，不能修改。",
  "网络代理不变。",
];

type PageId = "me" | "devices" | "access" | "proxy";
const NAV: { id: PageId; label: string; off?: boolean }[] = [
  { id: "me", label: "你" },
  { id: "devices", label: "设备管理" },
  { id: "access", label: "访问管理" },
  { id: "proxy", label: "网络代理", off: true },
];

type HostId = "host-a" | "host-b" | "hachimi";
const HOSTS: { id: HostId; os: string; owner: string; self?: boolean }[] = [
  { id: "host-a", os: "Windows", owner: "sam", self: true },
  { id: "host-b", os: "Linux", owner: "sam" },
  { id: "hachimi", os: "Linux", owner: "ema" },
];

function Header({ hint, tags }: { hint?: string; tags: ReactNode }) {
  return (
    <div className="mb-4 space-y-1.5 border-b border-border/60 pb-3">
      {hint && <p className="text-[13px] text-muted">{hint}</p>}
      <div className="flex min-h-6 flex-wrap items-center gap-1.5">{tags}</div>
    </div>
  );
}

const Dot = ({ tone = "ok" }: { tone?: "ok" | "muted" }) => <span className={`size-1.5 shrink-0 rounded-full ${tone === "ok" ? "bg-ok" : "bg-subtle"}`} />;

// ---- 你 ----

// Seeded pseudo-random (mulberry32), so the heatmap is the same on every render / screenshot.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const WEEKS = 52;
const LEVELS = ["bg-surface-2", "bg-accent/25", "bg-accent/45", "bg-accent/70", "bg-accent"];
const HEAT: number[][] = (() => {
  const r = rng(116);
  return Array.from({ length: WEEKS }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      if (w === WEEKS - 1 && d > 1) return -1; // future days of this week
      const busy = 0.35 + 0.5 * (w / WEEKS) + (d >= 5 ? -0.2 : 0);
      const x = r();
      if (x > busy) return 0;
      return Math.min(4, 1 + Math.floor(r() * 4 * (0.5 + w / WEEKS)));
    }),
  );
})();
// Last column = the week of 2026-10-19 (Monday); month labels at the week a month starts.
const MONTHS = (() => {
  const out: { w: number; label: string }[] = [];
  const end = new Date(2026, 9, 19);
  let prev = -1;
  for (let w = 0; w < WEEKS; w++) {
    const d = new Date(end);
    d.setDate(end.getDate() - (WEEKS - 1 - w) * 7);
    if (d.getMonth() !== prev) {
      if (prev !== -1 || d.getDate() <= 7) out.push({ w, label: `${d.getMonth() + 1}月` });
      prev = d.getMonth();
    }
  }
  return out;
})();
const CELL = 10;
const GAP = 3;

function Heatmap() {
  return (
    <div>
      <div className="flex" style={{ gap: GAP }}>
        {HEAT.map((week, w) => (
          <div key={w} className="flex flex-col" style={{ gap: GAP }}>
            {week.map((v, d) => <span key={d} className={`rounded-[2px] ${v < 0 ? "bg-transparent" : LEVELS[v]}`} style={{ width: CELL, height: CELL }} />)}
          </div>
        ))}
      </div>
      <div className="relative mt-1 h-4 text-[10px] text-subtle" style={{ width: WEEKS * (CELL + GAP) - GAP }}>
        {MONTHS.map((m) => <span key={m.w} className="absolute" style={{ left: m.w * (CELL + GAP) }}>{m.label}</span>)}
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-subtle" style={{ width: WEEKS * (CELL + GAP) - GAP }}>
        <span>过去一年 · 每格一天</span>
        <span className="flex items-center gap-1">
          少{LEVELS.map((c) => <span key={c} className={`rounded-[2px] ${c}`} style={{ width: CELL, height: CELL }} />)}多
        </span>
      </div>
    </div>
  );
}

const STATS = [
  { label: "累计 Token", value: "855.9 亿" },
  { label: "最长连续", value: "124 天" },
  { label: "当前连续", value: "18 天" },
  { label: "本月轮次", value: "1,204" },
];

function MePage({ go }: { go(p: PageId, h?: HostId): void }) {
  const [name, setName] = useState("Sam");
  const [copied, setCopied] = useState(false);
  const mine: { id: HostId; grant: string; owner?: string }[] = [
    { id: "host-a", grant: "主人 · 全部项目" },
    { id: "host-b", grant: "主人 · 全部项目" },
    { id: "hachimi", grant: "成员 · 全部项目 · 可以发消息", owner: "ema" },
  ];
  return (
    <>
      <Header tags={T.local} />
      <div className="mb-6 rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent/15 text-lg font-semibold text-accent">森</span>
          <div className="min-w-0">
            <div className="text-base font-semibold">{name}</div>
            <div className="text-xs text-subtle">主人 · 2 台主机</div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-2">
          {STATS.map((s) => (
            <div key={s.label} className="rounded-lg bg-surface-2/60 px-3 py-2">
              <div className="text-[11px] text-subtle">{s.label}</div>
              <div className="mt-0.5 text-base font-semibold tabular-nums">{s.value}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 overflow-x-auto">
          <Heatmap />
        </div>
      </div>
      <Section title="身份">
        <SettingRow label="名字"><TextField value={name} onCommit={setName} /></SettingRow>
        <SettingRow label="头像"><Button onClick={() => {}}>上传图片</Button></SettingRow>
        <SettingRow label="在其他设备上使用这个身份" hint="把身份密钥粘贴到你的另一台设备，主机会认出是你">
          <span className="inline-flex items-center gap-2">
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-muted">116d••••••</code>
            <Button onClick={() => (setCopied(true), setTimeout(() => setCopied(false), 1500))}>
              <span className="inline-flex items-center gap-1">{copied ? <Check size={12} /> : <Copy size={12} />}{copied ? "已复制" : "复制身份密钥"}</span>
            </Button>
          </span>
        </SettingRow>
      </Section>
      <Section title="你在各主机上" hint="你在每台主机上的身份和授权，由那台主机的主人设置。">
        {mine.map((m) => (
          <ListRow
            key={m.id}
            leading={<Server size={15} className="text-subtle" />}
            title={<span className="inline-flex items-center gap-1.5">{m.id}{m.id === "host-a" && T.self}</span>}
            detail={m.owner ? `${m.grant}（主人 ${m.owner}）` : m.grant}
            actions={m.owner ? <span className="text-xs text-subtle">由 {m.owner} 管理</span> : <button onClick={() => go("access", m.id)} className="text-xs text-accent hover:underline">管理访问 →</button>}
          />
        ))}
      </Section>
      <Section>
        <LinkRow label="我的设备" hint="这台设备、你的主机和手机" link="在设备管理里查看 →" onClick={() => go("devices")} />
      </Section>
    </>
  );
}

// ---- 设备管理 ----

interface Machine { name: string; kind: "host" | "phone" | "laptop"; os: string; status: string; self?: boolean; role?: "owner" | "member"; detail?: string; connected?: boolean }

function MachineRow({ m }: { m: Machine }) {
  const [on, setOn] = useState(m.connected ?? false);
  const Icon = m.kind === "host" ? Server : m.kind === "phone" ? Smartphone : Laptop;
  const host = m.kind === "host";
  return (
    <ListRow
      leading={<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted"><Icon size={16} /></span>}
      title={
        <span className="inline-flex items-center gap-1.5">
          <span className="font-medium">{m.name}</span>
          {m.self && T.self}
          {m.role === "owner" ? T.owner : m.role === "member" ? T.member : null}
        </span>
      }
      detail={
        <span className="inline-flex items-center gap-1.5">
          {host ? "主机" : "客户端"} · {m.os}{m.detail ? ` · ${m.detail}` : ""} ·
          <Dot tone={host && !on ? "muted" : "ok"} />{host ? (on ? "已连接" : "未连接") : m.status}
        </span>
      }
      actions={
        host ? (
          <>
            {m.self ? <span className="text-xs text-subtle">本机</span> : <Button onClick={() => setOn(!on)}>{on ? "断开" : "连接"}</Button>}
            <button title="更多" className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-surface-2"><MoreHorizontal size={15} /></button>
          </>
        ) : (
          <Button onClick={() => {}}>重命名</Button>
        )
      }
    />
  );
}

function DevicesPage() {
  const mine: Machine[] = [
    { name: "host-a", kind: "host", os: "Windows", status: "已连接", self: true, role: "owner", connected: true },
    { name: "host-b", kind: "host", os: "Linux", status: "已连接", role: "owner", connected: true },
    { name: "Sam 的手机", kind: "phone", os: "iPhone", status: "已配对到 host-b" },
  ];
  const others: Machine[] = [{ name: "hachimi", kind: "host", os: "Linux", status: "已连接", role: "member", detail: "主人 ema · 你是成员", connected: true }];
  return (
    <>
      <Header hint="你的设备和你能访问的设备，以及这台设备连着哪些主机。" tags={T.local} />
      <p className="mb-5 rounded-lg border border-border/60 bg-surface-2/40 px-3 py-2 text-xs text-muted">
        设备按它的主人分组：主人是你的放在「我的设备」，别人的但你有权限的放在「我能访问的设备」。这台设备标「此设备」。
      </p>
      <Section title="我的设备" hint="主人是 Sam 的设备。">
        {mine.map((m) => <MachineRow key={m.name} m={m} />)}
      </Section>
      <Section title="我能访问的设备" hint="别人的设备，你在上面有权限。">
        {others.map((m) => <MachineRow key={m.name} m={m} />)}
      </Section>
      <Section title="添加">
        <SettingRow label="添加主机" hint="让这台设备连上一台新的 cutex 主机">
          <span className="inline-flex gap-2">
            <Button onClick={() => {}}>通过 SSH 添加主机</Button>
            <Button onClick={() => {}}>用配对码连接</Button>
          </span>
        </SettingRow>
      </Section>
    </>
  );
}

// ---- 访问管理 ----

function HostPicker({ host, setHost }: { host: HostId; setHost(h: HostId): void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button type="button" onClick={() => setOpen(!open)} className="ml-1 inline-flex h-4.5 items-center gap-1 rounded bg-background/70 px-1.5 text-[11px] text-foreground hover:bg-background">
        <Dot />{host}<ChevronDown size={11} className="text-subtle" />
      </button>
      {open && (
        <span className="absolute top-full left-0 z-20 mt-1 w-56 rounded-xl border border-border bg-surface p-1 shadow-xl">
          {HOSTS.map((x) => (
            <button key={x.id} type="button" onClick={() => (setHost(x.id), setOpen(false))} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-foreground hover:bg-surface-2">
              <Dot />{x.id}
              <span className="text-[11px] text-subtle">{x.owner === "sam" ? "主人" : "成员"}{x.self ? " · 此设备" : ""}</span>
              {x.id === host && <Check size={13} className="ml-auto text-accent" />}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

function PersonRow({ name }: { name: string }) {
  const [grant, setGrant] = useState<"all" | "some">("all");
  const [msg, setMsg] = useState(true);
  return (
    <div className="-mx-4 border-b border-border px-4 py-2.5 last:border-b-0">
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs text-muted">{name.slice(0, 1).toUpperCase()}</span>
        <span className="text-sm">{name}</span>{T.member}
        <span className="ml-auto flex items-center gap-3">
          <Segmented value={grant} onChange={setGrant} options={[{ value: "all", label: "全部项目" }, { value: "some", label: "部分项目" }]} />
          <span className="inline-flex items-center gap-1.5 text-xs text-muted">可以发消息<Toggle checked={msg} onChange={setMsg} /></span>
        </span>
      </div>
    </div>
  );
}

function OwnerAccess({ host }: { host: HostId }) {
  const [pending, setPending] = useState("");
  const [hold, setHold] = useState(true);
  const [see, setSee] = useState<"all" | "some" | "none">("none");
  const [deleg, setDeleg] = useState(true);
  const devices = host === "host-b" ? ["host-a", "Sam 的手机"] : ["host-a"];
  return (
    <>
      <Section title="人" hint="能访问这台主机的人和他们的授权。" actions={<Button onClick={() => {}}><span className="inline-flex items-center gap-1"><Plus size={12} />添加用户</span></Button>}>
        <ListRow
          leading={<span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">森</span>}
          title={<span className="inline-flex items-center gap-1.5">Sam{T.owner}</span>}
          detail="全部权限"
        />
        <PersonRow key={host} name="ema" />
      </Section>
      <Section title="设备" hint="连进这台主机的设备，每台设备归一个人。">
        {devices.map((d) => (
          <ListRow
            key={d}
            leading={d === "host-a" ? <Server size={15} className="text-subtle" /> : <Smartphone size={15} className="text-subtle" />}
            title={<span className="inline-flex items-center gap-1.5">{d}{d === "host-a" && T.self}</span>}
            actions={<span className="text-xs text-muted">→ Sam</span>}
          />
        ))}
        <ListRow
          leading={<span className="flex size-[15px] items-center justify-center"><span className="size-2 rounded-full bg-warn" /></span>}
          title="未知设备"
          detail="10 分钟前 · 待分配"
          actions={<Select value={pending} onChange={setPending} options={[{ value: "", label: "分配给…" }, { value: "sam", label: "Sam" }, { value: "ema", label: "ema" }, { value: "reject", label: "拒绝" }]} />}
        />
        <SettingRow label="新设备先待分配" hint="新设备要你分配给某个人后才能使用"><Toggle checked={hold} onChange={setHold} /></SettingRow>
      </Section>
      <Section title="别的主机" hint="和这台主机互联的主机，以及它们能看到什么。" actions={<Button onClick={() => {}}><span className="inline-flex items-center gap-1"><Plus size={12} />邀请主机</span></Button>}>
        <ListRow leading={<Server size={15} className="text-subtle" />} title="hachimi" detail="归属 ema · 已连接" />
        <SettingRow label="它能看到这里的智能体" hint={see === "none" ? <span className="text-warn">对方现在看不到这里的任何智能体</span> : see === "some" ? "只看到你选的项目里的智能体" : "能看到这里的所有智能体"}>
          <Segmented value={see} onChange={setSee} options={[{ value: "all", label: "全部" }, { value: "some", label: "部分" }, { value: "none", label: "不可见" }]} />
        </SettingRow>
        <SettingRow label="接受委托" hint="对方的智能体可以把任务委托给这里"><Toggle checked={deleg} onChange={setDeleg} /></SettingRow>
      </Section>
      <Section title="接入方式" tag={{ label: "高级" }} hint="设备和浏览器从哪里连进这台主机。">
        <SettingRow label="配对码" hint="新设备输入配对码即可连接，10 分钟内有效"><Button onClick={() => {}}>生成配对码</Button></SettingRow>
        <SettingRow label="监听地址">
          <span className="text-right font-mono text-xs leading-5 text-muted">127.0.0.1:24270<br />Tailscale 100.64.0.7:24270</span>
        </SettingRow>
        <SettingRow label="网页访问来源 (CORS)" hint="允许从这些网页地址访问">
          <span className="text-right font-mono text-xs leading-5 text-muted">http://localhost:5173<br />https://cutex.app</span>
        </SettingRow>
      </Section>
    </>
  );
}

function MemberAccess() {
  return (
    <>
      <div className="mb-6 rounded-xl border border-border bg-surface-2/50 px-4 py-3 text-sm text-muted">只有 hachimi 的主人（ema）能管理访问。</div>
      <Section title="你在 hachimi 上">
        <SettingRow label="身份"><span className="inline-flex items-center gap-1.5 text-xs text-muted">{T.member}全部项目 · 可以发消息</span></SettingRow>
        <SettingRow label="你的设备"><span className="text-xs text-muted">host-a</span></SettingRow>
      </Section>
    </>
  );
}

function AccessPage({ host, setHost }: { host: HostId; setHost(h: HostId): void }) {
  const owner = HOSTS.find((h) => h.id === host)?.owner === "sam";
  return (
    <>
      <Header hint="所选主机上：谁能访问、用哪些设备、哪些别的主机能连进来。" tags={T.host(<HostPicker host={host} setHost={setHost} />)} />
      {owner ? <OwnerAccess key={host} host={host} /> : <MemberAccess />}
    </>
  );
}

function ProxyPage() {
  return <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-subtle">网络代理：不变</div>;
}

const TITLES: Record<PageId, string> = { me: "你", devices: "设备管理", access: "访问管理", proxy: "网络代理" };

export function ConnTopic() {
  const q = new URLSearchParams(location.search);
  const p0 = q.get("p");
  const h0 = q.get("h");
  const [page, setPage] = useState<PageId>(p0 === "devices" || p0 === "access" || p0 === "proxy" ? p0 : "me");
  const [host, setHost] = useState<HostId>(h0 === "host-a" || h0 === "hachimi" ? h0 : "host-b");
  const go = (p: PageId, h?: HostId) => (setPage(p), h && setHost(h));
  return (
    <>
      <ul className="my-4 list-disc space-y-0.5 rounded-xl border border-border bg-surface px-8 py-3 text-xs text-muted">
        {MAPPING.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <div className="flex items-start rounded-xl border border-border bg-background">
        <nav className="sticky top-0 w-36 shrink-0 self-start border-r border-border/60 p-2">
          <div className="px-2 pt-1 pb-1.5 text-[11px] text-subtle">连接</div>
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setPage(n.id)}
              className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm ${n.id === page ? "bg-surface-2 font-medium text-foreground" : n.off ? "text-subtle" : "text-muted hover:text-foreground"}`}
            >
              {n.label}
              {n.off && <span className="text-[10px] text-subtle">不变</span>}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          <div className="border-b border-border/60 px-4 py-2 text-sm text-muted">设置 › 连接 › <span className="font-semibold text-foreground">{TITLES[page]}</span></div>
          <div className="mx-auto max-w-[760px] px-5 py-5">
            {page === "me" ? <MePage go={go} /> : page === "devices" ? <DevicesPage /> : page === "access" ? <AccessPage host={host} setHost={setHost} /> : <ProxyPage />}
          </div>
        </div>
      </div>
    </>
  );
}
