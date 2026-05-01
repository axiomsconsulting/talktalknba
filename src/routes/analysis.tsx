import { createFileRoute } from "@tanstack/react-router";
import { Download, Database, Clock, Activity, RefreshCw, Trash2, ShieldQuestion } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { PageHeader } from "@/components/PageHeader";
import { AuditVerdictCard } from "@/components/AuditVerdictCard";
import audit from "@/data/analysisAudit.json";

export const Route = createFileRoute("/analysis")({
  head: () => ({
    meta: [
      { title: "Data Quality Analysis — TalkTalk NBA" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AnalysisPage,
});

const COLORS = ["#22c55e", "#f59e0b", "#ef4444", "#3b82f6", "#a855f7", "#06b6d4", "#64748b"];

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function ChartCard({ title, children, height = 260 }: { title: string; children: React.ReactNode; height?: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-[12.5px] font-semibold text-foreground mb-2">{title}</div>
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer>{children as any}</ResponsiveContainer>
      </div>
    </div>
  );
}

function AnalysisPage() {
  return (
    <div className="min-h-screen">
      <PageHeader
        eyebrow="Internal — hidden page"
        title="Retention data quality analysis"
        description="An evidence-based audit of the data feeding the churn model and NBA engine: what's clean, what's missing, what to drop, and where real-time / feedback loops belong."
        actions={
          <a
            href="/talktalk_data_quality.ipynb"
            download
            className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-2 text-[12.5px] font-medium shadow-[var(--shadow-md)] hover:opacity-90"
          >
            <Download className="size-4" /> Download audit notebook (.ipynb)
          </a>
        }
      />

      <div className="px-5 sm:px-8 lg:px-10 py-8 space-y-12 max-w-7xl">

        {/* 1. Coverage */}
        <Section
          title="1. Data coverage & shape"
          subtitle="Four tables drive the model. Sample audited: 50 customers, 1,157 monthly snapshots, 29,302 daily usage rows, 191 calls, 31 ceases."
        >
          <div className="grid md:grid-cols-2 gap-4">
            <ChartCard title="Date range per table (24 months)">
              <BarChart data={audit.dateCoverage.map(d => ({
                table: d.table,
                start: new Date(d.min).getTime(),
                span: new Date(d.max).getTime() - new Date(d.min).getTime(),
              }))} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" hide />
                <YAxis dataKey="table" type="category" width={100} fontSize={11} />
                <Tooltip formatter={(v: number, n) => n === "span" ? `${Math.round(v / (1000*60*60*24))} days` : new Date(v).toISOString().slice(0,10)} />
                <Bar dataKey="start" stackId="a" fill="transparent" />
                <Bar dataKey="span" stackId="a" fill="#3b82f6" radius={[0,4,4,0]} />
              </BarChart>
            </ChartCard>

            <ChartCard title="Risk-tier population (3.55M base)">
              <BarChart data={audit.riskTiers}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="tier" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={(v) => `${(v/1e6).toFixed(1)}M`} />
                <Tooltip formatter={(v: number) => v.toLocaleString()} />
                <Bar dataKey="customers" fill="#3b82f6" radius={[4,4,0,0]} />
              </BarChart>
            </ChartCard>
          </div>
          <AuditVerdictCard
            verdict="warn"
            title="Customer snapshot is monthly, not daily"
            finding="customer_info uses month-start datevalue. OOC trigger has a 30-day decision window — a customer can sit at risk for up to 29 days before we see the change."
            recommendation="Move customer_info to a daily change-data-capture (CDC) feed, or at minimum a weekly snapshot with delta capture on contract_status, ooc_days, and dd_cancel fields."
          />
        </Section>

        {/* 2. Cleanliness */}
        <Section
          title="2. Cleanliness"
          subtitle="Null rates, type drift between live (MotherDuck) and offline snapshot, and category quality."
        >
          <div className="grid md:grid-cols-2 gap-4">
            <ChartCard title="Null / zero rate per column (%)">
              <BarChart data={audit.nullRates}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="column" fontSize={9} angle={-25} textAnchor="end" height={70} interval={0} />
                <YAxis fontSize={11} />
                <Tooltip formatter={(v: number) => `${v.toFixed(2)}%`} />
                <Bar dataKey="pct" fill="#ef4444" radius={[4,4,0,0]} />
              </BarChart>
            </ChartCard>

            <ChartCard title="Cease reason distribution">
              <PieChart>
                <Pie data={audit.ceaseReasons} dataKey="n" nameKey="reason" outerRadius={90} label>
                  {audit.ceaseReasons.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            </ChartCard>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-[12.5px] font-semibold mb-2">Type drift: snapshot vs MotherDuck live</div>
            <table className="w-full text-[12px]">
              <thead className="text-muted-foreground text-left border-b border-border">
                <tr><th className="py-1.5">Column</th><th>Snapshot</th><th>Live (MotherDuck)</th><th>Risk</th></tr>
              </thead>
              <tbody>
                {audit.typeDrift.map(t => (
                  <tr key={t.column} className="border-b border-border/50">
                    <td className="py-1.5 font-mono">{t.column}</td>
                    <td className="font-mono">{t.snapshot}</td>
                    <td className="font-mono text-amber-700">{t["live (MotherDuck)"]}</td>
                    <td className="text-foreground/70">Silent cast → loss of decimals or NaN on agg</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            <AuditVerdictCard
              verdict="gap"
              title="71% of cease reasons are 'VagueReason'"
              finding="Only 8 of 31 ceases tag a competitor and 1 is a HomeMove. The 'why' signal feeding NBA-trigger mapping is mostly noise."
              recommendation="Add a structured exit-survey at cease point (multi-select + free text → LLM classification). Backfill with call-transcript topic modelling for the last 90 days."
            />
            <AuditVerdictCard
              verdict="warn"
              title="line_speed = 0 on 4.84% of rows"
              finding="Treated as a numeric feature. A literal 0 silently weakens the speed_deficit driver."
              recommendation="Add a missing_line_speed flag and impute from package median; never feed 0 as 'no measurement'."
            />
            <AuditVerdictCard
              verdict="warn"
              title="Type drift between live and snapshot"
              finding="usage_*_mbs are VARCHAR in MotherDuck but DOUBLE in the offline parquet — silent string aggregation produces wrong totals."
              recommendation="Enforce a typed view in MotherDuck (CREATE VIEW … TRY_CAST AS DOUBLE) and validate row hashes after every pull."
            />
          </div>
        </Section>

        {/* 3. Missing data */}
        <Section
          title="3. What's missing for best-in-class retention"
          subtitle="Things a top-tier retention stack would have, that we don't ingest today."
        >
          <div className="grid md:grid-cols-2 gap-3">
            <AuditVerdictCard verdict="gap" title="No billing / true ARPU table"
              finding="ARPU is inferred from crm_package_name → static £. Real billed amount, discounts, credits, late fees never reach the model."
              recommendation="Ingest the monthly invoice line table. Use actual billed ARPU and outstanding balance as features." />
            <AuditVerdictCard verdict="gap" title="No save-desk outcome history"
              finding="We never see whether a previous offer was accepted or whether the customer stayed. No reinforcement signal."
              recommendation="Log every NBA decision + outcome at 30/90/180 days. This is the single biggest unlock for uplift modelling." />
            <AuditVerdictCard verdict="gap" title="No NPS / CSAT / sentiment"
              finding="Calls are counted but not understood. A 9-second hold and a 9-minute angry call score the same."
              recommendation="Add post-call CSAT + topic + sentiment from call transcripts (Whisper + LLM classifier)." />
            <AuditVerdictCard verdict="gap" title="No outage / network incident feed"
              finding="Tech calls (79 of 191 in sample) likely follow incidents. Without the incident feed we can't pre-empt with credit." />
            <AuditVerdictCard verdict="gap" title="No competitor / market signal"
              finding="Openreach altnet build, Sky/BT promo windows materially move churn. Currently invisible to the model."
              recommendation="Join postcode-level altnet coverage + monthly competitor pricing scrape." />
            <AuditVerdictCard verdict="gap" title="No marketing exposure / digital footprint"
              finding="Email opens, app logins, web 'cancel my service' page hits — none captured."
              recommendation="Stream MarTech and product-analytics events into the feature store." />
          </div>
        </Section>

        {/* 4. Unnecessary */}
        <Section
          title="4. Unnecessary or low-signal"
          subtitle="Per the trained XGBoost importance — four categorical features contribute zero."
        >
          <ChartCard title="Feature importance (0 = useless to the model)" height={320}>
            <BarChart data={audit.featureImportance} layout="vertical" margin={{ left: 110 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" fontSize={11} />
              <YAxis dataKey="feature" type="category" fontSize={10} width={140} />
              <Tooltip formatter={(v: number) => v.toFixed(3)} />
              <Bar dataKey="importance" fill="#3b82f6" radius={[0,4,4,0]} />
            </BarChart>
          </ChartCard>
          <div className="grid md:grid-cols-2 gap-3">
            <AuditVerdictCard verdict="warn" title="Drop or one-hot expand 4 zero-importance features"
              finding="technology, sales_channel, crm_package_name, contract_status all show importance = 0. They are passed as raw strings — the booster ignores them."
              recommendation="Either drop entirely, or one-hot/target-encode and retrain. Currently they bloat the feature payload with no gain." />
            <AuditVerdictCard verdict="ok" title="usage_*_mbs are weak but worth keeping"
              finding="avg_download_mbs (1.9%) and avg_upload_mbs (2.3%) are low but non-zero — they help the long-tenure segment."
              recommendation="Replace 'avg' with rolling 30/90-day deltas to recover the trend signal." />
          </div>
        </Section>

        {/* 5. Time windows */}
        <Section
          title="5. Time windows, real-time vs batch"
          subtitle="What needs to flow when, to actually save customers in the OOC decision window."
        >
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { icon: Activity, tier: "Real-time (seconds)", colour: "text-red-600 border-red-200 bg-red-50",
                items: ["Inbound call routing → live churn score on screen-pop", "Speed-test result", "'Cancel my service' page hit", "Payment failure event"] },
              { icon: Clock, tier: "Near-real-time (hourly)", colour: "text-amber-700 border-amber-200 bg-amber-50",
                items: ["Usage drop > 60% vs 30-day mean", "OOC threshold crossings (60/30/14 days)", "Hold-time spikes by region"] },
              { icon: RefreshCw, tier: "Daily batch", colour: "text-blue-700 border-blue-200 bg-blue-50",
                items: ["Full base churn re-score", "Risk-tier reassignment", "NBA candidate generation"] },
              { icon: Database, tier: "Weekly batch", colour: "text-emerald-700 border-emerald-200 bg-emerald-50",
                items: ["Model drift (PSI) check", "Feature importance recompute", "Save-desk outcome attribution"] },
            ].map(({ icon: Icon, tier, colour, items }) => (
              <div key={tier} className={`rounded-xl border p-4 ${colour}`}>
                <div className="flex items-center gap-2 mb-2"><Icon className="size-4" /><div className="text-[12.5px] font-semibold">{tier}</div></div>
                <ul className="text-[12px] space-y-1 text-foreground/80 list-disc pl-4">
                  {items.map(i => <li key={i}>{i}</li>)}
                </ul>
              </div>
            ))}
          </div>
          <ChartCard title="Call-type mix (sample, last 24 months)">
            <BarChart data={audit.callTypes}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="type" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip />
              <Bar dataKey="n" fill="#a855f7" radius={[4,4,0,0]} />
            </BarChart>
          </ChartCard>
        </Section>

        {/* 6. Feedback loops & trust */}
        <Section
          title="6. Feedback loops & model trust"
          subtitle="Recall by tenure exposes where the model is over-confident."
        >
          <div className="grid md:grid-cols-2 gap-4">
            <ChartCard title="Recall by tenure segment (model_metrics.json)">
              <BarChart data={audit.segmentRecall}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="segment" fontSize={11} />
                <YAxis fontSize={11} domain={[0, 1]} />
                <Tooltip formatter={(v: number) => v.toFixed(3)} />
                <Bar dataKey="recall" fill="#22c55e" radius={[4,4,0,0]} />
                <Bar dataKey="precision" fill="#3b82f6" radius={[4,4,0,0]} />
              </BarChart>
            </ChartCard>
            <ChartCard title="Segment population (where the recall gap hurts most)">
              <BarChart data={audit.segmentRecall}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="segment" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => v.toLocaleString()} />
                <Bar dataKey="n" fill="#ef4444" radius={[4,4,0,0]} />
              </BarChart>
            </ChartCard>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <AuditVerdictCard verdict="gap" title="Recall collapses to 65% on 48m+ customers"
              finding="That's the biggest segment (488,698 customers) and the most loyal cohort. The model leans on tenure_days (31% importance) and gets lazy."
              recommendation="Add tenure-stratified training weights, plus loyalty-tenure-specific features (price increase events, contract renewal count)." />
            <AuditVerdictCard verdict="gap" title="No control group / counterfactual logging"
              finding="We don't know if NBA contact actually causes saves — we only know who was contacted and who churned."
              recommendation="Hold out a 5–10% random control. Move from churn-probability to uplift modelling (saves CAUSED, not saves CORRELATED)." />
            <AuditVerdictCard verdict="warn" title="No drift monitor"
              finding="Live MotherDuck distributions can shift weekly (price changes, marketing pushes) — model is retrained ad-hoc." />
            <AuditVerdictCard verdict="warn" title="No label-leakage check"
              finding="Some features (e.g. dd_cancel_60_day) sit close to the cease event. Risk that the model learns a near-trivial signal." />
          </div>
        </Section>

        {/* 7. Trust summary */}
        <Section title="7. Bottom line">
          <div className="rounded-xl border border-border bg-[var(--gradient-subtle)] p-5 space-y-2">
            <div className="flex items-center gap-2 text-foreground"><ShieldQuestion className="size-5" /><span className="font-semibold">Is this data trustable today?</span></div>
            <p className="text-sm text-foreground/80">
              Trustable enough to <strong>rank</strong> customers and target the top decile (AUC 0.87 holds up). <em>Not</em> trustable to <strong>price</strong> a save offer accurately or to attribute outcomes. The big three blockers are: (1) no real billed ARPU, (2) no save-outcome feedback loop, (3) cease reason field is mostly noise. Fix those and you move from "good predictor" to "auditable retention system".
            </p>
          </div>
          <div className="flex items-center gap-3">
            <a href="/talktalk_data_quality.ipynb" download className="inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-2 text-[12.5px] font-medium shadow-[var(--shadow-md)] hover:opacity-90">
              <Download className="size-4" /> Download audit notebook
            </a>
            <span className="text-[11.5px] text-muted-foreground inline-flex items-center gap-1.5"><Trash2 className="size-3" /> Page hidden from sidebar — share the URL deliberately.</span>
          </div>
        </Section>
      </div>
    </div>
  );
}
