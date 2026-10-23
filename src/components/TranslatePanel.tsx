import React, { useEffect, useState } from "react";
import { Button, Card } from "./ui";

export type Outcome =
  | { kind: "idle" }
  | { kind: "complete"; translated: number; removed: number }
  | { kind: "partial"; headline: string }
  | { kind: "cancelled" };

type Props = {
  canTranslate: boolean;
  hasResult: boolean;
  busy: boolean;
  progress: number;
  // Time the running translation started (Date.now()).
  startedAt: number | null;
  // Shown while busy, e.g. a retry after a temporary error.
  status: string | null;
  outcome: Outcome;
  error: string | null;
  // Notes about the input file (recovered or unparsed content).
  notices: string[];
  // Requests, tokens, time and cost estimate of the last run.
  usage: string | null;
  onTranslate: () => void;
  onCancel: () => void;
  onShowUntranslated: () => void;
};

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(since);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return <span className="font-mono">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`}</span>;
}

function StatusIcon({ tone, children }: { tone: "ok" | "warn"; children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className={`mt-px grid h-5.5 w-5.5 flex-none place-items-center rounded-full text-xs font-bold ${
        tone === "ok" ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"
      }`}
    >
      {children}
    </span>
  );
}

export default function TranslatePanel({
  canTranslate,
  hasResult,
  busy,
  progress,
  startedAt,
  status,
  outcome,
  error,
  notices,
  usage,
  onTranslate,
  onCancel,
  onShowUntranslated,
}: Props) {
  return (
    <Card className="lg:sticky lg:bottom-0 lg:shadow-[0_-8px_16px_-10px_rgba(16,24,40,0.18)]" aria-label="Translation status">
      <div className="flex flex-col gap-3">
        {busy && (
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold">Translating…</span>
              <span className="font-mono text-sm font-semibold">{progress}%</span>
            </div>
            <div
              role="progressbar"
              aria-label="Translation progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3"
            >
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-[12.5px] text-muted">
              <span aria-live="polite">{status ?? "Working…"}</span>
              {startedAt !== null && <Elapsed since={startedAt} />}
            </div>
          </div>
        )}

        {!busy && outcome.kind === "complete" && (
          <div className="flex gap-2.5" data-outcome="complete">
            <StatusIcon tone="ok">✓</StatusIcon>
            <div>
              <div className="text-sm font-semibold">Translation complete</div>
              <div className="text-xs text-muted">
                {outcome.translated.toLocaleString("en-US")} cues translated
                {outcome.removed > 0 && ` · ${outcome.removed} sound-effect cue${outcome.removed === 1 ? "" : "s"} removed`}
              </div>
            </div>
          </div>
        )}

        {!busy && outcome.kind === "partial" && (
          <div className="flex gap-2.5" data-outcome="partial">
            <StatusIcon tone="warn">!</StatusIcon>
            <div>
              <div className="text-sm font-semibold">Partial translation</div>
              <div className="text-xs text-muted">{outcome.headline}</div>
              <button
                type="button"
                onClick={onShowUntranslated}
                className="mt-1 rounded text-[12.5px] font-medium text-accent-fg hover:underline focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
              >
                Show untranslated cues
              </button>
            </div>
          </div>
        )}

        {!busy && outcome.kind === "cancelled" && (
          <p className="text-[13px] text-fg-2" data-outcome="cancelled">
            Cancelled. Nothing was kept. A request already sent to OpenAI may still be billed.
          </p>
        )}

        {!busy && usage && <div className="text-xs text-muted">{usage}</div>}

        {error && (
          <div role="alert" className="rounded-lg border border-danger-line bg-danger-soft p-2.5">
            <div className="text-[13px] font-semibold text-danger">Error</div>
            <pre className="mt-1 font-sans text-xs whitespace-pre-wrap text-danger">{error}</pre>
          </div>
        )}

        {notices.length > 0 && (
          <details className="rounded-lg border border-warn-line bg-warn-soft text-xs text-warn">
            <summary className="cursor-pointer px-2.5 py-1.5 font-medium">
              Input file notes ({notices.length})
            </summary>
            <ul className="list-disc space-y-1 px-2.5 pb-2 pl-6">
              {notices.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </details>
        )}

        {busy ? (
          <Button size="lg" onClick={onCancel} className="w-full">
            Cancel
          </Button>
        ) : (
          <Button variant={hasResult ? "secondary" : "primary"} size="lg" disabled={!canTranslate} onClick={onTranslate} className="w-full">
            {hasResult ? "Translate again" : "Translate to Hebrew"}
          </Button>
        )}
      </div>
    </Card>
  );
}
