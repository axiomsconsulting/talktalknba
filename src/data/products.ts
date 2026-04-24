// TalkTalk consumer broadband packages — extracted from talktalk.co.uk
// (April 2026 retail prices). These are the prices the ROI engine and the
// "right-size" / "free tech upgrade" NBA actions reason about. The product
// catalogue is editable from /products so an operator can adjust prices,
// add new bundles, or hide retired SKUs without a code change.

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ProductCategory = "Broadband" | "TalkTalk U" | "Add-on" | "Voice" | "Legacy";

export type Product = {
  id: string;
  name: string;
  category: ProductCategory;
  technology: string;
  // Average download speed in Mbps (0 for non-broadband add-ons).
  speedMbps: number;
  // Current monthly price in GBP.
  monthlyPriceGbp: number;
  // Contract length in months. 0 = no contract.
  contractMonths: number;
  // Plain-English one-liner for the product picker / matrix.
  description: string;
  // Whether this product is currently sold to new customers.
  active: boolean;
};

// Source: https://www.talktalk.co.uk (Spring 2026 pricing snapshot).
export const TALKTALK_PRODUCTS: Product[] = [
  {
    id: "fibre-35",
    name: "Fibre 35",
    category: "Broadband",
    technology: "FTTC (part-fibre)",
    speedMbps: 35,
    monthlyPriceGbp: 26.0,
    contractMonths: 24,
    description: "Entry FTTC line, 35 Mbps average download. From £26/mo (rises to £30 in Apr 2027, £34 in Apr 2028).",
    active: true,
  },
  {
    id: "fibre-65",
    name: "Fibre 65",
    category: "Broadband",
    technology: "FTTC (part-fibre)",
    speedMbps: 67,
    monthlyPriceGbp: 26.0,
    contractMonths: 24,
    description: "Standard FTTC line, ~67 Mbps. From £26/mo (rises to £30 in Apr 2027, £34 in Apr 2028).",
    active: true,
  },
  {
    id: "full-fibre-150",
    name: "Full Fibre 150",
    category: "Broadband",
    technology: "FTTP",
    speedMbps: 150,
    monthlyPriceGbp: 24.0,
    contractMonths: 24,
    description: "Entry full-fibre, 150 Mbps average. From £24/mo (rises to £28 in Apr 2027, £32 in Apr 2028).",
    active: true,
  },
  {
    id: "full-fibre-500",
    name: "Full Fibre 500",
    category: "Broadband",
    technology: "FTTP",
    speedMbps: 500,
    monthlyPriceGbp: 30.0,
    contractMonths: 24,
    description: "Mid-tier full-fibre, 500 Mbps. £30/mo (rises to £34 in Apr 2027, £38 in Apr 2028).",
    active: true,
  },
  {
    id: "full-fibre-900",
    name: "Full Fibre 900",
    category: "Broadband",
    technology: "FTTP",
    speedMbps: 900,
    monthlyPriceGbp: 36.0,
    contractMonths: 24,
    description: "Top-tier full-fibre, 900 Mbps. From £36/mo (rises to £40 in Apr 2027, £44 in Apr 2028).",
    active: true,
  },
  {
    id: "talktalk-u-tier-1",
    name: "TalkTalk U · Tier 1",
    category: "TalkTalk U",
    technology: "FTTP (adaptive)",
    speedMbps: 150,
    monthlyPriceGbp: 28.0,
    contractMonths: 24,
    description: "Adaptive full-fibre that scales with use. From £28/mo.",
    active: true,
  },
  {
    id: "talktalk-u-tier-2",
    name: "TalkTalk U · Tier 2",
    category: "TalkTalk U",
    technology: "FTTP (adaptive)",
    speedMbps: 500,
    monthlyPriceGbp: 31.0,
    contractMonths: 24,
    description: "Adaptive full-fibre, mid-band. From £31/mo.",
    active: true,
  },
  {
    id: "talktalk-u-tier-3",
    name: "TalkTalk U · Tier 3",
    category: "TalkTalk U",
    technology: "FTTP (adaptive)",
    speedMbps: 900,
    monthlyPriceGbp: 34.0,
    contractMonths: 24,
    description: "Adaptive full-fibre, top-band. From £34/mo.",
    active: true,
  },
  {
    id: "fast-broadband",
    name: "Fast Broadband",
    category: "Legacy",
    technology: "ADSL",
    speedMbps: 11,
    monthlyPriceGbp: 29.95,
    contractMonths: 24,
    description: "ADSL legacy product. £29.95/mo. Retired for new customers in many areas.",
    active: false,
  },
  {
    id: "supersafe",
    name: "SuperSafe",
    category: "Add-on",
    technology: "Security",
    speedMbps: 0,
    monthlyPriceGbp: 6.0,
    contractMonths: 0,
    description: "Anti-virus, scam protection and content filtering. £6/mo add-on.",
    active: true,
  },
  {
    id: "total-home-wifi",
    name: "Total Home Wi-Fi",
    category: "Add-on",
    technology: "Mesh",
    speedMbps: 0,
    monthlyPriceGbp: 8.0,
    contractMonths: 0,
    description: "Wi-Fi boosters to eliminate blackspots. £8/mo add-on.",
    active: true,
  },
  {
    id: "digital-voice",
    name: "Digital Voice",
    category: "Voice",
    technology: "VoIP",
    speedMbps: 0,
    monthlyPriceGbp: 2.0,
    contractMonths: 24,
    description: "Keep your landline number on a digital line. From £2/mo.",
    active: true,
  },
];

// Editable product catalogue. Persisted in localStorage so an operator's
// price overrides survive a refresh without a backend round-trip.
type ProductState = {
  products: Product[];
  updateProduct: (id: string, patch: Partial<Product>) => void;
  addProduct: (p: Product) => void;
  removeProduct: (id: string) => void;
  resetCatalogue: () => void;
};

export const useProductStore = create<ProductState>()(
  persist(
    (set) => ({
      products: TALKTALK_PRODUCTS,
      updateProduct: (id, patch) =>
        set((s) => ({
          products: s.products.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        })),
      addProduct: (p) => set((s) => ({ products: [...s.products, p] })),
      removeProduct: (id) =>
        set((s) => ({ products: s.products.filter((p) => p.id !== id) })),
      resetCatalogue: () => set({ products: TALKTALK_PRODUCTS }),
    }),
    { name: "talktalk-products-v1" },
  ),
);

// Derived helpers used elsewhere in the app.
export function activeProducts(products: Product[]): Product[] {
  return products.filter((p) => p.active);
}

export function averageBroadbandArpu(products: Product[]): number {
  const broadband = products.filter(
    (p) => p.active && (p.category === "Broadband" || p.category === "TalkTalk U"),
  );
  if (broadband.length === 0) return 0;
  const sum = broadband.reduce((acc, p) => acc + p.monthlyPriceGbp, 0);
  return sum / broadband.length;
}
