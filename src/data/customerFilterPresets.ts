// Lightweight localStorage-backed store for named CustomerFilters presets.
//
// Persists per-browser so an analyst can flip between common scenarios
// (e.g. "Out-of-contract Fibre 65", "High-risk loyalty callers") without
// re-building the filter set every time.

import { useCallback, useEffect, useState } from "react";
import {
  EMPTY_FILTERS,
  type CustomerFilters,
} from "@/components/CustomerFiltersBar";

const STORAGE_KEY = "tt-nba.customer-filter-presets.v1";

export type CustomerFilterPreset = {
  id: string;
  name: string;
  filters: CustomerFilters;
  createdAt: string;
};

function loadFromStorage(): CustomerFilterPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CustomerFilterPreset[];
    if (!Array.isArray(parsed)) return [];
    // Defensive: merge missing keys with EMPTY_FILTERS to survive shape drift.
    return parsed.map((p) => ({
      ...p,
      filters: { ...EMPTY_FILTERS, ...p.filters },
    }));
  } catch (e) {
    console.warn("[customerFilterPresets] failed to parse storage", e);
    return [];
  }
}

function writeToStorage(presets: CustomerFilterPreset[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch (e) {
    console.warn("[customerFilterPresets] failed to write storage", e);
  }
}

const STORAGE_EVENT = "tt-nba:customer-filter-presets-updated";

export function useCustomerFilterPresets() {
  const [presets, setPresets] = useState<CustomerFilterPreset[]>(() => loadFromStorage());

  useEffect(() => {
    const refresh = () => setPresets(loadFromStorage());
    window.addEventListener(STORAGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(STORAGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const save = useCallback((name: string, filters: CustomerFilters) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const current = loadFromStorage();
    const existing = current.find((p) => p.name.toLowerCase() === trimmed.toLowerCase());
    let next: CustomerFilterPreset[];
    let saved: CustomerFilterPreset;
    if (existing) {
      saved = { ...existing, filters, createdAt: new Date().toISOString() };
      next = current.map((p) => (p.id === existing.id ? saved : p));
    } else {
      saved = {
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `preset-${Date.now()}`,
        name: trimmed,
        filters,
        createdAt: new Date().toISOString(),
      };
      next = [...current, saved];
    }
    writeToStorage(next);
    setPresets(next);
    window.dispatchEvent(new Event(STORAGE_EVENT));
    return saved;
  }, []);

  const remove = useCallback((id: string) => {
    const next = loadFromStorage().filter((p) => p.id !== id);
    writeToStorage(next);
    setPresets(next);
    window.dispatchEvent(new Event(STORAGE_EVENT));
  }, []);

  return { presets, save, remove };
}
