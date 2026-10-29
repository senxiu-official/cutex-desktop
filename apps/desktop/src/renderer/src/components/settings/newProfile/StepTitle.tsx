// 新建 Profile: a numbered step heading (① 服务商 … ⑤ 名称与颜色).
import type { ReactNode } from "react";

export function StepTitle({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="mt-3 mb-1 flex items-center gap-2 text-xs font-semibold text-muted" data-new-profile-step={n}>
      <span className="inline-flex size-[18px] items-center justify-center rounded-full bg-accent text-caption text-on-accent">{n}</span>
      {children}
    </div>
  );
}
