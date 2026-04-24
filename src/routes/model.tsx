import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  Target,
  Crosshair,
  GitBranch,
  BarChart3,
  Cpu,
  Info,
  BookOpen,
  Layers,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  ReferenceDot,
  Tooltip as RTooltip,
  BarChart,
  Bar,
  Legend,
} from "recharts";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/KpiCard";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import stats from "@/data/modelStats.json";
import { useLiveDataStore } from "@/data/liveDataStore";
import { DataSourceBadge } from "@/components/DataSourceBadge";
import { ExternalTrainingKit } from "@/components/ExternalTrainingKit";

export const Route = createFileRoute("/model")({
  component: ModelPage,
  head: () => ({
    meta: [
      { title: "Model Evaluation Metrics — NBA Decisioning" },
      {
        name: "description",
        content:
          "Churn classifier validation (RandomForest or XGBoost — selected at training time): accuracy, precision, recall, F1, ROC-AUC, confusion matrix, and hyperparameters.",
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
  const liveStats = useLiveDataStore((s) => s.stats);
  const liveRun = useLiveDataStore((s) => s.run);
  const isLive = !!(liveStats?.performance_metrics && liveStats.confusion_matrix);
  const m = (isLive ? liveStats!.performance_metrics! : stats.performance_metrics) as typeof stats.performance_metrics;
  const c = (isLive ? liveStats!.confusion_matrix! : stats.confusion_matrix) as typeof stats.confusion_matrix;
  const h = (isLive && liveStats!.hyperparameters ? liveStats!.hyperparameters : stats.hyperparameters) as typeof stats.hyperparameters;
  const s = (isLive && liveStats!.dataset_split ? liveStats!.dataset_split : stats.dataset_split) as typeof stats.dataset_split;
  const total = c.true_negatives + c.false_positives + c.false_negatives + c.true_positives;

  return (
    <AppShell>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            Model Validation
            <DataSourceBadge
              isLive={isLive}
              title={
                isLive && liveRun?.finishedAt
                  ? `Live — last training run ${new Date(liveRun.finishedAt).toLocaleString()}`
                  : undefined
              }
            />
          </span>
        }
        title="Model Evaluation Metrics"
        description="Held-out test performance for the production churn classifier. Numbers are computed on the test split and refreshed with every model retrain."
      />

      <div className="px-5 sm:px-8 lg:px-10 py-7 space-y-7">
        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <KpiCard
            label="Accuracy"
            value={isLive ? pct(m.accuracy) : null}
            sub="Overall correctness"
            icon={Target}
            accent="primary"
            prov={
              isLive
                ? {
                    kind: "model",
                    source: liveRun?.databricksRunId
                      ? `Trained model · run ${liveRun.databricksRunId}`
                      : "Trained model · most recent successful run",
                    formula: "(TP + TN) / total predictions on held-out test set",
                  }
                : null
            }
          />
          <KpiCard
            label="Precision"
            value={isLive ? pct(m.precision) : null}
            sub="Of predicted churners"
            icon={Crosshair}
            accent="primary"
            prov={
              isLive
                ? {
                    kind: "model",
                    source: "Trained model · test split",
                    formula: "TP / (TP + FP)",
                  }
                : null
            }
          />
          <KpiCard
            label="Recall"
            value={isLive ? pct(m.recall) : null}
            sub="Of actual churners caught"
            icon={Activity}
            accent="success"
            prov={
              isLive
                ? {
                    kind: "model",
                    source: "Trained model · test split",
                    formula: "TP / (TP + FN)",
                  }
                : null
            }
          />
          <KpiCard
            label="F1-Score"
            value={isLive ? pct(m.f1_score) : null}
            sub="Precision · Recall balance"
            icon={GitBranch}
            accent="primary"
            prov={
              isLive
                ? {
                    kind: "model",
                    source: "Trained model · test split",
                    formula: "2 · (precision · recall) / (precision + recall)",
                  }
                : null
            }
          />
          <KpiCard
            label="ROC-AUC"
            value={isLive ? m.roc_auc.toFixed(4) : null}
            sub="Ranking quality"
            icon={BarChart3}
            accent="success"
            prov={
              isLive
                ? {
                    kind: "model",
                    source: "Trained model · test split",
                    formula: "Area under the ROC curve (TPR vs FPR sweep)",
                  }
                : null
            }
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

        <RocCurveSection
          auc={m.roc_auc}
          recall={m.recall}
          fpr={c.false_positives / (c.true_negatives + c.false_positives)}
        />

        <SegmentBreakdown />

        <ExternalTrainingKit />

        <Glossary />
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

/* -------------------------------------------------------------------------- */
/* ROC curve                                                                  */
/* -------------------------------------------------------------------------- */

// Build a deterministic ROC curve consistent with a target AUC.
// TPR = FPR^(1/k) where AUC = k / (k + 1)  ⇒  k = AUC / (1 - AUC).
// Smooth, monotonic, passes through (0,0) and (1,1), integrates to the supplied AUC.
function buildRocCurve(auc: number) {
  const k = auc / Math.max(1e-6, 1 - auc);
  const points: { fpr: number; tpr: number; threshold: number }[] = [];
  const N = 41;
  for (let i = 0; i <= N; i++) {
    const fpr = i / N;
    const tpr = Math.pow(fpr, 1 / k);
    const threshold = 1 - i / N;
    points.push({ fpr, tpr, threshold });
  }
  return points;
}

function RocCurveSection({ auc, recall, fpr }: { auc: number; recall: number; fpr: number }) {
  const data = buildRocCurve(auc);
  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-sm)]">
      <header className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-foreground">ROC Curve</h2>
          <p className="text-[12.5px] text-muted-foreground mt-0.5">
            Trade-off between true-positive rate and false-positive rate across all decision thresholds.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5">
          <BarChart3 className="size-3.5 text-primary" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">
            AUC
          </span>
          <span className="text-sm font-semibold tabular-nums text-foreground">
            {auc.toFixed(4)}
          </span>
        </div>
      </header>

      <div className="h-[340px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 24, bottom: 28, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              type="number"
              dataKey="fpr"
              domain={[0, 1]}
              tickFormatter={(v) => v.toFixed(1)}
              stroke="var(--muted-foreground)"
              tick={{ fontSize: 11 }}
              label={{
                value: "False-positive rate (FPR)",
                position: "insideBottom",
                offset: -16,
                style: { fontSize: 11, fill: "var(--muted-foreground)" },
              }}
            />
            <YAxis
              type="number"
              dataKey="tpr"
              domain={[0, 1]}
              tickFormatter={(v) => v.toFixed(1)}
              stroke="var(--muted-foreground)"
              tick={{ fontSize: 11 }}
              label={{
                value: "True-positive rate (TPR / Recall)",
                angle: -90,
                position: "insideLeft",
                offset: 12,
                style: { fontSize: 11, fill: "var(--muted-foreground)", textAnchor: "middle" },
              }}
            />
            <RTooltip
              cursor={{ stroke: "var(--primary)", strokeDasharray: "3 3" }}
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value: number, name) => {
                const label =
                  name === "tpr" ? "TPR (Recall)" : name === "fpr" ? "FPR" : String(name);
                return [Number(value).toFixed(4), label];
              }}
              labelFormatter={(_, payload) => {
                const p = payload?.[0]?.payload as { threshold: number } | undefined;
                return p ? `Threshold ≈ ${p.threshold.toFixed(2)}` : "";
              }}
            />
            <ReferenceLine
              segment={[
                { x: 0, y: 0 },
                { x: 1, y: 1 },
              ]}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              ifOverflow="extendDomain"
            />
            <Line
              type="monotone"
              dataKey="tpr"
              stroke="var(--primary)"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
            <ReferenceDot
              x={fpr}
              y={recall}
              r={6}
              fill="var(--talktalk-lime, var(--primary))"
              stroke="var(--foreground)"
              strokeWidth={1.5}
              label={{
                value: "Operating point",
                position: "right",
                fontSize: 11,
                fill: "var(--foreground)",
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11.5px]">
        <div className="rounded-lg bg-muted/50 px-3 py-2">
          <div className="text-muted-foreground">Operating point</div>
          <div className="font-semibold tabular-nums text-foreground">
            FPR {pct(fpr)} · TPR {pct(recall)}
          </div>
        </div>
        <div className="rounded-lg bg-muted/50 px-3 py-2">
          <div className="text-muted-foreground">Diagonal baseline</div>
          <div className="font-semibold text-foreground">Random guessing (AUC = 0.50)</div>
        </div>
        <div className="rounded-lg bg-muted/50 px-3 py-2">
          <div className="text-muted-foreground">Curve shape</div>
          <div className="font-semibold text-foreground">
            Reconstructed from reported AUC; per-threshold scores not stored in this snapshot.
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Segment breakdown                                                          */
/* -------------------------------------------------------------------------- */

type Segment = { segment: string; precision: number; recall: number; volume: number };

const SEGMENT_GROUPS: { title: string; rows: Segment[] }[] = [
  {
    title: "Contract status",
    rows: [
      { segment: "In contract", precision: 0.79, recall: 0.74, volume: 312_400 },
      { segment: "Out of contract", precision: 0.73, recall: 0.81, volume: 248_900 },
      { segment: "Recently renewed (<90d)", precision: 0.81, recall: 0.69, volume: 147_808 },
    ],
  },
  {
    title: "Package type",
    rows: [
      { segment: "Fibre 65", precision: 0.74, recall: 0.72, volume: 198_120 },
      { segment: "Fibre 150", precision: 0.78, recall: 0.77, volume: 221_540 },
      { segment: "Fibre 500+", precision: 0.82, recall: 0.81, volume: 96_410 },
      { segment: "ADSL legacy", precision: 0.71, recall: 0.83, volume: 193_038 },
    ],
  },
  {
    title: "Usage band",
    rows: [
      { segment: "Low (<50 GB/mo)", precision: 0.69, recall: 0.78, volume: 184_220 },
      { segment: "Medium (50–250 GB/mo)", precision: 0.77, recall: 0.76, volume: 312_640 },
      { segment: "Heavy (>250 GB/mo)", precision: 0.84, recall: 0.74, volume: 212_248 },
    ],
  },
];

function SegmentBreakdown() {
  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-sm)]">
      <header className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-foreground inline-flex items-center gap-2">
            <Layers className="size-4 text-primary" />
            Precision & recall by segment
          </h2>
          <p className="text-[12.5px] text-muted-foreground mt-0.5">
            Cohort-level performance across contract status, package type, and usage band.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
          <Info className="size-3.5" />
          Illustrative split — replace with `segment_metrics` once exported from the eval pipeline.
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {SEGMENT_GROUPS.map((group) => (
          <div key={group.title} className="rounded-xl border border-border bg-background/40 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              {group.title}
            </div>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={group.rows}
                  layout="vertical"
                  margin={{ top: 4, right: 8, bottom: 4, left: 4 }}
                  barCategoryGap="22%"
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis
                    type="number"
                    domain={[0, 1]}
                    tickFormatter={(v) => `${Math.round(v * 100)}%`}
                    tick={{ fontSize: 10 }}
                    stroke="var(--muted-foreground)"
                  />
                  <YAxis
                    type="category"
                    dataKey="segment"
                    width={130}
                    tick={{ fontSize: 11 }}
                    stroke="var(--muted-foreground)"
                  />
                  <RTooltip
                    cursor={{ fill: "var(--muted)" }}
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value: number, name) => [
                      `${(Number(value) * 100).toFixed(1)}%`,
                      name === "precision" ? "Precision" : "Recall",
                    ]}
                  />
                  <Legend
                    iconSize={8}
                    wrapperStyle={{ fontSize: 11 }}
                    formatter={(v) => (v === "precision" ? "Precision" : "Recall")}
                  />
                  <Bar dataKey="precision" fill="var(--primary)" radius={[0, 3, 3, 0]} />
                  <Bar
                    dataKey="recall"
                    fill="var(--talktalk-lime, var(--primary))"
                    radius={[0, 3, 3, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 space-y-1 text-[11px] text-muted-foreground">
              {group.rows.map((r) => (
                <div key={r.segment} className="flex justify-between">
                  <span className="truncate">{r.segment}</span>
                  <span className="tabular-nums">{num(r.volume)} customers</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Glossary                                                                   */
/* -------------------------------------------------------------------------- */

const GLOSSARY: { term: string; oneLiner: string; body: string; formula?: string }[] = [
  {
    term: "Accuracy",
    oneLiner: "How often the model is right overall.",
    body: "Of every prediction made on the test set, the share that matched what actually happened. Useful as a headline number, but can be misleading when churners and stayers are very imbalanced — a model that always predicts 'stay' can look accurate while catching nobody.",
    formula: "(TP + TN) / total predictions",
  },
  {
    term: "Precision",
    oneLiner: "When we call a customer at risk, how often are we right?",
    body: "Of every customer flagged as a likely churner, the share that genuinely would have left. High precision means low wasted contact cost — most outreach lands on real risk.",
    formula: "TP / (TP + FP)",
  },
  {
    term: "Recall",
    oneLiner: "Of the customers who would actually churn, how many did we catch?",
    body: "Sometimes called sensitivity or true-positive rate. High recall means we miss few real churners. There is a natural trade-off with precision: lowering the score threshold catches more churners but also drags in more wasted calls.",
    formula: "TP / (TP + FN)",
  },
  {
    term: "F1-Score",
    oneLiner: "A single balance score between precision and recall.",
    body: "The harmonic mean of precision and recall — it only goes up when both improve. Useful when you care equally about wasted contact cost and missed save opportunities.",
    formula: "2 · (Precision · Recall) / (Precision + Recall)",
  },
  {
    term: "ROC-AUC",
    oneLiner: "How well the model ranks risky customers ahead of safe ones.",
    body: "Take a random churner and a random stayer; AUC is the probability the model gives the churner a higher risk score. 0.50 = random; 1.00 = perfect ranking. Threshold-independent, so it tells you the underlying signal quality regardless of where the call cutoff is set.",
  },
  {
    term: "True Positive (TP)",
    oneLiner: "Predicted to churn — and they would have.",
    body: "Correctly identified at-risk customer. These are the saves the retention programme exists to make.",
  },
  {
    term: "False Positive (FP)",
    oneLiner: "Predicted to churn, but actually stayed.",
    body: "Safe customer who got contacted unnecessarily. Cost: a contact-centre minute and any offer accepted by someone who would have stayed anyway.",
  },
  {
    term: "False Negative (FN)",
    oneLiner: "Predicted to stay, but actually churned.",
    body: "A customer the model missed. Cost: full lost lifetime value, since no retention attempt was made.",
  },
  {
    term: "True Negative (TN)",
    oneLiner: "Predicted to stay — and they did.",
    body: "Correctly left alone. Frees up agent capacity for the customers who actually need a call.",
  },
];

function Glossary() {
  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-sm)]">
      <header className="flex items-center gap-2 mb-5">
        <div className="size-7 rounded-md bg-primary/10 text-primary flex items-center justify-center">
          <BookOpen className="size-3.5" />
        </div>
        <div>
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Plain-English glossary
          </h2>
          <p className="text-[12.5px] text-muted-foreground -mt-0.5">
            Written for finance and CDO stakeholders — no statistics background assumed.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {GLOSSARY.map((g) => (
          <article
            key={g.term}
            className="rounded-xl border border-border bg-background/40 p-4 hover:shadow-[var(--shadow-sm)] transition-shadow"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">{g.term}</h3>
              {g.formula && (
                <code className="text-[10.5px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {g.formula}
                </code>
              )}
            </div>
            <p className="mt-1 text-[12.5px] font-medium text-primary">{g.oneLiner}</p>
            <p className="mt-1.5 text-[12.5px] text-muted-foreground leading-relaxed">{g.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
