// Save / load / delete UI for named CustomerFilters presets.
//
// Sits above CustomerFiltersBar on the Explainability page. Presets are
// localStorage-backed via useCustomerFilterPresets, so they're per-browser.

import { useState } from "react";
import { Bookmark, Save, Trash2, Check, ChevronDown, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  countActiveFilters,
  type CustomerFilters,
} from "@/components/CustomerFiltersBar";
import {
  useCustomerFilterPresets,
  type CustomerFilterPreset,
} from "@/data/customerFilterPresets";
import { cn } from "@/lib/utils";

export function CustomerFilterPresetsBar({
  filters,
  onLoad,
  className,
}: {
  filters: CustomerFilters;
  onLoad: (filters: CustomerFilters) => void;
  className?: string;
}) {
  const { presets, save, remove } = useCustomerFilterPresets();
  const [savingOpen, setSavingOpen] = useState(false);
  const [name, setName] = useState("");
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const activeFilterCount = countActiveFilters(filters);

  const handleSave = () => {
    const result = save(name, filters);
    if (result) {
      setActivePresetId(result.id);
      setName("");
      setSavingOpen(false);
    }
  };

  const handleLoad = (preset: CustomerFilterPreset) => {
    onLoad(preset.filters);
    setActivePresetId(preset.id);
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground mr-1">
        <Bookmark className="size-3.5" />
        <span>Presets</span>
      </div>

      {/* Load preset dropdown */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[11px] gap-1"
            disabled={presets.length === 0}
          >
            {presets.length === 0
              ? "No presets saved"
              : activePresetId
                ? presets.find((p) => p.id === activePresetId)?.name ?? "Load preset"
                : "Load preset"}
            <ChevronDown className="size-3 opacity-70" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
            Saved presets
          </div>
          {presets.length === 0 ? (
            <div className="text-[11px] text-muted-foreground px-2 py-3 text-center italic">
              Save the current filter selection to recall it later.
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-1">
              {presets.map((p) => {
                const n = countActiveFilters(p.filters);
                const isActive = activePresetId === p.id;
                return (
                  <div
                    key={p.id}
                    className={cn(
                      "group flex items-center gap-2 px-2 py-1.5 rounded text-[12px] cursor-pointer",
                      isActive ? "bg-primary/10" : "hover:bg-muted",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => handleLoad(p)}
                      className="flex-1 min-w-0 flex items-center gap-2 text-left"
                    >
                      {isActive && <Check className="size-3 text-primary shrink-0" />}
                      <span className="truncate font-medium text-foreground">{p.name}</span>
                      <Badge variant="secondary" className="h-4 px-1 text-[9px] shrink-0">
                        {n} filter{n === 1 ? "" : "s"}
                      </Badge>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (activePresetId === p.id) setActivePresetId(null);
                        remove(p.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-background text-muted-foreground hover:text-[var(--risk-high)]"
                      aria-label={`Delete preset ${p.name}`}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* Save preset */}
      <Popover open={savingOpen} onOpenChange={setSavingOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[11px] gap-1"
            disabled={activeFilterCount === 0}
            title={
              activeFilterCount === 0
                ? "Add at least one filter to save a preset"
                : "Save current filters as a preset"
            }
          >
            <Save className="size-3" />
            Save preset
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-3 space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Name this preset
          </div>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. OOC Fibre 65 + loyalty calls"
            className="h-8 text-[12px]"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
            }}
            autoFocus
          />
          <div className="text-[10px] text-muted-foreground">
            Captures all multi-selects and ranges currently applied
            ({activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"}).
          </div>
          <div className="flex justify-end gap-1.5 pt-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => {
                setName("");
                setSavingOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 px-3 text-[11px]"
              onClick={handleSave}
              disabled={name.trim().length === 0}
            >
              Save
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {activePresetId && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setActivePresetId(null)}
          className="h-7 px-2 text-[11px] text-muted-foreground"
          title="Clear active preset reference"
        >
          <X className="size-3 mr-1" />
          Clear preset
        </Button>
      )}
    </div>
  );
}
