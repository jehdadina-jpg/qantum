import { ArrowRight, CaretDown, Check as CheckIcon, WarningCircle } from "@phosphor-icons/react";
import * as RadixSelect from "@radix-ui/react-select";
import { useState, type CSSProperties, type ReactNode } from "react";
import type { RunHeader } from "../lib/api";
import { dateTime, shortHash } from "../lib/format";
import { useRise, useSlidingPill } from "../lib/motion";
import { Value } from "./Digits";

export function Panel({
  title,
  aside,
  children,
  className = "",
  bodyClassName = "",
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const ref = useRise<HTMLElement>();
  return (
    <section ref={ref} className={`glass rise flex min-w-0 flex-col ${className}`}>
      {title !== undefined && (
        <header className="flex min-h-10 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3.5 pt-2.5 pb-2">
          <h2 className="label !text-text">{title}</h2>
          {aside && <div className="mono-tight text-[11px] text-dim tnum">{aside}</div>}
        </header>
      )}
      <div className="relative min-h-0 flex-1">
        <div className={bodyClassName}>{children}</div>
      </div>
    </section>
  );
}

export function Stat({ label, value, tone, hint }: { label: string; value: ReactNode; tone?: "em" | "gold" | "loss"; hint?: ReactNode }) {
  const color = tone === "em" ? "text-em" : tone === "gold" ? "text-gold" : tone === "loss" ? "text-loss" : "text-text";
  return (
    <div className="relative min-w-0">
      <div className="label">{label}</div>
      <div className={`mono-tight mt-2 text-[26px] leading-[1.1] font-medium !tracking-[-0.03em] break-words tnum ${color}`}>
        {typeof value === "string" || typeof value === "number" ? <Value value={value} /> : value}
      </div>
      {hint && <div className="mt-1.5 text-[11.5px] leading-snug text-dim">{hint}</div>}
    </div>
  );
}

export function Field({ label, value, children, hint }: { label: string; value?: ReactNode; children: ReactNode; hint?: string }) {
  return (
    <div className="block">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] text-dim">{label}</span>
        {value !== undefined && <span className="mono-tight text-[12px] text-text tnum">{value}</span>}
      </span>
      <span className="mt-1 block">{children}</span>
      {hint && <span className="mt-1.5 block text-[11.5px] leading-snug text-faint">{hint}</span>}
    </div>
  );
}

export function Slider({ value, onChange, min, max, step = 1, label }: { value: number; onChange: (value: number) => void; min: number; max: number; step?: number; label?: string }) {
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      aria-label={label}
      className="range"
      style={{ "--fill": `${fill}%` } as CSSProperties}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}

