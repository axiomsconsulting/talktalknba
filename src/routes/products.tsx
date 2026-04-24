import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Package, Plus, RotateCcw, Trash2, Check, Pencil } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import {
  useProductStore,
  type Product,
  type ProductCategory,
} from "@/data/products";
import { formatGbp } from "@/data/nba";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/products")({
  head: () => ({
    meta: [
      { title: "Product catalogue — TalkTalk NBA" },
      {
        name: "description",
        content:
          "Editable TalkTalk product and pricing catalogue used by the churn-prevention ROI engine and Next Best Action treatments.",
      },
      { property: "og:title", content: "TalkTalk Product Catalogue" },
      {
        property: "og:description",
        content:
          "Operator-editable list of TalkTalk packages, prices and contract terms — drives downstream NBA scoring.",
      },
    ],
  }),
  component: ProductsPage,
});

const CATEGORIES: ProductCategory[] = [
  "Broadband",
  "TalkTalk U",
  "Add-on",
  "Voice",
  "Legacy",
];

function ProductsPage() {
  const products = useProductStore((s) => s.products);
  const updateProduct = useProductStore((s) => s.updateProduct);
  const addProduct = useProductStore((s) => s.addProduct);
  const removeProduct = useProductStore((s) => s.removeProduct);
  const resetCatalogue = useProductStore((s) => s.resetCatalogue);

  const [filter, setFilter] = useState<ProductCategory | "All">("All");
  const [editingId, setEditingId] = useState<string | null>(null);

  const filtered =
    filter === "All" ? products : products.filter((p) => p.category === filter);

  const handleAdd = () => {
    const id = `custom-${Date.now()}`;
    addProduct({
      id,
      name: "New package",
      category: "Broadband",
      technology: "FTTP",
      speedMbps: 0,
      monthlyPriceGbp: 0,
      contractMonths: 24,
      description: "",
      active: true,
    });
    setEditingId(id);
  };

  const totals = {
    active: products.filter((p) => p.active).length,
    total: products.length,
    avg:
      products.filter((p) => p.active && (p.category === "Broadband" || p.category === "TalkTalk U")).length > 0
        ? products
            .filter((p) => p.active && (p.category === "Broadband" || p.category === "TalkTalk U"))
            .reduce((s, p) => s + p.monthlyPriceGbp, 0) /
          products.filter((p) => p.active && (p.category === "Broadband" || p.category === "TalkTalk U")).length
        : 0,
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="Operator console · Pricing"
        title="Product catalogue"
        description="The packages, prices and contract terms the NBA engine reasons about. Edit a row to override the live TalkTalk price; the change flows through to the ROI simulator and the right-size / free tech upgrade actions."
      />

      <div className="px-5 sm:px-8 lg:px-10 py-7 space-y-6">
        {/* Summary strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard label="Active SKUs" value={`${totals.active}`} sub={`${totals.total} total`} />
          <SummaryCard
            label="Avg broadband price"
            value={formatGbp(totals.avg)}
            sub="across active broadband + TalkTalk U"
          />
          <SummaryCard
            label="Cheapest active"
            value={formatGbp(
              Math.min(...products.filter((p) => p.active).map((p) => p.monthlyPriceGbp)),
            )}
            sub="entry-tier offer"
          />
          <SummaryCard
            label="Top tier"
            value={formatGbp(
              Math.max(...products.filter((p) => p.active).map((p) => p.monthlyPriceGbp)),
            )}
            sub="flagship offer"
          />
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {(["All", ...CATEGORIES] as const).map((c) => (
              <button
                key={c}
                onClick={() => setFilter(c)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
                  filter === c
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={resetCatalogue}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-border bg-card text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="size-3.5" /> Reset to TalkTalk defaults
            </button>
            <button
              onClick={handleAdd}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary-deep"
            >
              <Plus className="size-3.5" /> Add package
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-sm)] overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <Package className="size-4 text-primary" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">TalkTalk packages</h3>
              <p className="text-xs text-muted-foreground">
                Click a row to edit. Changes save automatically and persist locally.
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-2.5 font-semibold">Name</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Category</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Tech</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Speed</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Price / mo</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Contract</th>
                  <th className="text-center px-4 py-2.5 font-semibold">Active</th>
                  <th className="text-right px-4 py-2.5 font-semibold w-20">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <ProductRow
                    key={p.id}
                    product={p}
                    editing={editingId === p.id}
                    onEdit={() => setEditingId(p.id)}
                    onSave={() => setEditingId(null)}
                    onChange={(patch) => updateProduct(p.id, patch)}
                    onRemove={() => {
                      removeProduct(p.id);
                      if (editingId === p.id) setEditingId(null);
                    }}
                  />
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No packages match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Source: live extract from{" "}
          <a
            href="https://www.talktalk.co.uk/"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-dotted hover:text-primary"
          >
            talktalk.co.uk
          </a>{" "}
          (Spring 2026). Annual increases shown on the home page are not applied
          automatically — adjust the price column if you want to model them.
        </p>
      </div>
    </AppShell>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="text-xl font-semibold text-foreground tabular-nums mt-1">{value}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>
    </div>
  );
}

function ProductRow({
  product,
  editing,
  onEdit,
  onSave,
  onChange,
  onRemove,
}: {
  product: Product;
  editing: boolean;
  onEdit: () => void;
  onSave: () => void;
  onChange: (patch: Partial<Product>) => void;
  onRemove: () => void;
}) {
  if (!editing) {
    return (
      <tr className={cn("border-b border-border/60 hover:bg-muted/30", !product.active && "opacity-55")}>
        <td className="px-4 py-3">
          <div className="font-medium text-foreground">{product.name}</div>
          <div className="text-[11px] text-muted-foreground line-clamp-1 max-w-md">
            {product.description}
          </div>
        </td>
        <td className="px-4 py-3 text-muted-foreground">{product.category}</td>
        <td className="px-4 py-3 text-muted-foreground">{product.technology}</td>
        <td className="px-4 py-3 text-right tabular-nums">
          {product.speedMbps > 0 ? `${product.speedMbps} Mbps` : "—"}
        </td>
        <td className="px-4 py-3 text-right tabular-nums font-semibold text-foreground">
          {formatGbp(product.monthlyPriceGbp)}
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
          {product.contractMonths === 0 ? "Rolling" : `${product.contractMonths} mo`}
        </td>
        <td className="px-4 py-3 text-center">
          {product.active ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success/10 text-[var(--success)] text-[10px] font-semibold uppercase tracking-wider">
              <Check className="size-3" /> Live
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
              Off
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-right">
          <div className="inline-flex gap-1">
            <button
              onClick={onEdit}
              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              aria-label="Edit"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              onClick={onRemove}
              className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
              aria-label="Remove"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-border/60 bg-primary/5">
      <td className="px-4 py-3">
        <Input
          value={product.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="h-8 text-sm"
        />
        <Input
          value={product.description}
          placeholder="Description shown in matrix"
          onChange={(e) => onChange({ description: e.target.value })}
          className="h-7 text-[11px] mt-1"
        />
      </td>
      <td className="px-4 py-3">
        <select
          value={product.category}
          onChange={(e) => onChange({ category: e.target.value as ProductCategory })}
          className="w-full h-8 px-2 rounded-md border border-input bg-background text-sm"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-3">
        <Input
          value={product.technology}
          onChange={(e) => onChange({ technology: e.target.value })}
          className="h-8 text-sm w-24"
        />
      </td>
      <td className="px-4 py-3 text-right">
        <Input
          type="number"
          value={product.speedMbps}
          onChange={(e) => onChange({ speedMbps: Number(e.target.value) })}
          className="h-8 text-sm w-20 text-right"
        />
      </td>
      <td className="px-4 py-3 text-right">
        <Input
          type="number"
          step="0.01"
          value={product.monthlyPriceGbp}
          onChange={(e) => onChange({ monthlyPriceGbp: Number(e.target.value) })}
          className="h-8 text-sm w-24 text-right"
        />
      </td>
      <td className="px-4 py-3 text-right">
        <Input
          type="number"
          value={product.contractMonths}
          onChange={(e) => onChange({ contractMonths: Number(e.target.value) })}
          className="h-8 text-sm w-20 text-right"
        />
      </td>
      <td className="px-4 py-3 text-center">
        <input
          type="checkbox"
          checked={product.active}
          onChange={(e) => onChange({ active: e.target.checked })}
          className="size-4 accent-[var(--primary)]"
        />
      </td>
      <td className="px-4 py-3 text-right">
        <button
          onClick={onSave}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold bg-primary text-primary-foreground"
        >
          <Check className="size-3" /> Done
        </button>
      </td>
    </tr>
  );
}
