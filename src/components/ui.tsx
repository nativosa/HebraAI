import React from "react";

// Shared styles for the few control types the app uses.

const focus = "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring";

const BUTTON = {
  base: `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${focus}`,
  primary: "border-accent bg-accent text-on-accent hover:enabled:bg-accent-hover hover:enabled:border-accent-hover",
  secondary: "border-line-strong bg-surface text-fg hover:enabled:bg-surface-2",
  ghost: "border-transparent bg-transparent text-muted hover:enabled:bg-surface-2 hover:enabled:text-fg",
  danger: "border-danger-line bg-surface text-danger hover:enabled:bg-danger-soft",
  md: "h-9 px-3.5 text-[13.5px]",
  sm: "h-7.5 px-2.5 text-[12.5px] rounded-md",
  lg: "h-10 px-4 text-sm",
};

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
};

export function Button({ variant = "secondary", size = "md", className = "", type = "button", ...props }: ButtonProps) {
  return <button type={type} className={`${BUTTON.base} ${BUTTON[variant]} ${BUTTON[size]} ${className}`} {...props} />;
}

export const linkButton = `rounded text-[12.5px] font-medium text-accent-fg hover:underline disabled:opacity-45 ${focus}`;

export const inputClass = `w-full rounded-md border border-line-strong bg-surface px-2.5 text-[13.5px] text-fg placeholder:text-faint ${focus} focus-visible:border-accent`;

export function Card({
  title,
  action,
  children,
  className = "",
  ...rest
}: { title?: React.ReactNode; action?: React.ReactNode } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={`rounded-xl border border-line bg-surface shadow-sm ${className}`} {...rest}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-2 px-3.5 pt-3">
          {title && <h2 className="text-xs font-semibold tracking-wider text-muted uppercase">{title}</h2>}
          {action}
        </div>
      )}
      <div className="px-3.5 pt-3 pb-3.5">{children}</div>
    </section>
  );
}

// A checkbox shown as a switch.
export function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span className="text-[13px] font-medium text-fg-2">
        {label} {hint && <span className="font-normal text-muted">{hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={`peer relative h-[18px] w-8 flex-none cursor-pointer appearance-none rounded-full bg-line-strong transition-colors checked:bg-accent ${focus}
          after:absolute after:top-0.5 after:left-0.5 after:h-3.5 after:w-3.5 after:rounded-full after:bg-white after:shadow after:transition-all checked:after:left-4`}
      />
    </label>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "ok" | "warn" | "accent"; children: React.ReactNode }) {
  const tones = {
    neutral: "border-line bg-surface-2 text-muted",
    ok: "border-transparent bg-ok-soft text-ok",
    warn: "border-warn-line bg-warn-soft text-warn",
    accent: "border-transparent bg-accent-soft text-accent-fg",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}
