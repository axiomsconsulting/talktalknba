// Shared scenario store so the PDF export and other pages can read the
// current Commercial ROI simulator state.

import { create } from "zustand";

export type RoiViewMode = "lift" | "gross";

type ScenarioState = {
  budget: number;
  successRate: number;
  callCost: number;
  view: RoiViewMode;
  setBudget: (v: number) => void;
  setSuccessRate: (v: number) => void;
  setCallCost: (v: number) => void;
  setView: (v: RoiViewMode) => void;
};

export const useScenarioStore = create<ScenarioState>((set) => ({
  budget: 20,
  successRate: 0.18,
  callCost: 4,
  view: "gross",
  setBudget: (v) => set({ budget: v }),
  setSuccessRate: (v) => set({ successRate: v }),
  setCallCost: (v) => set({ callCost: v }),
  setView: (v) => set({ view: v }),
}));

// Pure function so PDF + simulator share the same maths.
export type DecileResult = {
  decile: string;
  targeted: number;
  random: number;
  targetedSaved: number;
  contacted: number;
  targetedRevenueSaved: number;
  randomRevenueSaved: number;
};

export function computeDeciles(input: {
  budget: number;
  successRate: number;
  callCost: number;
  view: RoiViewMode;
  highRiskVolume: number;
  averageAnnualArpuGbp: number;
  baselineRetentionConversionRate: number;
}): DecileResult[] {
  const {
    budget,
    successRate,
    callCost,
    view,
    highRiskVolume,
    averageAnnualArpuGbp: arpu,
    baselineRetentionConversionRate: baseline,
  } = input;

  const decileWeights = [0.27, 0.18, 0.13, 0.10, 0.08, 0.07, 0.06, 0.05, 0.04, 0.02];
  const cohortSize = Math.round(highRiskVolume / 10);
  const totalAtRisk = decileWeights.reduce((a, b) => a + b, 0) * highRiskVolume;
  const avgPerCohort = totalAtRisk / 10;

  return decileWeights.map((w, i) => {
    const targetedAtRisk = w * highRiskVolume;
    const callSpend = cohortSize * callCost;

    const targetedSaved = targetedAtRisk * successRate;
    const targetedBaselineSaved = targetedAtRisk * baseline;
    const targetedIncrSaved = targetedSaved - targetedBaselineSaved;

    const targetedRevenue = targetedSaved * arpu;
    const targetedIncrRevenue = targetedIncrSaved * arpu;
    const targetedBudgetSpend = targetedSaved * budget;
    const targetedTotalCost = callSpend + targetedBudgetSpend;

    const randomSaved = avgPerCohort * successRate;
    const randomBaselineSaved = avgPerCohort * baseline;
    const randomRevenue = randomSaved * arpu;
    const randomIncrRevenue = (randomSaved - randomBaselineSaved) * arpu;
    const randomBudgetSpend = randomSaved * budget;
    const randomTotalCost = callSpend + randomBudgetSpend;

    let targetedNet = 0;
    let randomNet = 0;
    if (view === "lift") {
      targetedNet = targetedIncrRevenue - targetedTotalCost;
      randomNet = randomIncrRevenue - randomTotalCost;
    } else {
      targetedNet = targetedRevenue - targetedTotalCost;
      randomNet = randomRevenue - randomTotalCost;
    }

    return {
      decile: `D${i + 1}`,
      targeted: Math.round(targetedNet),
      random: Math.round(randomNet),
      targetedSaved: Math.round(targetedSaved),
      contacted: cohortSize,
      targetedRevenueSaved: Math.round(targetedRevenue),
      randomRevenueSaved: Math.round(randomRevenue),
    };
  });
}

export function summariseScenario(deciles: DecileResult[]) {
  const totalTargetedNet = deciles.reduce((s, d) => s + d.targeted, 0);
  const totalRandomNet = deciles.reduce((s, d) => s + d.random, 0);
  const totalSaved = deciles.reduce((s, d) => s + d.targetedSaved, 0);
  const totalContacted = deciles.reduce((s, d) => s + d.contacted, 0);
  return { totalTargetedNet, totalRandomNet, totalSaved, totalContacted };
}
