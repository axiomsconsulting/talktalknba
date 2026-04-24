import { createFileRoute } from "@tanstack/react-router";
import { Activity, Target, Crosshair, GitBranch, BarChart3, Cpu } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import stats from "@/data/modelStats.json";

export const Route = createFileRoute("/model")({
  component: ModelPage,
  head: () => ({
    meta: [
      { title: "Model Evaluation Metrics — NBA Decisioning" },
      {
        name: "description",
        content:
          "Random Forest churn classifier validation: accuracy, precision, recall, F1, ROC-AUC, confusion matrix, and hyperparameters.",
      },
    ],
  }),
});

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const num = (v: number) => v.toLocaleString("en-GB");

const CONFUSION_DEFS = {
  tp: {
    title: "True Positives",
    short: "TP",
    body: "Predicted to churn and actually churned — correctly targeted by retention.",
  },
  fp: {
    title: "False Positives",
    short: "FP",
    body: "Predicted to churn, but actually stayed — safe to call but uses budget.",
  },
  fn: {
    title: "False Negatives",
    short: "FN",
    body: "Predicted to stay, but actually churned — missed retention opportunity.",
  },
  tn: {
    title: "True Negatives",
    short: "TN",
    body: "Predicted to stay and actually stayed — correctly left untouched.",
  },
} as const;

function ConfusionCell({
  variant,
  label,
  value,
  total,
}: {
  variant: "tp" | "fp" | "fn" | "tn";
  label: string;
  value: number;
  total: number;
}) {
  const def = CONFUSION_DEFS[variant];
  const share = (value / total) * 100;
  const tone =
    variant === "tp"
      ? "bg-[var(--success)]/10 border-[var(--success)]/40 text-[var(--success)]"
      : variant === "tn"
        ? "bg-primary/10 border-primary/30 text-primary"
        : variant === "fp"
          ? "bg-[var(--risk-med,oklch(0.78_0.14_75))]/15 border-[var(--risk-med,oklch(0.78_0.14_75))]/40 text-[oklch(0.55_0.14_60)]"
          : "bg-[var(--risk-high)]/10 border-[var(--risk-high)]/40 text-[var(--risk-high)]";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "relative rounded-xl border p-5 cursor-help transition-shadow hover:shadow-[var(--shadow-md)]",
            tone,
          )}
        >
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-wider opacity-80">
              {label}
            </div>
            <div className="text-[10px] font-mono font-semibold opacity-70">{def.short}</div>
          </div>
          <div className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
            {num(value)}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
            {share.toFixed(1)}% of test set
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px] text-left">
        <div className="font-semibold mb-0.5">{def.title}</div>
        <div className="opacity-90">{def.body}</div>
      </TooltipContent>
    </Tooltip>
  );
}

