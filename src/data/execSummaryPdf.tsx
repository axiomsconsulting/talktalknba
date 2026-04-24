// Executive summary PDF — generated client-side with @react-pdf/renderer.
// Captures: ROI toggle view, slider inputs, top drivers, treatment matrix.

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
  Font,
} from "@react-pdf/renderer";
import { roiParams, treatmentMatrix, featureImportance, featureLabels, formatGbp, formatNumber } from "./nba";
import { computeDeciles, summariseScenario, type RoiViewMode } from "./scenarioStore";

const COLORS = {
  primary: "#C8268C",
  primaryDark: "#7A1B5C",
  text: "#1F1A2E",
  muted: "#6B6478",
  border: "#E5E0EA",
  success: "#2E8B57",
  danger: "#C03B23",
  bg: "#FFFFFF",
  surface: "#FAF6FA",
};

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, color: COLORS.text, fontFamily: "Helvetica" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 18,
    paddingBottom: 12,
    borderBottom: `1px solid ${COLORS.border}`,
  },
  brand: { fontSize: 9, color: COLORS.primary, fontFamily: "Helvetica-Bold", letterSpacing: 1.2 },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", marginTop: 4, color: COLORS.text },
  subtitle: { fontSize: 10, color: COLORS.muted, marginTop: 2 },
  meta: { fontSize: 9, color: COLORS.muted, textAlign: "right" },
  section: { marginTop: 16 },
  sectionLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: COLORS.primary,
    letterSpacing: 1,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    marginBottom: 8,
    color: COLORS.text,
  },
  kpiRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  kpiCard: {
    flex: 1,
    padding: 10,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 6,
    backgroundColor: COLORS.surface,
  },
  kpiLabel: { fontSize: 7, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 0.8 },
  kpiValue: { fontSize: 14, fontFamily: "Helvetica-Bold", color: COLORS.text, marginTop: 3 },
  kpiSub: { fontSize: 8, color: COLORS.muted, marginTop: 2 },
  sliderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderBottom: `1px solid ${COLORS.border}`,
  },
  sliderLabel: { color: COLORS.muted, fontSize: 9 },
  sliderValue: { fontFamily: "Helvetica-Bold", color: COLORS.primary },
  table: { border: `1px solid ${COLORS.border}`, borderRadius: 6, overflow: "hidden" },
  tableHead: {
    flexDirection: "row",
    backgroundColor: COLORS.surface,
    borderBottom: `1px solid ${COLORS.border}`,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  th: { fontSize: 8, fontFamily: "Helvetica-Bold", color: COLORS.muted, textTransform: "uppercase" },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottom: `1px solid ${COLORS.border}`,
  },
  td: { fontSize: 9, color: COLORS.text },
  callout: {
    padding: 10,
    backgroundColor: COLORS.surface,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 6,
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: COLORS.muted,
    paddingTop: 6,
    borderTop: `1px solid ${COLORS.border}`,
  },
  bar: { height: 6, backgroundColor: COLORS.primary, borderRadius: 3 },
  barTrack: { height: 6, backgroundColor: COLORS.border, borderRadius: 3, flex: 1 },
});

export type SummaryInputs = {
  budget: number;
  successRate: number;
  callCost: number;
  view: RoiViewMode;
};

const VIEW_LABELS: Record<RoiViewMode, string> = {
  lift: "Targeted lift over baseline",
  gross: "Gross saves minus costs",
  compare: "Top-decile vs random",
};

