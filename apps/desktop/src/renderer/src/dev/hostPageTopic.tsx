// Variants topic 「连接：你 · 主机 · 网络代理」 (dev preview only, owner 2026-10-19): 连接 in three pages. 你 is
// you as a user (across hosts); 主机 is one page per host — 主人 (who it belongs to), 你的权限 (what you can
// do, and from where), 连接, 用户, 登录设备, 别的主机, 接入方式. A: the host list on top of the page (grouped,
// 添加主机; click = show that host below); B: the host only in the header picker, the multi-host desktop
// settings moved to 通用. Mock data only.
import { useState, type ReactNode } from "react";
import { ChevronDown, Copy, Laptop, Monitor, Plus, Server, ShieldCheck, Smartphone } from "lucide-react";
import { Button, Section, Segmented, SettingRow, Toggle } from "../components/settings/Form";

const CHIP = "inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] whitespace-nowrap";
const T = {
  local: <span className={`${CHIP} bg-surface-2 text-muted`}><Monitor size={11} />本地桌面应用</span>,
  mixed: <span className={`${CHIP} bg-surface-2 text-muted`}>混合设置</span>,
  host: (picker: ReactNode) => <span className={`${CHIP} bg-accent/12 pr-0.5 text-accent`}><Server size={11} />cutex 后端 ·{picker}</span>,
  self: <span className={`${CHIP} bg-accent/12 text-accent`}>此设备</span>,
  you: <span className={`${CHIP} bg-accent/12 text-accent`}>你</span>,
  full: <span className={`${CHIP} bg-surface-2 text-muted`}>完全控制</span>,
  granted: <span className={`${CHIP} border border-border text-muted`}>按授权</span>,
  pending: <span className={`${CHIP} bg-warn/15 text-warn-text`}>等待分配</span>,
};

type HostId = "host-a" | "host-b" | "hachimi" | "lab-gpu";
interface MockHost {
  id: HostId;
  self?: boolean;
  owner: { name: string; fp: string; you?: boolean } | null;
  rights: "full" | "granted";
  via: string;
  online: boolean;
}
const HOSTS: MockHost[] = [
  { id: "host-a", self: true, owner: { name: "Sam", fp: "9f3a 61c2 0b7e d415", you: true }, rights: "full", via: "本机", online: true },
  { id: "host-b", owner: { name: "Sam", fp: "9f3a 61c2 0b7e d415", you: true }, rights: "full", via: "SSH 登录 sam@host-b", online: true },
  { id: "hachimi", owner: { name: "ema", fp: "41d0 9c8a 77e2 03bf" }, rights: "full", via: "SSH 登录 ema@hachimi", online: true },
  { id: "lab-gpu", owner: { name: "Kai", fp: "07be 2f19 c3a0 5d6e" }, rights: "granted", via: "设备令牌", online: false },
];
const RIGHTS = { full: "完全控制", granted: "按授权" } as const;

const NOTES = [
  "「连接」只剩三页：你 · 主机 · 网络代理。原来的「主机 / 用户 / 接入 / 互联」按单台主机重新分到「主机」和「用户」，按所选主机显示。",
  "主人 = 这台主机归谁（一个本地身份）；你的权限 = 你在上面能做什么，以及权限从哪来。两者分开写。",
  "「设备」只指登录到某台主机的电脑和手机（每台主机各自的令牌），所以卡片叫「登录设备」，页面叫「主机」。",
  "D（最新）：基本单位是主机本身——页头选主机；「主机」只管单台主机，「用户」是那台主机的用户和登录设备；「主机列表」单独一页，是这台电脑的多主机管理（本地桌面应用）。",
  "A：主机列表放在页顶（分组、添加主机），点一台，下面显示它；B：只用页头选择器，分组 / 启动 / 主机标记挪到「通用」；C：在 A 的基础上把「用户」单列一页，登录设备归在各自的用户下面。",
];

