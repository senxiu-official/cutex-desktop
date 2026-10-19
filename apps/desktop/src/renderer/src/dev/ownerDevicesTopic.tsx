// Variants topic 「主人的设备」 (dev preview only, owner 2026-10-19; backend: docs/research/
// owner-devices-ui-contract-20261019.md, host-ownership §5): on 连接 → 用户 — the owner's paired devices have
// full control, so new ones are announced (确认 / 吊销); every device has a scope (完全控制 / 对话和查看 / 只查看,
// never above its user's grant); a pairing code for the owner says it gives full control (5 min, once).
// A: notice on top + scope in each device row; B: scope only in the device's detail, rows show it as text.
import { useState, type ReactNode } from "react";
import { Laptop, Plus, ShieldAlert, Smartphone } from "lucide-react";
import { Button, Section, Segmented, Select, SettingRow } from "../components/settings/Form";

const CHIP = "inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] whitespace-nowrap";
type Scope = "full" | "chat" | "read";
const SCOPES: { value: Scope; label: string; title: string }[] = [
  { value: "full", label: "完全控制", title: "和用户本人一样" },
  { value: "chat", label: "对话和查看", title: "可以对话、查看，不能改设置" },
  { value: "read", label: "只查看", title: "只能查看" },
];
const SCOPE_TEXT: Record<Scope, string> = { full: "完全控制", chat: "对话和查看", read: "只查看" };
/** The first tier reads 完全控制 for the owner's devices, 按用户授权 for other users' (it never exceeds the grant). */
const scopeText = (sc: Scope, owner?: boolean) => (sc === "full" && !owner ? "按用户授权" : SCOPE_TEXT[sc]);
const SCOPE_HINT: Record<Scope, string> = { full: "和在主机本机上一样", chat: "能和智能体对话、查看内容；不能批准命令、修改设置、管理用户和设备", read: "只能查看，不能发消息" };

interface Dev {
  id: string;
  name: string;
  phone?: boolean;
  user: string;
  owner?: boolean;
  scope: Scope;
  via: string;
  last: string;
  self?: boolean;
  isNew?: boolean;
}
const DEVICES: Dev[] = [
  { id: "1", name: "host-a", user: "Sam", owner: true, scope: "full", via: " SSH ", last: "刚刚", self: true },
  { id: "2", name: "Sam 的 MacBook Air", user: "Sam", owner: true, scope: "full", via: "配对码", last: "10 分钟前", isNew: true },
  { id: "3", name: "iPhone", phone: true, user: "Sam", owner: true, scope: "chat", via: "配对码", last: "昨天" },
  { id: "4", name: "Kai 的 XPS", user: "Kai", scope: "chat", via: "配对码", last: "2 小时前" },
  { id: "5", name: "Mia 的 MacBook", user: "Mia", scope: "read", via: "配对码", last: "3 天前" },
];

const NOTES = [
  "主人的配对设备拥有完全控制（主人选 A）；更换主人、生成配对码、主机互联等仅可在本机或通过 SSH 进行。",
  "新的主人设备：页面顶部横幅（每台主人设备和主机本机都能看到，设置入口有红点）；× = 是我的设备，确认后不再提醒；不认识就吊销。",
  "项目和授权按用户给；设备使用所属用户的授权，只能在其范围内收窄：完全控制 / 对话和查看 / 只查看。",
  "给主人生成配对码时明确写出后果：5 分钟内有效、只能使用一次、会让设备完全控制这台主机。",
];

function NewOwnerDevice({ d }: { d: Dev }) {
  return (
    <div className="mb-6 flex items-center gap-3 rounded-xl border border-warn/40 bg-warn/10 px-4 py-2.5 text-sm">
      <ShieldAlert size={16} className="shrink-0 text-warn-text" />
      <span className="min-w-0 flex-1">
        新设备以{"主人"}身份连接：<span className="font-medium">{d.name}</span>
        <span className="text-muted"> · 完全控制 · {d.last}</span>
        <span className="text-muted"> · 不是你？</span>
        <button type="button" className="text-danger hover:underline">吊销</button>
      </span>
      <button type="button" title="是我的设备（不再提醒）" className="shrink-0 rounded p-1 text-muted hover:bg-surface-2 hover:text-foreground">✕</button>
    </div>
  );
}