function ExecSummaryDocument({ inputs }: { inputs: SummaryInputs }) {
  const deciles = computeDeciles({
    ...inputs,
    highRiskVolume: roiParams.highRiskVolume,
    averageAnnualArpuGbp: roiParams.averageAnnualArpuGbp,
    baselineRetentionConversionRate: roiParams.baselineRetentionConversionRate,
  });
  const totals = summariseScenario(deciles);
  const topDrivers = [...featureImportance].slice(0, 5);
  const generatedAt = new Date().toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.brand}>TALKTALK · NBA CHURN PREVENTION</Text>
            <Text style={styles.title}>Executive Summary</Text>
            <Text style={styles.subtitle}>
              Live scenario from the Retention Prioritisation Dashboard
            </Text>
          </View>
          <View>
            <Text style={styles.meta}>Generated {generatedAt}</Text>
            <Text style={styles.meta}>Model v2.4 · AUC 0.87</Text>
          </View>
        </View>

        {/* KPI summary */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>HEADLINE METRICS</Text>
          <View style={styles.kpiRow}>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Customer base</Text>
              <Text style={styles.kpiValue}>{formatNumber(roiParams.totalCustomerBase, { compact: true })}</Text>
              <Text style={styles.kpiSub}>scored weekly</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Customers at risk</Text>
              <Text style={styles.kpiValue}>{formatNumber(roiParams.highRiskVolume, { compact: true })}</Text>
              <Text style={styles.kpiSub}>p ≥ 0.65</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Revenue at risk</Text>
              <Text style={styles.kpiValue}>{formatGbp(roiParams.revenueAtRiskGbp, { compact: true })}</Text>
              <Text style={styles.kpiSub}>£420 avg ARPU</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Net ROI · this scenario</Text>
              <Text style={[styles.kpiValue, { color: COLORS.primary }]}>
                {formatGbp(totals.totalTargetedNet, { compact: true })}
              </Text>
              <Text style={styles.kpiSub}>
                vs random {formatGbp(totals.totalRandomNet, { compact: true })}
              </Text>
            </View>
          </View>
        </View>

        {/* Selected ROI view + slider inputs */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SELECTED VIEW</Text>
          <View style={styles.callout}>
            <Text style={{ fontSize: 12, fontFamily: "Helvetica-Bold", color: COLORS.text }}>
              {VIEW_LABELS[inputs.view]}
            </Text>
            <Text style={{ fontSize: 9, color: COLORS.muted, marginTop: 3 }}>
              {inputs.view === "lift"
                ? "Net £ saves attributable to the model — incremental over the 15% baseline retention rate."
                : inputs.view === "gross"
                  ? "Total revenue saved by the campaign minus the full campaign cost (call + budget)."
                  : "Compares ROI when targeting top-decile risk customers against a random sample of equal size."}
            </Text>
          </View>
          <View style={[styles.table, { marginTop: 8 }]}>
            <View style={styles.sliderRow}>
              <Text style={styles.sliderLabel}>Retention budget per saved customer</Text>
              <Text style={styles.sliderValue}>£{inputs.budget}</Text>
            </View>
            <View style={styles.sliderRow}>
              <Text style={styles.sliderLabel}>Expected intervention success rate</Text>
              <Text style={styles.sliderValue}>{(inputs.successRate * 100).toFixed(0)}%</Text>
            </View>
            <View style={styles.sliderRow}>
              <Text style={styles.sliderLabel}>Cost of outbound call</Text>
              <Text style={styles.sliderValue}>£{inputs.callCost.toFixed(2)}</Text>
            </View>
            <View style={[styles.sliderRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.sliderLabel}>Customers contacted · saved</Text>
              <Text style={styles.sliderValue}>
                {formatNumber(totals.totalContacted, { compact: true })} · {formatNumber(totals.totalSaved, { compact: true })}
              </Text>
            </View>
          </View>
        </View>

        {/* Dilution + LTV-budget callout */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>REVENUE DILUTION & LTV BUDGET</Text>
          <View style={styles.kpiRow}>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Gross retained · contract horizon</Text>
              <Text style={styles.kpiValue}>
                {formatGbp(totals.totalSaved * (roiParams.averageAnnualArpuGbp / 12) * 24, { compact: true })}
              </Text>
              <Text style={styles.kpiSub}>saved customers × ARPU × 24mo</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Revenue dilution</Text>
              <Text style={[styles.kpiValue, { color: COLORS.danger }]}>
                −{formatGbp(totals.totalSaved * inputs.budget * 12, { compact: true })}
              </Text>
              <Text style={styles.kpiSub}>£{inputs.budget}/mo discount × 12mo × saves</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Avg saved-customer LTV</Text>
              <Text style={styles.kpiValue}>
                {formatGbp((roiParams.averageAnnualArpuGbp / 12) * 27, { compact: true })}
              </Text>
              <Text style={styles.kpiSub}>tenure-based churn-adjusted horizon</Text>
            </View>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>% of LTV used as budget</Text>
              <Text style={[styles.kpiValue, { color: COLORS.primary }]}>
                {totals.totalSaved > 0
                  ? (((inputs.budget * 12) / ((roiParams.averageAnnualArpuGbp / 12) * 27)) * 100).toFixed(1) + "%"
                  : "—"}
              </Text>
              <Text style={styles.kpiSub}>discount + cost-to-serve / LTV</Text>
            </View>
          </View>
        </View>

        {/* Top drivers */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>TOP CHURN DRIVERS · GLOBAL FEATURE IMPORTANCE</Text>
          <View>
            {topDrivers.map((d) => {
              const label = featureLabels[d.feature]?.label ?? d.feature;
              const pct = (d.importance * 100).toFixed(1);
              const widthPct = `${Math.round(d.importance * 100)}%`;
              return (
                <View
                  key={d.feature}
                  style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}
                >
                  <Text style={{ width: 130, fontSize: 9, color: COLORS.text }}>{label}</Text>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <View style={styles.barTrack}>
                      <View
                        style={{
                          height: 6,
                          width: widthPct,
                          backgroundColor: COLORS.primary,
                          borderRadius: 3,
                        }}
                      />
                    </View>
                  </View>
                  <Text style={{ width: 40, fontSize: 9, color: COLORS.muted, textAlign: "right" }}>
                    {pct}%
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>TalkTalk NBA · Confidential — for internal commercial review</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>

      {/* Page 2: treatment matrix */}
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.brand}>TALKTALK · NBA CHURN PREVENTION</Text>
            <Text style={styles.title}>Treatment matrix</Text>
            <Text style={styles.subtitle}>
              Risk × context → next best action with live volumes from the segment distribution
            </Text>
          </View>
          <View>
            <Text style={styles.meta}>Generated {generatedAt}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.table}>
            <View style={styles.tableHead}>
              <Text style={[styles.th, { flex: 2 }]}>Segment</Text>
              <Text style={[styles.th, { flex: 3 }]}>Action</Text>
              <Text style={[styles.th, { flex: 1.2 }]}>Channel</Text>
              <Text style={[styles.th, { flex: 1, textAlign: "right" }]}>Volume</Text>
              <Text style={[styles.th, { flex: 1.2, textAlign: "right" }]}>Lift</Text>
            </View>
            {treatmentMatrix.map((row) => {
              const volume = Math.round(roiParams.totalCustomerBase * row.shareOfBase);
              const isSuppress = row.channel === "Suppress";
              return (
                <View key={row.segment} style={styles.tableRow}>
                  <View style={{ flex: 2 }}>
                    <Text style={[styles.td, { fontFamily: "Helvetica-Bold" }]}>{row.segment}</Text>
                    <Text style={[styles.td, { color: COLORS.muted, fontSize: 8, marginTop: 1 }]}>
                      {row.context}
                    </Text>
                  </View>
                  <Text style={[styles.td, { flex: 3, paddingRight: 6 }]}>{row.action}</Text>
                  <Text
                    style={[
                      styles.td,
                      {
                        flex: 1.2,
                        color: isSuppress ? COLORS.muted : COLORS.primary,
                        fontFamily: "Helvetica-Bold",
                      },
                    ]}
                  >
                    {row.channel}
                  </Text>
                  <View style={{ flex: 1, alignItems: "flex-end" }}>
                    <Text style={[styles.td, { fontFamily: "Helvetica-Bold" }]}>
                      {formatNumber(volume, { compact: true })}
                    </Text>
                    <Text style={[styles.td, { color: COLORS.muted, fontSize: 8 }]}>
                      {(row.shareOfBase * 100).toFixed(0)}% of base
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.td,
                      {
                        flex: 1.2,
                        textAlign: "right",
                        color: isSuppress ? COLORS.muted : COLORS.success,
                        fontFamily: "Helvetica-Bold",
                      },
                    ]}
                  >
                    {row.expectedLift}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        <View style={[styles.section, styles.callout]}>
          <Text style={[styles.sectionLabel, { marginBottom: 4 }]}>OPERATIONAL NOTE</Text>
          <Text style={{ fontSize: 9, lineHeight: 1.4 }}>
            Suppression of long-tenure low-risk customers is critical: outbound contact erodes
            satisfaction and can induce the churn the model is designed to prevent. Volumes assume
            the full 3.5M scored base; weekly campaign sizing should respect contact-centre capacity
            caps and contention rules in the decisioning engine.
          </Text>
        </View>

        <View style={styles.footer} fixed>
          <Text>TalkTalk NBA · Confidential — for internal commercial review</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function generateExecSummaryPdf(inputs: SummaryInputs): Promise<Blob> {
  const blob = await pdf(<ExecSummaryDocument inputs={inputs} />).toBlob();
  return blob;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