function ModelPage() {
  const m = stats.performance_metrics;
  const c = stats.confusion_matrix;
  const h = stats.hyperparameters;
  const s = stats.dataset_split;
  const total = c.true_negatives + c.false_positives + c.false_negatives + c.true_positives;

  return (
    <AppShell>
      <PageHeader
        eyebrow="Model Validation"
        title="Model Evaluation Metrics"
        description="Held-out test performance for the production churn classifier. Numbers are computed on the test split and refreshed with every model retrain."
      />

      <div className="px-5 sm:px-8 lg:px-10 py-7 space-y-7">
        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <KpiCard
            label="Accuracy"
            value={pct(m.accuracy)}
            sub="Overall correctness"
            icon={Target}
            accent="primary"
          />
          <KpiCard
            label="Precision"
            value={pct(m.precision)}
            sub="Of predicted churners"
            icon={Crosshair}
            accent="primary"
          />
          <KpiCard
            label="Recall"
            value={pct(m.recall)}
            sub="Of actual churners caught"
            icon={Activity}
            accent="success"
          />
          <KpiCard
            label="F1-Score"
            value={pct(m.f1_score)}
            sub="Precision · Recall balance"
            icon={GitBranch}
            accent="primary"
          />
          <KpiCard
            label="ROC-AUC"
            value={m.roc_auc.toFixed(4)}
            sub="Ranking quality"
            icon={BarChart3}
            accent="success"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Confusion matrix */}
          <section className="lg:col-span-2 rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-sm)]">
            <header className="flex items-end justify-between mb-5">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-foreground">
                  Confusion Matrix
                </h2>
                <p className="text-[12.5px] text-muted-foreground mt-0.5">
                  Test set — {num(total)} predictions. Hover any cell for context.
                </p>
              </div>
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                Positive class = churn
              </div>
            </header>

            <TooltipProvider delayDuration={150}>
              <div className="grid grid-cols-[auto_1fr_1fr] gap-2 items-stretch">
                <div />
                <div className="text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground pb-1">
                  Predicted: Stay
                </div>
                <div className="text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground pb-1">
                  Predicted: Churn
                </div>

                <div className="flex items-center justify-end pr-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Actual: Stay
                </div>
                <ConfusionCell
                  variant="tn"
                  label="Correctly retained"
                  value={c.true_negatives}
                  total={total}
                />
                <ConfusionCell
                  variant="fp"
                  label="Wasted contact"
                  value={c.false_positives}
                  total={total}
                />

                <div className="flex items-center justify-end pr-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Actual: Churn
                </div>
                <ConfusionCell
                  variant="fn"
                  label="Missed save"
                  value={c.false_negatives}
                  total={total}
                />
                <ConfusionCell
                  variant="tp"
                  label="Caught churner"
                  value={c.true_positives}
                  total={total}
                />
              </div>
            </TooltipProvider>

            <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11.5px]">
              <div className="rounded-lg bg-muted/50 px-3 py-2">
                <div className="text-muted-foreground">TPR (sensitivity)</div>
                <div className="font-semibold tabular-nums text-foreground">
                  {pct(c.true_positives / (c.true_positives + c.false_negatives))}
                </div>
              </div>
              <div className="rounded-lg bg-muted/50 px-3 py-2">
                <div className="text-muted-foreground">TNR (specificity)</div>
                <div className="font-semibold tabular-nums text-foreground">
                  {pct(c.true_negatives / (c.true_negatives + c.false_positives))}
                </div>
              </div>
              <div className="rounded-lg bg-muted/50 px-3 py-2">
                <div className="text-muted-foreground">FPR</div>
                <div className="font-semibold tabular-nums text-foreground">
                  {pct(c.false_positives / (c.true_negatives + c.false_positives))}
                </div>
              </div>
              <div className="rounded-lg bg-muted/50 px-3 py-2">
                <div className="text-muted-foreground">FNR</div>
                <div className="font-semibold tabular-nums text-foreground">
                  {pct(c.false_negatives / (c.true_positives + c.false_negatives))}
                </div>
              </div>
            </div>
          </section>

          {/* Under the hood */}
          <aside className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-sm)]">
            <header className="flex items-center gap-2 mb-4">
              <div className="size-7 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                <Cpu className="size-3.5" />
              </div>
              <div>
                <h2 className="text-base font-semibold tracking-tight text-foreground">
                  Under the hood
                </h2>
                <p className="text-[11.5px] text-muted-foreground -mt-0.5">
                  Model & training configuration
                </p>
              </div>
            </header>

            <dl className="space-y-0 font-mono text-[12px]">
              <Row k="model_type" v={stats.model_type} />
              <Row k="n_estimators" v={String(h.n_estimators)} />
              <Row k="max_depth" v={String(h.max_depth)} />
              <Row k="random_state" v={String(h.random_state)} />
              <div className="my-3 border-t border-dashed border-border" />
              <Row k="train_size" v={num(s.train_size)} />
              <Row k="test_size" v={num(s.test_size)} />
              <Row
                k="train_split"
                v={`${((s.train_size / (s.train_size + s.test_size)) * 100).toFixed(1)}%`}
              />
              <Row
                k="test_split"
                v={`${((s.test_size / (s.train_size + s.test_size)) * 100).toFixed(1)}%`}
              />
            </dl>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-semibold text-foreground tabular-nums">{v}</dd>
    </div>
  );
}