function DeviceRow({ d, variant, open }: { d: Dev; variant: "a" | "b"; open(id: string): void }) {
  const [scope, setScope] = useState<Scope>(d.scope);
  const max: Scope[] = d.user === "Mia" ? ["read"] : d.user === "Kai" ? ["chat", "read"] : ["full", "chat", "read"];
  return (
    <div className="-mx-4 flex items-center gap-2 border-b border-border px-4 py-2.5 last:border-b-0">
      <span className="text-muted">{d.phone ? <Smartphone size={14} /> : <Laptop size={14} />}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm">
          {d.name}
          {d.self && <span className={`${CHIP} bg-accent/12 text-accent`}>此设备</span>}
          {d.isNew && <span className={`${CHIP} bg-warn/15 text-warn-text`}>新设备</span>}
        </div>
        <div className="text-xs text-subtle">
          {d.user} · 通过{d.via}连接 · {d.last}使用
          {variant === "b" && ` · ${scopeText(scope, d.owner)}`}
        </div>
      </div>
      {variant === "a" ? (
        <span title={d.owner ? undefined : `不超过 ${d.user} 的授权`}>
          <Select value={scope} width="w-28" label="设备权限" options={SCOPES.filter((s) => max.includes(s.value))} onChange={(v) => setScope(v as Scope)} />
        </span>
      ) : (
        <Button onClick={() => open(d.id)}>设置…</Button>
      )}
    </div>
  );
}

/** What each user is granted (the device inherits it; its scope can only narrow it). */
const GRANT: Record<string, { projects: string; max: Scope; text: string }> = {
  Sam: { projects: "全部项目", max: "full", text: "主人：完全控制" },
  Kai: { projects: "全部项目", max: "chat", text: "全部项目 · 发消息" },
  Mia: { projects: "cutex", max: "read", text: "1 个项目 · 只读" },
};
const RANK: Record<Scope, number> = { full: 0, chat: 1, read: 2 };

function DeviceDetail({ d, back }: { d: Dev; back(): void }) {
  const [scope, setScope] = useState<Scope>(d.scope);
  const g = GRANT[d.user]!;
  const allowed = SCOPES.filter((x) => RANK[x.value] >= RANK[g.max]).map((x) => ({ ...x, label: scopeText(x.value, d.owner), title: SCOPE_HINT[x.value] }));
  return (
    <>
      <button type="button" onClick={back} className="mb-2 text-xs text-accent hover:underline">‹ 已登录设备</button>
      <Section title={d.name} hint={`${d.user} 的设备 · 通过${d.via}连接 · ${d.last}使用`}>
        <SettingRow label="所属用户" hint="设备使用该用户的授权">
          <span className="flex items-center gap-2 text-xs text-muted">{d.user}<Button onClick={() => {}}>更改…</Button></span>
        </SettingRow>
        <SettingRow label="项目" hint={`跟随 ${d.user} 的授权，在用户详情中修改`}>
          <span className="flex items-center gap-2 text-xs text-muted">{g.projects}<button type="button" className="text-accent hover:underline">查看 {d.user}</button></span>
        </SettingRow>
        <SettingRow label="设备权限" hint={`在 ${d.user} 的授权（${g.text}）范围内，限制这台设备能做什么`}>
          {d.self ? <span className="text-xs text-subtle">完全控制 · 本机连接，不能修改</span> : <Segmented value={scope} options={allowed} onChange={setScope} />}
        </SettingRow>
        <SettingRow label="名称"><Button onClick={() => {}}>重命名</Button></SettingRow>
        <SettingRow label="吊销" hint="这台设备将无法再连接这台主机">
          <button type="button" className="rounded-md border border-danger/50 px-2.5 py-1 text-xs text-danger hover:bg-danger/10">吊销…</button>
        </SettingRow>
      </Section>
    </>
  );
}