export function Select<T extends string>({ value, onChange, options }: { value: T; onChange: (value: T) => void; options: { value: T; label: string; disabled?: boolean }[] }) {
  const usable = options.filter((option) => option.value !== "");
  if (usable.length === 0) {
    return <div className="flex h-9 items-center bg-white/[0.05] px-3 text-[12.5px] text-dim">{options[0]?.label ?? "None"}</div>;
  }
  return (
    <RadixSelect.Root value={value || undefined} onValueChange={(next) => onChange(next as T)}>
      <RadixSelect.Trigger className="group flex h-9 w-full min-w-0 items-center justify-between gap-2 bg-transparent px-3 text-left text-[12.5px] text-text shadow-[inset_0_0_0_1px_var(--color-line-strong)] transition-colors duration-100 outline-none hover:bg-white/[0.06] focus-visible:shadow-[inset_0_0_0_2px_var(--color-em)] data-[state=open]:bg-white/[0.06]">
        <span className="min-w-0 truncate">
          <RadixSelect.Value placeholder="Select" />
        </span>
        <RadixSelect.Icon>
          <CaretDown size={12} className="caret shrink-0 text-dim group-data-[state=open]:-scale-y-100" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className="menu z-50 max-h-[min(340px,var(--radix-select-content-available-height))] w-[var(--radix-select-trigger-width)] min-w-44 overflow-hidden bg-[#0c0f0e] shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
        >
          <RadixSelect.Viewport className="p-px">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-[12.5px] text-dim outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40 data-[highlighted]:bg-em data-[highlighted]:text-ink data-[state=checked]:text-text data-[highlighted]:data-[state=checked]:text-ink"
              >
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator>
                  <CheckIcon size={12} weight="bold" />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

export function NumberInput({ value, onChange, min, max, step }: { value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(event) => onChange(Number(event.target.value))}
      className="mono-tight h-9 w-full bg-transparent px-3 text-[12px] text-text shadow-[inset_0_0_0_1px_var(--color-line-strong)] transition-colors duration-100 tnum outline-none hover:bg-white/[0.06] focus-visible:shadow-[inset_0_0_0_2px_var(--color-em)]"
    />
  );
}

/** Mutually exclusive options with a block that slides to the active choice. */
export function Segmented<T extends string | number>({ value, onChange, options }: { value: T; onChange: (value: T) => void; options: { value: T; label: string }[] }) {
  const { container, pill } = useSlidingPill<HTMLDivElement>('[aria-selected="true"]', value);
  return (
    <div className="inline-flex max-w-full overflow-x-auto shadow-[inset_0_0_0_1px_var(--color-line-strong)] [scrollbar-width:none]">
      <div ref={container} role="tablist" className="relative flex">
        <span ref={pill} className="pill bg-em" />
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={String(option.value)}
              role="tab"
              aria-selected={active}
              onClick={() => onChange(option.value)}
              className={`relative h-10 px-3 text-[11.5px] md:h-7 font-medium whitespace-nowrap transition-colors duration-100 ${active ? "text-ink" : "text-dim hover:text-text"}`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Check({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-2 text-[12.5px] text-dim select-none md:py-0">
      {label}
      <span className={`relative h-[18px] w-[34px] shrink-0 transition-colors duration-100 ${checked ? "bg-em" : "bg-white/[0.16]"}`}>
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="peer absolute inset-0 cursor-pointer opacity-0" />
        <span className={`toggle-thumb absolute top-[3px] left-[3px] size-3 ${checked ? "translate-x-4 bg-ink" : "bg-text"}`} />
      </span>
    </label>
  );
}

/** Collapsible group for dense control rails. Opens instantly, then its contents settle in. */
export function Group({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-line first:border-t-0">
      <button aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between py-2.5 text-left">
        <span className="label !text-text">{title}</span>
        <CaretDown size={12} className={`caret text-dim ${open ? "-scale-y-100" : ""}`} />
      </button>
      {open && <div className="stat-enter grid gap-3 pt-0.5 pb-3.5">{children}</div>}
    </div>
  );
}

export function RunButton({ children, onClick, busy, disabled }: { children: ReactNode; onClick: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={busy || disabled} className="fill-button press group flex h-11 w-full items-center justify-between px-4 text-[13px] font-bold disabled:cursor-not-allowed">
      <span className={busy ? "breathe-text" : ""}>{children}</span>
      <ArrowRight size={16} weight="bold" className="nudge" />
    </button>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="stat-enter flex items-start gap-2.5 bg-loss/10 px-3.5 py-2.5 text-[12.5px] leading-snug text-text shadow-[inset_0_0_0_1px_var(--color-loss)]">
      <WarningCircle size={16} className="mt-px shrink-0 text-loss" />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex h-full min-h-44 flex-col items-center justify-center gap-1.5 px-6 py-10 text-center">
      <p className="text-[14px] font-semibold text-text">{title}</p>
      {children && <p className="max-w-[46ch] text-[12.5px] leading-relaxed text-dim">{children}</p>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <h1 className="display text-[clamp(1.9rem,3.6vw,3.25rem)] leading-[1]">{title}</h1>
      {children}
    </div>
  );
}

/** Which stored record is on screen. Every chart on a page comes from this one run. */
export function RunBar({ run, runs, active, onSelect }: { run: RunHeader | null; runs: RunHeader[]; active: RunHeader | null; onSelect: (id: string) => void }) {
  const finished = runs.filter((r) => r.status === "finished" || r.status === "failed");
  const ref = useRise<HTMLDivElement>();
  const progress = active?.progress ?? 0;
  return (
    <div ref={ref} className="glass rise mb-2">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 p-2">
        <div className="min-w-[220px] flex-1">
          <span className="sr-only">Stored run</span>
          <Select
            value={run?.id ?? ""}
            onChange={onSelect}
            options={finished.length ? finished.map((r) => ({ value: r.id, label: `${r.status === "failed" ? "Failed: " : ""}${r.title}` })) : [{ value: "", label: "No stored runs yet" }]}
          />
        </div>
        {run && (
          <dl className="mono-tight flex flex-wrap gap-x-5 gap-y-1 pr-2 text-[11px] text-dim tnum">
            <div>
              <dt className="sr-only">Created</dt>
              <dd>{dateTime(run.created_at)}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt>data</dt>
              <dd className="text-text">{shortHash(run.data_hash)}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt>qiskit</dt>
              <dd className="text-text">{run.versions?.qiskit ?? "n/a"}</dd>
            </div>
          </dl>
        )}
      </div>
      {active && (
        <div className="stat-enter px-3.5 pb-3">
          <div className="flex items-center justify-between gap-4 text-[12.5px]">
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="live-dot size-1.5 shrink-0 bg-em" />
              <span className="truncate font-medium text-text">{active.title}</span>
              <span className="truncate text-dim">{active.message ?? "Queued"}</span>
            </span>
            <span className="mono-tight text-[11px] text-dim tnum">{Math.round(progress * 100)}%</span>
          </div>
          <div className="mt-2 h-[2px] overflow-hidden bg-white/[0.12]">
            <div className="h-full origin-left bg-em transition-transform duration-500 ease-out" style={{ transform: `scaleX(${progress})` }} />
          </div>
        </div>
      )}
    </div>
  );
}

export function Th({ children, align = "right" }: { children?: ReactNode; align?: "left" | "right" }) {
  return (
    <th className={`sticky top-0 z-[1] bg-panel px-3.5 py-2 font-medium whitespace-nowrap ${align === "left" ? "text-left" : "text-right"}`}>
      <span className="label">{children}</span>
    </th>
  );
}

export function Td({ children, align = "right", className = "" }: { children?: ReactNode; align?: "left" | "right"; className?: string }) {
  return <td className={`px-3.5 py-1.5 whitespace-nowrap ${align === "left" ? "text-left text-[13px]" : "mono-tight text-right text-[12px] tnum"} ${className}`}>{children}</td>;
}