function Header({ hint, tags }: { hint?: string; tags: ReactNode }) {
  return (
    <div className="mb-4 space-y-1.5 border-b border-border/60 pb-3">
      {hint && <p className="text-[13px] text-muted">{hint}</p>}
      <div className="flex min-h-6 flex-wrap items-center gap-1.5">{tags}</div>
    </div>
  );
}

const Dot = ({ on }: { on: boolean }) => <span className={`size-1.5 shrink-0 rounded-full ${on ? "bg-ok" : "bg-subtle"}`} />;
const Avatar = ({ name, you }: { name: string; you?: boolean }) => (
  <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ${you ? "bg-accent/20 text-accent" : "bg-surface-2 text-muted"}`}>{name.slice(0, 1)}</span>
);
const Band = ({ children }: { children: ReactNode }) => <div className="-mx-4 border-b border-border/70 bg-win px-4 py-1 text-[11px] text-subtle">{children}</div>;
const Tag = ({ children }: { children: ReactNode }) => <div className="mt-1 flex gap-1.5">{children}</div>;
/** A card hint with the card's tag on its own line under it (混合设置 pages). */
const Hint = ({ text, tag }: { text: string; tag: ReactNode }) => (
  <>
    {text}
    <span className="mt-1.5 flex gap-1.5">{tag}</span>
  </>
);
const HOST_TAG = <span className={`${CHIP} bg-accent/12 text-accent`}><Server size={11} />cutex 后端</span>;

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

// ---- 你 ----

function MePage() {
  return (
    <>
      <Header hint="你的身份，以及你在各主机上的权限。" tags={T.mixed} />
      <Section title="你的身份" hint={<Hint text="身份密钥仅保存在本机。登记为主机的主人时使用此身份。" tag={T.local} />}>
        <SettingRow label="Sam" hint={<span className="font-mono">9f3a 61c2 0b7e d415</span>}>
          <Button onClick={() => {}}><span className="inline-flex items-center gap-1"><Copy size={12} />复制公钥</span></Button>
        </SettingRow>
      </Section>
      <Section title="各主机上的权限" hint={<Hint text="点击主机可打开其设置。" tag={<span className={`${CHIP} bg-accent/12 text-accent`}><Server size={11} />cutex 后端 · 每台主机</span>} />}>
        {HOSTS.map((h) => (
          <div key={h.id} className="-mx-4 flex items-center gap-2 border-b border-border px-4 py-2.5 last:border-b-0">
            <Dot on={h.online} />
            <span className="w-20 text-sm">{h.id}</span>
            <span className="flex-1 text-xs text-muted">主人：{h.owner?.you ? "你" : (h.owner?.name ?? "未确认")}</span>
            <span className="text-xs text-muted">
              {RIGHTS[h.rights]}
              <span className="text-subtle">（{h.via}）</span>
            </span>
            <ChevronDown size={13} className="-rotate-90 text-subtle" />
          </div>
        ))}
      </Section>
    </>
  );
}

// ---- 主机 ----

function HostList({ host, setHost, hint = "运行 cutex 的电脑。选择一台，下方显示其设置。" }: { host: HostId; setHost(h: HostId): void; hint?: string }) {
  const row = (h: MockHost) => (
    <button
      key={h.id}
      type="button"
      onClick={() => setHost(h.id)}
      className={`-mx-4 flex w-[calc(100%+2rem)] items-center gap-2 border-b border-border px-4 py-2 text-left last:border-b-0 ${h.id === host ? "bg-accent/10" : "hover:bg-surface-2/60"}`}
    >
      <Dot on={h.online} />
      <span className={`text-sm ${h.id === host ? "font-medium text-foreground" : ""}`}>{h.id}</span>
      {h.self && <span className={`${CHIP} bg-accent/12 text-accent`}>本机</span>}
      <span className="min-w-0 truncate text-xs text-subtle">{h.owner?.you ? "" : `主人：${h.owner?.name} · `}{RIGHTS[h.rights]}</span>
    </button>
  );
  return (
    <Section
      title="已添加的主机"
      hint={hint}
      actions={<Button onClick={() => {}}><span className="inline-flex items-center gap-1"><Plus size={12} />添加 SSH 主机</span></Button>}
    >
      <Band>我的主机</Band>
      {HOSTS.filter((h) => h.owner?.you).map(row)}
      <Band>可访问的主机</Band>
      {HOSTS.filter((h) => !h.owner?.you).map(row)}
    </Section>
  );
}

/** 主机信息: who it belongs to, then what it is (cutex version, system, address). */
function HostInfoCard({ h }: { h: MockHost }) {
  return (
    <Section title="主机信息" hint={<Hint text="这台主机的主人、版本和地址。每台主机只有一个主人。" tag={HOST_TAG} />}>
      <SettingRow
        label={
          <span className="flex items-center gap-2.5">
            主人
            <span className="flex items-center gap-1.5 text-muted">
              <Avatar name={h.owner!.name} you={h.owner!.you} />
              {h.owner!.name}
              {h.owner!.you && T.you}
              <span className="inline-flex items-center gap-0.5 text-[11px] text-ok-text"><ShieldCheck size={11} />已确认</span>
            </span>
          </span>
        }
        hint={<span className="font-mono">{h.owner!.fp}</span>}
      >
        {h.self || h.via.startsWith("SSH") ? <Button onClick={() => {}}>更换主人…</Button> : <span className="text-xs text-subtle">需通过 SSH 连接才能更换 <button type="button" className="ml-1 text-accent hover:underline">改用 SSH 连接…</button></span>}
      </SettingRow>
      <SettingRow label="cutex 版本"><span className="font-mono text-xs text-muted">{h.online ? "r245 · 0.1.5" : "r240 · 0.1.4（上次连接时）"}</span></SettingRow>
      <SettingRow label="系统"><span className="text-xs text-muted">{h.self ? "Windows 11" : "Linux · Ubuntu 24.04"}</span></SettingRow>
      <SettingRow label="监听地址" hint="通过设备令牌连接时只读">
        <span className="font-mono text-xs text-muted">127.0.0.1:24270 · Tailscale 100.64.0.7</span>
      </SettingRow>
    </Section>
  );
}

function RightsCard({ h, goUsers }: { h: MockHost; goUsers?(): void }) {
  const ssh = h.via.startsWith("SSH");
  return (
    <Section title="你的权限" hint={<Hint text="你在这台主机上可以执行的操作。" tag={HOST_TAG} />}>
      <SettingRow label={RIGHTS[h.rights]} hint={h.rights === "full" ? (h.via === "本机" ? "通过本机登录获得" : `通过 ${h.via} 获得；可登录该系统账号者均拥有完全控制`) : `由 ${h.owner?.name} 授予：全部项目 · 发消息`}>
        <span className="flex gap-1.5">
          {ssh && !h.owner?.you && <Button onClick={() => {}}>改为以成员身份连接</Button>}
          {goUsers && h.rights === "full" && <Button onClick={goUsers}>管理用户</Button>}
        </span>
      </SettingRow>
    </Section>
  );
}

/** 本地桌面应用连接: how this computer reaches the host (the desktop's side). */
function ConnectionCard({ h }: { h: MockHost }) {
  const how = h.self ? "本机" : h.via === "设备令牌" ? "设备令牌" : h.via.replace("SSH 登录 ", "SSH：");
  return (
    <Section title="本地桌面应用连接" hint={<Hint text="这台电脑连接这台主机的方式。" tag={T.local} />}>
      <SettingRow label={how} hint={h.self ? "直接连接本机的 cutex" : h.via === "设备令牌" ? "lab-gpu.tail-net:24270 · 使用配对时领取的令牌" : "经 SSH 隧道连接 127.0.0.1:24270"}>
        <span className="flex gap-1.5">
          <Button onClick={() => {}}>测试</Button>
          {!h.self && <Button onClick={() => {}}>编辑</Button>}
          <Button onClick={() => {}}>{h.online ? "断开" : "连接"}</Button>
        </span>
      </SettingRow>
      <SettingRow label="状态">
        <span className={`text-xs ${h.online ? "text-ok-text" : "text-subtle"}`}>{h.online ? "在线" : "未连接 · 上次连接：昨天 15:14"}</span>
      </SettingRow>
      <SettingRow label="自动连接" hint="启动应用时连接这台主机">
        <Toggle checked={h.online} onChange={() => {}} />
      </SettingRow>
    </Section>
  );
}

/** 主机互联: other cutex hosts connected to this one (adding one needs this host's own machine). */
function ManageCards({ h, noUsers }: { h: MockHost; noUsers?: boolean }) {
  if (h.rights !== "full")
    return <div className="mb-6 rounded-xl border border-border bg-surface-2/50 px-4 py-3 text-sm text-muted">{noUsers ? "主机互联" : "用户、登录设备和主机互联"}由 {h.owner?.name} 管理。</div>;
  return (
    <>
      {!noUsers && <UsersCards h={h} />}
      <Section
        title="主机互联"
        hint={<Hint text="与这台主机互联的其他 cutex 主机，可以互相委托任务。权限取决于绑定的用户，在「用户」中设置。" tag={HOST_TAG} />}
        actions={h.self || h.via.startsWith("SSH") ? <Button onClick={() => {}}><span className="inline-flex items-center gap-1"><Plus size={12} />添加互联主机</span></Button> : undefined}
      >
        <SettingRow label={h.id === "host-b" ? "host-a" : "host-b"} hint="绑定用户：Sam · 上次委托：今天 16:40">
          <span className="flex items-center gap-2 text-xs text-muted">接收委托<Toggle checked onChange={() => {}} /></span>
        </SettingRow>
        {!h.self && !h.via.startsWith("SSH") && <p className="py-2.5 text-xs text-subtle">通过设备令牌连接时无法添加互联主机。<button type="button" className="ml-1 text-accent hover:underline">改用 SSH 连接…</button></p>}
      </Section>
    </>
  );
}


function UsersCards({ h }: { h: MockHost }) {
  const users = usersOn(h).map((u) => [u.name, grantText(u), !!u.you] as const);
  return (
    <>
      <Section title="用户" hint="谁能用这台主机。每台登录设备都属于一个用户，权限跟着用户走。" actions={<Button onClick={() => {}}><span className="inline-flex items-center gap-1"><Plus size={12} />新建用户</span></Button>}>
        {users.map(([name, what, you]) => (
          <div key={name as string} className="-mx-4 flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0">
            <Avatar name={name as string} you={you as boolean} />
            <span className="flex flex-1 items-center gap-1.5 text-sm">{name}{you && T.you}</span>
            <span className="text-xs text-muted">{what}</span>
          </div>
        ))}
      </Section>
      <Section title="登录设备" hint="在这台主机上领了令牌的电脑和手机。">
        {[[<Laptop key="l" size={14} />, "host-a", "Sam", true], [<Smartphone key="p" size={14} />, "iPhone", "Sam", false], [<Laptop key="m" size={14} />, "Mia 的 MacBook", "等待分配", false]].map(([icon, name, who, self]) => (
          <div key={name as string} className="-mx-4 flex items-center gap-2 border-b border-border px-4 py-2.5 last:border-b-0">
            <span className="text-muted">{icon}</span>
            <span className="text-sm">{name}</span>
            {self && T.self}
            <span className="ml-auto text-xs text-muted">{who}</span>
          </div>
        ))}
      </Section>
    </>
  );
}

interface MockUser {
  name: string;
  you?: boolean;
  /** The host's root account: local and SSH logins act as it; always full control. */
  root?: boolean;
  projects: "all" | string[];
  send: boolean;
  delegate: boolean;
  devices: [ReactNode, string, boolean][];
  peers?: string[];
}
const PROJECTS = ["cutex", "cutex-desktop", "personas", "notes"];
function usersOn(h: MockHost): MockUser[] {
  const laptop = (n: string, self = false): [ReactNode, string, boolean] => [<Laptop key={n} size={13} />, n, self];
  const phone = (n: string): [ReactNode, string, boolean] => [<Smartphone key={n} size={13} />, n, false];
  if (h.id === "hachimi")
    return [
      { name: "ema", root: true, projects: "all", send: true, delegate: true, devices: [laptop("ema 的 ThinkPad")] },
      { name: "Mia", projects: ["cutex"], send: true, delegate: false, devices: [laptop("Mia 的 MacBook")] },
      { name: "Sam", you: true, projects: ["cutex", "cutex-desktop"], send: true, delegate: true, devices: [], peers: ["host-a"] },
    ];
  return [
    { name: "Sam", you: true, root: true, projects: "all", send: true, delegate: true, devices: [laptop("host-a", h.id === "host-a"), phone("iPhone")] },
    { name: "Kai", projects: "all", send: true, delegate: false, devices: [laptop("Kai 的 XPS")], peers: ["lab-gpu"] },
    { name: "Mia", projects: ["cutex"], send: false, delegate: false, devices: [laptop("Mia 的 MacBook")] },
  ];
}
const grantText = (u: MockUser) => (u.root ? "完全控制" : `${u.projects === "all" ? "全部项目" : `${u.projects.length} 个项目`}${u.send ? " · 发消息" : ""}${u.delegate ? " · 委托任务" : ""}`);

function Banner({ children }: { children: ReactNode }) {
  return <div className="mb-6 rounded-xl border border-border bg-surface-2/50 px-4 py-3 text-sm text-muted">{children}</div>;
}

function UserDetail({ h, u, back }: { h: MockHost; u: MockUser; back(): void }) {
  const [all, setAll] = useState(u.projects === "all");
  const [picked, setPicked] = useState<string[]>(u.projects === "all" ? [] : u.projects);
  const [send, setSend] = useState(u.send);
  const [delegate, setDelegate] = useState(u.delegate);
  return (
    <>
      <button type="button" onClick={back} className="mb-2 text-xs text-accent hover:underline">‹ 所有用户</button>
      <div className="mb-5 flex items-center gap-3">
        <Avatar name={u.name} you={u.you} />
        <span className="flex items-center gap-1.5 text-base font-medium">{u.name}{u.you && T.you}{u.root && T.full}</span>
        <span className="text-xs text-subtle">{h.id} 的用户</span>
      </div>
      <Section title="权限" hint={u.root ? "本机和 SSH 登录使用此账号。" : "适用于该用户的登录设备和互联的主机。"}>
        {u.root ? (
          <SettingRow label="完全控制" hint="可登录该系统账号者均拥有完全控制，无法在此修改">
            <span className="text-xs text-subtle">只读</span>
          </SettingRow>
        ) : (
          <>
            <SettingRow label="项目" hint="可访问的项目">
              <Segmented value={all ? "all" : "some"} options={[{ value: "all" as const, label: "全部项目" }, { value: "some" as const, label: "选定项目" }]} onChange={(v) => setAll(v === "all")} />
            </SettingRow>
            {!all && (
              <div className="-mx-4 flex flex-wrap gap-1.5 border-b border-border/60 px-4 py-2.5">
                {PROJECTS.map((p) => (
                  <button key={p} type="button" onClick={() => setPicked((x) => (x.includes(p) ? x.filter((y) => y !== p) : [...x, p]))} className={`rounded-md px-2 py-0.5 text-xs ${picked.includes(p) ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted"}`}>
                    {p}
                  </button>
                ))}
              </div>
            )}
            <SettingRow label="发消息" hint="在可访问的项目中与智能体对话">
              <Toggle checked={send} onChange={setSend} />
            </SettingRow>
            <SettingRow label="委托任务" hint="向可访问项目中的智能体委托任务">
              <Toggle checked={delegate} onChange={setDelegate} />
            </SettingRow>
          </>
        )}
      </Section>
      <Section title="登录设备" hint="该用户在这台主机上配对的电脑和手机。">
        {u.devices.length === 0 && <p className="py-3 text-xs text-subtle">{u.you ? "你当前通过 SSH 以 root 账号连接，未使用此用户。改为以成员身份连接后，本机将显示在这里。" : "暂无登录设备"}</p>}
        {u.devices.map(([icon, name, self]) => (
          <SettingRow key={name} label={<span className="inline-flex items-center gap-2">{icon}{name}{self && T.self}</span>}>
            <span className="flex gap-1.5">
              <Button onClick={() => {}}>重命名</Button>
              {!self && <Button onClick={() => {}}>吊销</Button>}
            </span>
          </SettingRow>
        ))}
      </Section>
      {!u.root && (
        <Section title="互联的主机" hint="以该用户的权限与这台主机互联的 cutex 主机。">
          {(u.peers ?? []).length === 0 && <p className="py-3 text-xs text-subtle">暂无</p>}
          {(u.peers ?? []).map((p) => (
            <SettingRow key={p} label={p} hint="接收委托等设置位于「主机 → 主机互联」">
              <Button onClick={() => {}}>解除绑定</Button>
            </SettingRow>
          ))}
        </Section>
      )}
      {!u.root && !u.you && (
        <Section title="删除用户" hint="同时吊销其全部登录设备，并解除与其绑定的互联。">
          <SettingRow label={`删除 ${u.name}`}>
            <button type="button" className="rounded-md border border-danger/50 px-2.5 py-1 text-xs text-danger hover:bg-danger/10">删除…</button>
          </SettingRow>
        </Section>
      )}
    </>
  );
}