function PairingCard() {
  const [forUser, setForUser] = useState("Sam");
  const [scope, setScope] = useState<Scope>("full");
  const [code, setCode] = useState(false);
  const owner = forUser === "Sam";
  const ownerFull = owner && scope === "full";
  return (
    <Section
      title="配对新设备"
      hint="生成一次性配对码，在新设备上输入。仅可在本机或通过 SSH 生成。"
      actions={<Button onClick={() => setCode(true)}><span className="inline-flex items-center gap-1"><Plus size={12} />生成配对码</span></Button>}
    >
      <SettingRow label="分配给" hint="设备使用该用户的授权">
        <Select value={forUser} width="w-32" options={[{ value: "Sam", label: "Sam（主人）" }, { value: "Kai", label: "Kai" }, { value: "Mia", label: "Mia" }]} onChange={setForUser} />
      </SettingRow>
      <div className="-mx-4 border-b border-border/60 px-4 py-2.5">
        <div className="mb-1.5 text-sm">设备权限</div>
        {SCOPES.map((x) => (
          <label key={x.value} className="flex cursor-pointer items-start gap-2 py-1 text-sm">
            <input type="radio" name="pair-scope" checked={scope === x.value} onChange={() => setScope(x.value)} className="mt-1 accent-[var(--color-accent)]" />
            <span>
              {scopeText(x.value, owner)}
              {x.value === "full" && owner && <span className="ml-1 text-xs text-subtle">（主人的默认）</span>}
              <span className="block text-xs text-subtle">{x.value === "full" && !owner ? `和 ${forUser} 的授权一样` : SCOPE_HINT[x.value]}</span>
            </span>
          </label>
        ))}
      </div>
      {ownerFull ? (
        <div className="-mx-4 border-b border-border/60 bg-warn/10 px-4 py-3 text-xs text-warn-text">
          <div className="mb-1 flex items-center gap-1.5 text-sm font-medium"><ShieldAlert size={14} />这个配对码会让设备完全控制 host-a 上的 Cutex。</div>
          <ul className="list-disc space-y-0.5 pl-5">
            <li>智能体可以用这台主机的系统账号运行命令；这台设备能批准这些命令。</li>
            <li>配对码 5 分钟内有效，只能使用一次。</li>
            <li>连接后，你的每台主人设备和 host-a 上都会显示提醒，可以随时吊销。</li>
          </ul>
        </div>
      ) : (
        <p className="py-2 text-xs text-subtle">配对码 10 分钟内有效。</p>
      )}
      {code && (
        <SettingRow label={<span className="font-mono text-base tracking-widest">K7Q-4MX</span>} hint={ownerFull ? "4:52 后失效 · 只能使用一次" : "9:52 后失效"}>
          <Button onClick={() => setCode(false)}>作废</Button>
        </SettingRow>
      )}
    </Section>
  );
}

function UsersPageMock({ variant }: { variant: "a" | "b" }) {
  const [open, setOpen] = useState<string | null>(null);
  const d = DEVICES.find((x) => x.id === open);
  return (
    <>
      <div className="mb-4 space-y-1.5 border-b border-border/60 pb-3">
        <p className="text-[13px] text-muted">所选主机的用户、权限和已登录设备。</p>
        <span className={`${CHIP} bg-accent/12 text-accent`}>cutex 后端 · host-a</span>
      </div>
      {DEVICES.filter((x) => x.isNew).map((x) => <NewOwnerDevice key={x.id} d={x} />)}
      {d ? (
        <DeviceDetail d={d} back={() => setOpen(null)} />
      ) : (
        <>
          <Section title="已登录设备" hint="连接这台主机的电脑和手机。设备权限不超过所属用户的授权。">
            {DEVICES.map((x) => <DeviceRow key={x.id} d={x} variant={variant} open={setOpen} />)}
          </Section>
          <PairingCard />
        </>
      )}
    </>
  );
}

function Wrap({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start rounded-xl border border-border bg-background">
      <nav className="w-36 shrink-0 border-r border-border/60 p-2 text-sm">
        <div className="px-2 pt-1 pb-1.5 text-[11px] text-subtle">连接</div>
        {["你", "主机列表", "主机", "用户", "网络代理"].map((n) => (
          <div key={n} className={`rounded-md px-2 py-1.5 ${n === "用户" ? "bg-surface-2 font-medium text-foreground" : "text-muted"}`}>{n}</div>
        ))}
      </nav>
      <div className="min-w-0 flex-1">
        <div className="border-b border-border/60 px-4 py-2 text-sm text-muted">设置 › 连接 › <span className="font-semibold text-foreground">用户</span></div>
        <div className="mx-auto max-w-[760px] px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

export function OwnerDevicesTopic() {
  const [variant, setVariant] = useState<"a" | "b">(new URLSearchParams(location.search).get("v") === "a" ? "a" : "b");
  return (
    <>
      <ul className="my-4 list-disc space-y-0.5 rounded-xl border border-border bg-surface px-8 py-3 text-xs text-muted">
        {NOTES.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <div className="mb-3 flex items-center gap-3 text-xs text-muted">
        <Segmented value={variant} options={[{ value: "a" as const, label: "A 每行直接选权限" }, { value: "b" as const, label: "B 权限在设备详情里（已选）" }]} onChange={setVariant} />
      </div>
      <Wrap>
        <UsersPageMock key={variant} variant={variant} />
      </Wrap>
    </>
  );
}
