// In-memory store for parsed customer datasets, swappable from the upload page.
// Defaults to mock personas + generated fixtures; can be overridden at runtime
// via setActiveCustomers().

import { create } from "zustand";
import { allCustomers as defaultCustomers, type Customer } from "./customers";

type CustomerStore = {
  customers: Customer[];
  source: { kind: "mock" } | { kind: "uploaded"; filename: string; uploadedAt: string };
  setActive: (customers: Customer[], filename: string) => void;
  reset: () => void;
};

export const useCustomerStore = create<CustomerStore>((set) => ({
  customers: defaultCustomers,
  source: { kind: "mock" },
  setActive: (customers, filename) =>
    set({
      customers,
      source: { kind: "uploaded", filename, uploadedAt: new Date().toISOString() },
    }),
  reset: () => set({ customers: defaultCustomers, source: { kind: "mock" } }),
}));
