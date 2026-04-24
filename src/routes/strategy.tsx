import { createFileRoute } from "@tanstack/react-router";
import {
  Database,
  BrainCircuit,
  GitBranch,
  PhoneCall,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  CircleSlash,
  Headphones,
  Wrench,
  Mail,
  PoundSterling,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { treatmentMatrix, roiParams, formatNumber } from "@/data/nba";
import { NBA_TRIGGERS } from "@/data/customers";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/strategy")({
  head: () => ({
    meta: [
      { title: "NBA Strategy & Pipeline — TalkTalk" },
      {
        name: "description",
        content:
          "End-to-end architecture and treatment matrix for the TalkTalk Next Best Action churn-prevention pipeline.",
      },
      { property: "og:title", content: "Next Best Action Strategy & Pipeline — TalkTalk NBA" },
      {
        property: "og:description",
        content:
          "From Databricks ingestion through the decisioning engine to the contact centre — and the rules that govern every customer touch.",
      },
    ],
  }),
  component: StrategyPage,
});

const PIPELINE_STAGES = [
  {
    icon: Database,
    title: "Data Ingestion",
    tech: "Databricks · DuckDB",
    description:
      "Billing, CRM, network telemetry and contact-centre logs land in the lakehouse. Feature engineering is run nightly into a Delta table of 9 model features.",
    artefacts: ["customer_info.parquet", "loyalty_calls.delta", "speed_test.delta"],
  },
  {
    icon: BrainCircuit,
    title: "Predictive Model",
    tech: "Python · scikit-learn",
    description:
      "Gradient-boosted classifier scores all 3.5M accounts weekly. AUC 0.87 on hold-out. Calibrated probabilities written back to the warehouse with SHAP attribution.",
    artefacts: ["AUC 0.87", "9 features", "Weekly retrain"],
  },
  {
    icon: GitBranch,
    title: "Decisioning Engine",
    tech: "NBA Logic · Treatment matrix",
    description:
      "Risk score is joined to context (contract status, package, usage) and routed through the eligibility / arbitration rules to a single Next Best Action per customer.",
    artefacts: ["6 treatment paths", "Contention rules", "Capacity caps"],
  },
  {
    icon: PhoneCall,
    title: "Contact Centre",
    tech: "Outbound · Email · Suppress",
    description:
      "Daily campaign files dispatched to dialler and CDP. Outcomes returned within 24h to close the loop and feed the next training cycle.",
    artefacts: ["Outbound dialler", "Marketing cloud", "Outcome capture"],
  },
] as const;

function StrategyPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="Architecture · Pipeline"
        title="Next Best Action Strategy & Pipeline"
        description="The end-to-end flow from raw data to a customer conversation, plus the treatment matrix that governs which action is taken — and for whom."
      />

      <div className="px-5 sm:px-8 lg:px-10 py-7 space-y-7">
        {/* Behavioural triggers */}
        <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-sm)] overflow-hidden">
          <div className="px-5 sm:px-7 py-5 border-b border-border">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">
              Behavioural triggers · NBA rules
            </div>
            <h2 className="mt-1 text-lg font-semibold text-foreground">
              Four signals that decide the next conversation
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Each rule below is fired by a specific behavioural pattern in the data — call-centre
              friction, contract & speed friction, usage mismatch, and competitor cease intent.
            </p>
          </div>
          <div className="p-5 sm:p-7 grid grid-cols-1 md:grid-cols-2 gap-4">
            <TriggerCard
              icon={Headphones}
              source="calls.csv"
              signal="Multiple recent Loyalty calls or extended hold time"
              trigger={NBA_TRIGGERS.loyalty_save_desk}
            />
            <TriggerCard
              icon={Wrench}
              source="customer_info.parquet"
              signal="Soon-to-be-OOC, high ooc_days, or line_speed << promised speed"
              trigger={NBA_TRIGGERS.free_tech_upgrade}
            />
            <TriggerCard
              icon={Mail}
              source="usage.parquet"
              signal="Heavy usage_download_mbs on a basic package (FTTC / ADSL)"
              trigger={NBA_TRIGGERS.rightsize_email}
            />
            <TriggerCard
              icon={PoundSterling}
              source="cease.csv"
              signal="reason_description_insight = Competitor Deals"
              trigger={NBA_TRIGGERS.competitor_match}
            />
          </div>
        </div>

        {/* Pipeline diagram */}
        <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-sm)] overflow-hidden">
          <div className="px-5 sm:px-7 py-5 border-b border-border">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">
              Decisioning architecture
            </div>
            <h2 className="mt-1 text-lg font-semibold text-foreground">
              From data lake to customer conversation
            </h2>
          </div>

          <div className="p-5 sm:p-7">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 xl:gap-2">
              {PIPELINE_STAGES.map((stage, idx) => {
                const Icon = stage.icon;
                return (
                  <div key={stage.title} className="relative flex">
                    <div className="flex-1 rounded-xl border border-border bg-[var(--surface-sunken)]/40 p-5 hover:border-primary/40 hover:shadow-[var(--shadow-md)] transition-all">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="size-10 rounded-lg bg-gradient-to-br from-primary to-primary-deep flex items-center justify-center shadow-[var(--shadow-glow)]">
                          <Icon className="size-5 text-primary-foreground" />
                        </div>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Stage {idx + 1}
                        </div>
                      </div>
                      <h3 className="text-base font-semibold text-foreground">{stage.title}</h3>
                      <div className="text-[11px] font-medium text-primary mt-0.5">
                        {stage.tech}
                      </div>
                      <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
                        {stage.description}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {stage.artefacts.map((a) => (
                          <span
                            key={a}
                            className="px-2 py-0.5 text-[10px] font-mono rounded bg-card border border-border text-muted-foreground"
                          >
                            {a}
                          </span>
                        ))}
                      </div>
                    </div>
                    {idx < PIPELINE_STAGES.length - 1 && (
                      <div className="hidden xl:flex items-center justify-center w-6 shrink-0">
                        <ArrowRight className="size-4 text-primary" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Treatment matrix */}
        <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-sm)] overflow-hidden">
          <div className="px-5 sm:px-7 py-5 border-b border-border flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                Treatment matrix
              </div>
              <h2 className="mt-1 text-lg font-semibold text-foreground">
                Next Best Action by risk × context
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Volumes are derived from the segment distribution of the 3.5M scored base.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5 text-[var(--success)]" /> Contact
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CircleSlash className="size-3.5 text-muted-foreground" /> Suppress
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--surface-sunken)] text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 text-left font-medium">Segment</th>
                  <th className="px-5 py-3 text-left font-medium">Trigger context</th>
                  <th className="px-5 py-3 text-left font-medium">Next Best Action</th>
                  <th className="px-5 py-3 text-left font-medium">Channel</th>
                  <th className="px-5 py-3 text-right font-medium">Volume</th>
                  <th className="px-5 py-3 text-right font-medium">Expected lift</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {treatmentMatrix.map((row) => {
                  const tierColor =
                    row.riskTier === "High"
                      ? "var(--risk-high)"
                      : row.riskTier === "Medium"
                        ? "var(--risk-medium)"
                        : "var(--risk-low)";
                  const isSuppress = row.channel === "Suppress";
                  const volume = Math.round(roiParams.totalCustomerBase * row.shareOfBase);
                  return (
                    <tr key={row.segment} className="hover:bg-muted/30 transition-colors">
                      <td className="px-5 py-4 align-top">
                        <div className="flex items-start gap-2">
                          <span
                            className="mt-1.5 size-2 rounded-full shrink-0"
                            style={{ background: tierColor }}
                          />
                          <div>
                            <div className="font-medium text-foreground">{row.segment}</div>
                            <div className="text-[11px] text-muted-foreground mt-0.5">
                              {row.riskTier} risk tier
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 align-top text-muted-foreground text-xs leading-relaxed max-w-xs">
                        {row.context}
                      </td>
                      <td className="px-5 py-4 align-top">
                        <div className="text-foreground text-sm leading-relaxed">{row.action}</div>
                      </td>
                      <td className="px-5 py-4 align-top">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border",
                            isSuppress
                              ? "bg-muted text-muted-foreground border-border"
                              : "bg-primary/5 text-primary border-primary/20"
                          )}
                        >
                          {isSuppress ? (
                            <CircleSlash className="size-3" />
                          ) : (
                            <CheckCircle2 className="size-3" />
                          )}
                          {row.channel}
                        </span>
                      </td>
                      <td className="px-5 py-4 align-top text-right tabular-nums">
                        <div className="text-foreground font-medium">
                          {formatNumber(volume, { compact: true })}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {(row.shareOfBase * 100).toFixed(0)}% of base
                        </div>
                      </td>
                      <td className="px-5 py-4 align-top text-right">
                        <span
                          className={cn(
                            "text-xs font-semibold tabular-nums",
                            isSuppress ? "text-muted-foreground" : "text-[var(--success)]"
                          )}
                        >
                          {row.expectedLift}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-5 sm:px-7 py-4 border-t border-border bg-[var(--surface-sunken)]/40 flex items-start gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="size-3.5 mt-0.5 shrink-0 text-[var(--warning)]" />
            <span>
              Suppression of long-tenure low-risk customers is critical: outbound contact erodes
              satisfaction and can <em>induce</em> the churn the model is designed to prevent.
            </span>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
