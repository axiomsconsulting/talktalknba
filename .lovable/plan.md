## Problem

In the **NBA Scenario Simulator** the three view-mode buttons are statistician's labels — they don't say what a retention or finance lead actually wants to know:

| Today                        | What it actually computes (per the code)                                                  |
|------------------------------|--------------------------------------------------------------------------------------------|
| Targeted lift over baseline  | Net £ from **incremental** saves only (saves above the 15% no-model baseline) − all costs |
| Gross saves minus costs      | Net £ from **all** saves (including ones that would have stayed anyway) − all costs       |
| Top-decile vs random         | Same as "Gross", but the chart re-orients around the model-vs-random comparison           |

The labels also overlap with the comparison table directly underneath (which already shows "Top-decile vs random"), so the third button feels redundant.

## What changes

### 1. Rename the three view modes in retention-industry language

Replace the toggle labels and tooltips with telco-retention terminology a Head of Retention or CFO uses day-to-day:

| Old label                       | New label                          | Plain-English description shown under the chart                                                 |
|---------------------------------|------------------------------------|--------------------------------------------------------------------------------------------------|
| Targeted lift over baseline     | **Incremental margin (model-only)** | Revenue we keep that we would have lost without the model, minus retention spend & call cost.   |
| Gross saves minus costs         | **Total retained revenue (net)**    | Every saved customer's revenue (incl. natural saves), minus retention spend & call cost.        |
| Top-decile vs random            | _removed_ (it's the same maths as "Total retained revenue" — the comparison already lives in the table below) |

Keep two view-modes only — `lift` and `gross`. Remove the `compare` mode from the store and the toggle. The model-vs-random bars and the comparison table stay visible in **both** view-modes (they are the most-asked question), so no information is lost.

### 2. Surface the headline scenario figure at a glance

Today the most important number for a retention lead — "**how much money does this scenario make us at the chosen sliders?**" — is buried in a small card on the left. Promote a single hero KPI strip directly under the simulator title with the four numbers that matter for a scenario run:

```text
┌─ Net retained revenue ─┬─ Customers we save ─┬─ Cost per saved customer ─┬─ Uplift vs random ─┐
│  £4.2M                 │  18,400             │  £36                       │  +£1.8M            │
└────────────────────────┴─────────────────────┴────────────────────────────┴────────────────────┘
```

These four are the only ones a finance/retention lead needs in a scenario discussion:
- **Net retained revenue** — bottom line for the chosen scenario
- **Customers we save** — operational volume to staff for
- **Cost per saved customer** — efficiency check vs ARPU/LTV
- **Uplift vs random** — the model's contribution (proves why we use it)

### 3. Tidy the surrounding clutter

- Drop the existing 5-row "Targeted at this scenario" mini-card on the left (its contents are now in the hero strip).
- Keep the slider column (Budget, Success rate, Call cost) as-is — those are the three levers and they're already industry-standard.
- Keep the per-decile bar chart and the top-decile-vs-random table — both are the visual proof of the headline numbers.
- Tooltip on each KPI explains the formula (consistent with the existing provenance/tally policy).

## Files

- `src/data/scenarioStore.ts` — drop the `"compare"` mode; default `view` to `"gross"` (renamed *Total retained revenue*).
- `src/components/RoiSimulator.tsx` — relabel toggle, drop third button, promote the four headline KPIs into a hero strip, remove the old "Targeted at this scenario" mini-card.
- `src/components/SensitivityPanel.tsx` and `PerTriggerSensitivityPanel.tsx` — no behaviour change; these already consume `view` and will continue to read `"lift"` or `"gross"`.

## Out of scope

- The sliders themselves. They are already telco-standard (per-saved-customer budget, success rate, cost per outbound dial) and the user did not ask to change them.
- The per-rule financial breakdown table at the bottom of the simulator.
- The Sensitivity grid below.
