import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Settings2, Save, RotateCcw, Check, AlertCircle, PoundSterling, CalendarClock, Phone, Filter } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useNbaRulesStore, type NbaRule } from "@/data/nbaRulesStore";
import { useProductStore, activeProducts } from "@/data/products";
import { cn } from "@/lib/utils";
import { formatGbp } from "@/data/nba";

export const Route = createFileRoute("/nba-rules")({
  head: () => ({
    meta: [
      { title: "NBA Rules — TalkTalk NBA" },
      {
        name: "description",
        content:
          "Configure the Next Best Action rules: discount %, contract length, eligible packages, trigger thresholds and cost-to-serve. Persisted in Lovable Cloud.",
      },
    ],
  }),
  component: NbaRulesPage,
});

function NbaRulesPage() {
  const { rules, loaded, loading, error, load, save, setLocal } = useNbaRulesStore();
  const products = useProductStore((s) => s.products);
  const productNames = useMemo(() => activeProducts(products).map((p) => p.name), [products]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!loaded && !loading) load();
  }, [loaded, loading, load]);

  const markDirty = (id: string) =>
    setDirtyIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

  const handlePatch = (id: string, patch: Partial<NbaRule>) => {
    setLocal(id, patch);
    markDirty(id);
  };

  const handleSave = async (rule: NbaRule) => {
    setSavingId(rule.id);
    await save(rule);
    setSavingId(null);
    setSavedId(rule.id);
    setDirtyIds((prev) => {
      const next = new Set(prev);
      next.delete(rule.id);
      return next;
    });
    setTimeout(() => setSavedId((curr) => (curr === rule.id ? null : curr)), 1500);
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="Operations · Decisioning"
        title="NBA Rules"
        description="The decisioning rulebook the simulator and customer profiles read from. Edit a rule, save, and the new economics flow through to ROI, dilution and LTV figures everywhere in the app."
      />

      <div className="px-5 sm:px-8 lg:px-10 py-7 space-y-5">
        {error && (
          <div className="rounded-lg border border-[var(--risk-high)]/30 bg-[var(--risk-high)]/5 p-4 text-sm text-[var(--risk-high)] flex items-start gap-2">
            <AlertCircle className="size-4 mt-0.5 shrink-0" />
            <span>Failed to load rules: {error}</span>
          </div>
        )}

        {!loaded && loading && (
          <div className="text-sm text-muted-foreground">Loading rules…</div>
        )}

        <div className="grid gap-5">
          {rules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              productOptions={productNames}
              onPatch={(patch) => handlePatch(rule.id, patch)}
              onSave={() => handleSave(rule)}
              dirty={dirtyIds.has(rule.id)}
              saving={savingId === rule.id}
              saved={savedId === rule.id}
            />
          ))}
        </div>
      </div>
    </AppShell>
  );
}