function UsersPage({ host, setHost }: { host: HostId; setHost(h: HostId): void }) {
  const h = HOSTS.find((x) => x.id === host)!;
  const [open, setOpen] = useState<string | null>(null);
  const users = usersOn(h);
  const user = users.find((u) => u.name === open);
  const header = <Header hint="所选主机的用户、权限和登录设备。" tags={T.host(<HostPicker host={host} setHost={(x) => (setOpen(null), setHost(x))} />)} />;
  if (h.rights !== "full")
    return (
      <>
        {header}
        <Banner>{host} 的用户由 {h.owner?.name} 管理，此处仅显示你的用户。</Banner>
        <Section title="你的用户">
          <SettingRow label="Sam" hint="按授权 · 全部项目 · 发消息">
            <span className="text-xs text-subtle">只读</span>
          </SettingRow>
          <SettingRow label="登录设备" hint="host-a（此设备）">
            <span className="text-xs text-subtle">只读</span>
          </SettingRow>
        </Section>
      </>
    );
  return (
    <>
      {header}
      {!h.owner?.you && <Banner>你不是 {host} 的主人，但拥有完全控制。此处的修改将作用于 {h.owner?.name} 的主机。</Banner>}
      {user ? (
        <UserDetail key={`${host}-${user.name}`} h={h} u={user} back={() => setOpen(null)} />
      ) : (
        <>
          <Section title="用户" hint="可以使用这台主机的用户。权限按用户设置，点击用户进行修改。" actions={<Button onClick={() => {}}><span className="inline-flex items-center gap-1"><Plus size={12} />新建用户</span></Button>}>
            {users.map((u) => (
              <button key={u.name} type="button" onClick={() => setOpen(u.name)} className="-mx-4 block w-[calc(100%+2rem)] border-b border-border px-4 py-2.5 text-left last:border-b-0 hover:bg-surface-2/60">
                <div className="flex items-center gap-3">
                  <Avatar name={u.name} you={u.you} />
                  <span className="flex flex-1 items-center gap-1.5 text-sm">{u.name}{u.you && T.you}</span>
                  <span className="text-xs text-muted">{grantText(u)}</span>
                  <ChevronDown size={13} className="-rotate-90 text-subtle" />
                </div>
                {u.devices.length > 0 && (
                  <div className="mt-1 ml-10 flex flex-wrap gap-x-3 text-xs text-subtle">
                    {u.devices.map(([icon, dev, self]) => (
                      <span key={dev} className="inline-flex items-center gap-1">{icon}{dev}{self && "（此设备）"}</span>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </Section>
          <Section title="待分配设备" hint="已配对、尚未分配给用户的设备。新设备用配对码配对；通过设备令牌连接时无法生成。" actions={h.self || h.via.startsWith("SSH") ? <Button onClick={() => {}}><span className="inline-flex items-center gap-1"><Plus size={12} />生成配对码</span></Button> : undefined}>
            <SettingRow label="Pixel 9" hint="配对于 10-19 17:02"><Button onClick={() => {}}>分配…</Button></SettingRow>
          </Section>
        </>
      )}
    </>
  );
}

function HostDetail({ h, noUsers, goUsers }: { h: MockHost; noUsers?: boolean; goUsers?(): void }) {
  return (
    <>
      <HostInfoCard h={h} />
      <RightsCard h={h} goUsers={goUsers} />
      <ConnectionCard h={h} />
      <ManageCards h={h} noUsers={noUsers} />
    </>
  );
}

/** D: 主机列表 — the desktop's multi-host page (local): the list, 添加 SSH 主机, groups, startup, marks, diagnostics. */
function HostListPage({ setHost, go }: { setHost(h: HostId): void; go(): void }) {
  return (
    <>
      <Header hint="本机连接的所有主机，以及适用于所有主机的桌面设置。" tags={T.local} />
      <HostList host={"" as HostId} setHost={(h) => (setHost(h), go())} hint="运行 cutex 的电脑。点击一台可打开其「主机」页。" />
      <Section title="分组" hint="在标题栏选择分组后，仅显示组内的主机。" actions={<Button onClick={() => {}}>新建分组</Button>}>
        <SettingRow label="工作" hint="host-a · host-b"><Button onClick={() => {}}>编辑</Button></SettingRow>
      </Section>
      <Section title="视图">
        <SettingRow label="启动时显示" hint="打开应用时显示的主机范围"><Segmented value={"last" as "last" | "local"} options={[{ value: "last", label: "上次的范围" }, { value: "local", label: "本机" }]} onChange={() => {}} /></SettingRow>
        <SettingRow label="单台主机时也显示主机标记" hint="只显示一台主机时，列表中仍显示主机的颜色和名称"><Toggle checked={false} onChange={() => {}} /></SettingRow>
      </Section>
      <Section title="诊断">
        <SettingRow label="能力" hint="当前主机支持的功能">
          <Button onClick={() => {}}>显示列表（141）</Button>
        </SettingRow>
      </Section>
    </>
  );
}

function HostPage({ variant, host, setHost, goUsers }: { variant: "a" | "b" | "c" | "d"; host: HostId; setHost(h: HostId): void; goUsers?(): void }) {
  const h = HOSTS.find((x) => x.id === host)!;
  return (
    <>
      <Header hint={variant === "d" ? "所选主机的信息、你的权限、本地桌面应用连接和主机互联。" : variant !== "b" ? "所有主机，以及所选主机的主人、你的权限和访问。" : "所选主机的主人、你的权限和访问。"} tags={<>{T.mixed}{T.host(<HostPicker host={host} setHost={setHost} />)}</>} />
      {variant !== "b" && variant !== "d" && <HostList host={host} setHost={setHost} />}
      {variant !== "b" && variant !== "d" && <div className="mb-4 flex items-center gap-2 text-sm font-medium"><Server size={14} className="text-muted" />{h.id}</div>}
      <HostDetail h={h} noUsers={variant === "c" || variant === "d"} goUsers={variant === "c" || variant === "d" ? goUsers : undefined} />
      {variant === "d" ? null : variant !== "b" ? (
        <Section title="多台主机" hint="对所有主机生效的桌面设置。">
          <Tag>{T.local}</Tag>
          <SettingRow label="分组" hint="工作 · 2 台"><Button onClick={() => {}}>编辑分组</Button></SettingRow>
          <SettingRow label="启动时的视图"><Segmented value={"last" as "last" | "local"} options={[{ value: "last", label: "上次的范围" }, { value: "local", label: "本机" }]} onChange={() => {}} /></SettingRow>
          <SettingRow label="诊断"><Button onClick={() => {}}>查看</Button></SettingRow>
        </Section>
      ) : (
        <div className="rounded-xl border border-dashed border-border px-4 py-3 text-xs text-subtle">添加主机在页头选择器里；分组、启动时的视图、主机标记、诊断挪到「通用 → 多台主机」。</div>
      )}
    </>
  );
}

type Page = "你" | "主机列表" | "用户" | "主机" | "网络代理";

export function HostPageTopic() {
  const q = new URLSearchParams(location.search);
  const [variant, setVariant] = useState<"a" | "b" | "c" | "d">(q.get("v") === "a" ? "a" : q.get("v") === "b" ? "b" : q.get("v") === "c" ? "c" : "d");
  const NAV: Page[] = variant === "d" ? ["你", "主机列表", "主机", "用户", "网络代理"] : variant === "c" ? ["你", "用户", "主机", "网络代理"] : ["你", "主机", "网络代理"];
  const [page, setPage] = useState<Page>(q.get("p") === "me" ? "你" : "主机");
  const [host, setHost] = useState<HostId>((q.get("h") as HostId | null) ?? "hachimi");
  return (
    <>
      <ul className="my-4 list-disc space-y-0.5 rounded-xl border border-border bg-surface px-8 py-3 text-xs text-muted">
        {NOTES.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <div className="mb-3 flex items-center gap-3 text-xs text-muted">
        <Segmented value={variant} options={[{ value: "a" as const, label: "A 列表在页顶" }, { value: "b" as const, label: "B 只用页头选择器" }, { value: "c" as const, label: "C 用户单列一页" }, { value: "d" as const, label: "D 都按单台主机" }]} onChange={setVariant} />
        <span>左侧可切到「你」；主机可在列表或页头切换</span>
      </div>
      <div className="flex items-start rounded-xl border border-border bg-background">
        <nav className="sticky top-0 w-36 shrink-0 self-start border-r border-border/60 p-2">
          <div className="px-2 pt-1 pb-1.5 text-[11px] text-subtle">连接</div>
          {NAV.map((n) => (
            <button key={n} type="button" onClick={() => n !== "网络代理" && setPage(n)} className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm ${n === page ? "bg-surface-2 font-medium text-foreground" : n === "网络代理" ? "text-subtle" : "text-muted hover:text-foreground"}`}>
              {n}
              {n === "网络代理" && <span className="text-[10px] text-subtle">不变</span>}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          <div className="border-b border-border/60 px-4 py-2 text-sm text-muted">设置 › 连接 › <span className="font-semibold text-foreground">{page}</span></div>
          <div className="mx-auto max-w-[760px] px-5 py-5">{page === "你" ? <MePage /> : page === "主机列表" && variant === "d" ? <HostListPage setHost={setHost} go={() => setPage("主机")} /> : page === "用户" && (variant === "c" || variant === "d") ? <UsersPage host={host} setHost={setHost} /> : <HostPage goUsers={() => setPage("用户")} variant={variant} host={host} setHost={setHost} />}</div>
        </div>
      </div>
    </>
  );
}