function RuleCard({
  rule,
  productOptions,
  onPatch,
  onSave,
  dirty,
  saving,
  saved,
}: {
  rule: NbaRule;
  productOptions: string[];
  onPatch: (patch: Partial<NbaRule>) => void;
  onSave: () => void;
  dirty: boolean;
  saving: boolean;
  saved: boolean;
}) {
  const togglePackage = (name: string) => {
    const next = rule.eligiblePackages.includes(name)
      ? rule.eligiblePackages.filter((n) => n !== name)
      : [...rule.eligiblePackages, name];
    onPatch({ eligiblePackages: next });
  };

  const setThreshold = (key: keyof NbaRule["thresholds"], value: number | null) => {
    onPatch({ thresholds: { ...rule.thresholds, [key]: value } });
  };

  return (
    <div
      className={cn(
        "rounded-xl border bg-card shadow-[var(--shadow-sm)] overflow-hidden transition-opacity",
        !rule.isActive && "opacity-70",
        "border-border",
      )}
    >
      <div className="px-5 sm:px-7 py-5 border-b border-border flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Settings2 className="size-4 text-primary" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              {rule.triggerKey}
            </span>
            <span
              className={cn(
                "px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded",
                rule.isActive
                  ? "bg-[var(--success)]/10 text-[var(--success)] border border-[var(--success)]/20"
                  : "bg-muted text-muted-foreground border border-border",
              )}
            >
              {rule.isActive ? "Active" : "Inactive"}
            </span>
          </div>
          <Input
            value={rule.label}
            onChange={(e) => onPatch({ label: e.target.value })}
            className="mt-2 text-lg font-semibold border-transparent hover:border-border focus-visible:border-border bg-transparent px-0 h-auto py-1"
          />
          <textarea
            value={rule.description}
            onChange={(e) => onPatch({ description: e.target.value })}
            rows={2}
            className="mt-1 w-full text-sm text-muted-foreground bg-transparent border border-transparent hover:border-border focus:border-border rounded px-0 py-1 resize-none focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Active</span>
            <Switch
              checked={rule.isActive}
              onCheckedChange={(v) => onPatch({ isActive: v })}
            />
          </div>
          <button
            onClick={onSave}
            disabled={!dirty || saving}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold transition-colors",
              dirty
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground cursor-not-allowed",
            )}
          >
            {saved ? <Check className="size-3.5" /> : saving ? <RotateCcw className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            {saved ? "Saved" : saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div className="p-5 sm:p-7 grid lg:grid-cols-2 gap-6">
        {/* Offer */}
        <Section title="Offer" icon={PoundSterling}>
          <FieldRow label={`Discount · ${rule.discountPct.toFixed(0)}%`} hint="% off the contracted monthly price">
            <Slider
              value={[rule.discountPct]}
              min={0}
              max={50}
              step={1}
              onValueChange={(v) => onPatch({ discountPct: v[0] })}
            />
          </FieldRow>
          <FieldRow label="Contract length" hint="Re-contract length in months (0 = no contract)">
            <div className="flex flex-wrap gap-1.5">
              {[0, 12, 18, 24, 36].map((m) => (
                <button
                  key={m}
                  onClick={() => onPatch({ contractMonths: m })}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
                    rule.contractMonths === m
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m === 0 ? "None" : `${m} mo`}
                </button>
              ))}
            </div>
          </FieldRow>
          <FieldRow label="Channel" icon={Phone} hint="How the customer is contacted">
            <Input
              value={rule.channel}
              onChange={(e) => onPatch({ channel: e.target.value })}
            />
          </FieldRow>
          <FieldRow
            label={`Cost per contact · ${formatGbp(rule.costPerContactGbp)}`}
            hint="Fully-loaded contact-centre or marketing cost per outbound contact"
          >
            <Slider
              value={[rule.costPerContactGbp * 100]}
              min={0}
              max={10000}
              step={25}
              onValueChange={(v) => onPatch({ costPerContactGbp: v[0] / 100 })}
            />
          </FieldRow>
        </Section>

        {/* Eligibility */}
        <Section title="Eligibility" icon={Filter}>
          <FieldRow
            label="Eligible packages"
            hint="Restrict this rule to specific TalkTalk packages. Empty = all packages."
          >
            {productOptions.length === 0 ? (
              <div className="text-xs text-muted-foreground italic">
                No active products in the catalogue.
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {productOptions.map((name) => {
                  const checked = rule.eligiblePackages.includes(name);
                  return (
                    <button
                      key={name}
                      onClick={() => togglePackage(name)}
                      className={cn(
                        "px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors",
                        checked
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            )}
          </FieldRow>

          <FieldRow
            label="Trigger thresholds"
            icon={CalendarClock}
            hint="Customer must meet ALL non-empty thresholds to receive this NBA"
          >
            <div className="grid sm:grid-cols-2 gap-2.5">
              <ThresholdInput
                label="Loyalty calls (90d) ≥"
                value={rule.thresholds.loyaltyCalls90d}
                onChange={(v) => setThreshold("loyaltyCalls90d", v)}
              />
              <ThresholdInput
                label="Hold seconds ≥"
                value={rule.thresholds.holdSeconds}
                onChange={(v) => setThreshold("holdSeconds", v)}
              />
              <ThresholdInput
                label="Days out of contract ≥"
                value={rule.thresholds.oocDays}
                onChange={(v) => setThreshold("oocDays", v)}
              />
              <ThresholdInput
                label="Speed deficit % ≥"
                value={rule.thresholds.speedDeficitPct == null ? null : rule.thresholds.speedDeficitPct * 100}
                onChange={(v) => setThreshold("speedDeficitPct", v == null ? null : v / 100)}
                step={1}
              />
              <ThresholdInput
                label="Monthly download GB ≥"
                value={rule.thresholds.monthlyDownloadGb}
                onChange={(v) => setThreshold("monthlyDownloadGb", v)}
              />
            </div>
          </FieldRow>
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
        <Icon className="size-3.5" />
        {title}
      </div>
      {children}
    </div>
  );
}

function FieldRow({
  label,
  hint,
  icon: Icon,
  children,
}: {
  label: string;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        {Icon && <Icon className="size-3.5 text-muted-foreground" />}
        {label}
      </div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5 mb-2">{hint}</div>}
      {children}
    </div>
  );
}

function ThresholdInput({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  step?: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <Input
        type="number"
        step={step}
        value={value ?? ""}
        placeholder="—"
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === "" ? null : Number(raw));
        }}
        className="h-8 text-sm"
      />
    </label>
  );
}
