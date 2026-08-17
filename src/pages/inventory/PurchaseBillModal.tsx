import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Banknote,
  Boxes,
  Check,
  CreditCard,
  FileText,
  PackagePlus,
  Paperclip,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { Rial } from "@/components/ui/RiyalSymbol";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { displayName as dn } from "@/lib/utils/display";
import type { Purchase, Supplier } from "@/types";

type Mode = "simple" | "receiving";
type Payment = "cash" | "card" | "bank_transfer";
type Tax = "included" | "excluded";
type Product = {
  id: string;
  name: string;
  name_ar: string | null;
  sku: string | null;
  barcode: string | null;
  unit: string | null;
  stock_quantity: number | null;
  cost: number | null;
};
type Unit = {
  id: string;
  name: string;
  name_ar: string | null;
  conversion_to_base: number;
  quantity_scale: number;
  version: number;
  is_base: boolean;
  is_active: boolean;
  receiving_enabled: boolean;
};
type Line = {
  id: string;
  productId: string;
  unitId: string;
  quantity: string;
  unitCost: string;
};
interface Props {
  open: boolean;
  suppliers: Supplier[];
  tenantId: string;
  branchId: string;
  editingPurchase?: Purchase | null;
  onClose: () => void;
  onSaved: () => void;
}
const line = (): Line => ({
  id: crypto.randomUUID(),
  productId: "",
  unitId: "",
  quantity: "",
  unitCost: "",
});
const money = (n: number) => Math.max(0, Math.round(n * 100) / 100);
const total = (n: number, t: Tax) =>
  t === "included"
    ? {
        subtotal: money(n - (n * 15) / 115),
        vat: money((n * 15) / 115),
        total: money(n),
      }
    : { subtotal: money(n), vat: money(n * 0.15), total: money(n * 1.15) };
function Section({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[#dfe7df] bg-white p-4">
      <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[#31543f]">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#e5efe6] text-[10px]">
          {n}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

export default function PurchaseBillModal({
  open,
  suppliers,
  tenantId,
  branchId,
  editingPurchase = null,
  onClose,
  onSaved,
}: Props) {
  const { profile } = useAuth();
  const { t } = useTranslation(["purchases", "common"]);
  const [mode, setMode] = useState<Mode | null>(
    editingPurchase ? "simple" : null,
  );
  const [date, setDate] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [bill, setBill] = useState("");
  const [payment, setPayment] = useState<Payment | null>(null);
  const [tax, setTax] = useState<Tax | null>(null);
  const [amount, setAmount] = useState("");
  const [lines, setLines] = useState<Line[]>([line()]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState(false);
  const [units, setUnits] = useState<Record<string, Unit[]>>({});
  const [notes, setNotes] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [operation, setOperation] = useState<string | null>(null);
  const tid = tenantId || profile?.tenant_id || "";
  const bid = branchId || profile?.branch_id || "";
  const scopedSuppliers = useMemo(
    () => suppliers.filter((s) => s.branch_id === bid),
    [suppliers, bid],
  );
  const supplier = scopedSuppliers.find((s) => s.id === supplierId);
  useEffect(() => {
    if (!open) return;
    setMode(editingPurchase ? "simple" : null);
    setDate(
      editingPurchase?.purchase_date ?? new Date().toISOString().slice(0, 10),
    );
    setSupplierId(editingPurchase?.supplier_id ?? "");
    setBill(editingPurchase?.bill_number ?? "");
    setPayment((editingPurchase?.payment_method as Payment) ?? null);
    setTax(
      editingPurchase
        ? editingPurchase.tax_input_mode === "excluded"
          ? "excluded"
          : "included"
        : null,
    );
    setAmount(
      editingPurchase
        ? String(
            editingPurchase.tax_input_mode === "excluded"
              ? editingPurchase.subtotal
              : editingPurchase.total_amount,
          )
        : "",
    );
    setLines([line()]);
    setUnits({});
    setNotes(editingPurchase?.notes ?? "");
    setNotesOpen(Boolean(editingPurchase?.notes));
    setFile(null);
    setError("");
    setOperation(null);
  }, [open, editingPurchase]);
  useEffect(() => {
    if (!open || mode !== "receiving") return;
    let active = true;
    setProductsLoading(true);
    setProductsError(false);
    setProducts([]);
    setUnits({});
    setLines([line()]);
    void (supabase as any)
      .from("products")
      .select("id,name,name_ar,sku,barcode,unit,stock_quantity,cost")
      .eq("tenant_id", tid)
      .eq("branch_id", bid)
      .eq("is_active", true)
      .eq("track_stock", true)
      .eq("is_service", false)
      .order("name")
      .then(
        ({
          data,
          error: loadError,
        }: {
          data: Product[] | null;
          error: any;
        }) => {
          if (!active) return;
          setProducts(data ?? []);
          setProductsError(Boolean(loadError));
          setProductsLoading(false);
        },
      );
    return () => {
      active = false;
    };
  }, [open, mode, tid, bid]);
  const update = (id: string, p: Partial<Line>) =>
    setLines((v) => v.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const selectProduct = (id: string, productId: string) => {
    const product = products.find((p) => p.id === productId);
    update(id, {
      productId,
      unitId: "",
      quantity: "",
      unitCost: String(product?.cost ?? 0),
    });
    if (!productId || units[productId]) return;
    void (supabase as any)
      .rpc("get_product_units", { p_product_id: productId })
      .then(({ data }: { data: Unit[] | null }) =>
        setUnits((v) => ({
          ...v,
          [productId]: (data ?? []).filter(
            (u) => u.is_active && u.receiving_enabled,
          ),
        })),
      );
  };
  const detail = lines.map((x) => {
    const product = products.find((p) => p.id === x.productId);
    const unit = (units[x.productId] ?? []).find((u) => u.id === x.unitId);
    const q = Number(x.quantity),
      cost = Number(x.unitCost);
    return {
      ...x,
      product,
      unit,
      q,
      cost,
      lineTotal: Number.isFinite(q * cost) ? money(q * cost) : 0,
    };
  });
  const entered =
    mode === "simple"
      ? Number(amount)
      : detail.reduce((s, x) => s + x.lineTotal, 0);
  const totals = total(
    Number.isFinite(entered) ? entered : 0,
    tax ?? "included",
  );
  const validLines =
    detail.length > 0 &&
    detail.every((x) => x.product && x.unit && x.q > 0 && x.cost >= 0);
  const valid = Boolean(
    mode &&
    date &&
    supplier &&
    payment &&
    tax &&
    (mode === "simple" ? Number(amount) > 0 : validLines),
  );
  const attach = async (purchaseId: string) => {
    if (!file) return;
    const name = file.name.replace(/[^a-z0-9._-]+/gi, "-");
    const path = `${tid}/${bid}/purchases/${purchaseId}/${Date.now()}-${name}`;
    const { error: up } = await supabase.storage
      .from("purchases-bills")
      .upload(path, file, { upsert: false });
    if (up) throw up;
    const { error: link } = await (supabase as any).rpc(
      "set_purchase_bill_attachment",
      { p_purchase_id: purchaseId, p_bill_path: path, p_clear: false },
    );
    if (link) throw link;
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || !mode || !payment || !tax) {
      setError(t("purchases:errors.completeRequired"));
      return;
    }
    setSaving(true);
    setError("");
    const op = operation ?? crypto.randomUUID();
    setOperation(op);
    try {
      let purchaseId: string;
      if (editingPurchase) {
        const { error } = await (supabase as any).rpc("update_purchase_entry", {
          p_payload: {
            purchase_id: editingPurchase.id,
            supplier_id: supplierId,
            purchase_date: date,
            bill_number: bill || null,
            tax_input_mode: tax,
            payment_method: payment,
            payment_status: "paid",
            notes: notes || null,
            amount: Number(amount),
          },
        });
        if (error) throw error;
        purchaseId = editingPurchase.id;
      } else if (mode === "simple") {
        const { data, error } = await (supabase as any).rpc(
          "create_simple_purchase_v1",
          {
            p_payload: {
              branch_id: bid,
              supplier_id: supplierId,
              purchase_date: date,
              amount: Number(amount),
              tax_input_mode: tax,
              payment_method: payment,
              payment_status: "paid",
              bill_number: bill || null,
              notes: notes || null,
              operation_id: op,
            },
          },
        );
        if (error) throw error;
        purchaseId = data.purchase_id;
      } else {
        const { data, error } = await (supabase as any).rpc(
          "create_product_purchase_and_receive_v1",
          {
            p_payload: {
              branch_id: bid,
              supplier_id: supplierId,
              purchase_date: date,
              tax_input_mode: tax,
              payment_method: payment,
              payment_status: "paid",
              bill_number: bill || null,
              notes: notes || null,
              operation_id: op,
              items: detail.map((x) => ({
                product_id: x.productId,
                product_unit_id: x.unitId,
                expected_product_unit_version: x.unit?.version,
                quantity: x.q,
                unit_cost: x.cost,
              })),
            },
          },
        );
        if (error) throw error;
        purchaseId = data.purchase_id;
      }
      try {
        await attach(purchaseId);
      } catch {
        toast.warning(t("purchases:errors.uploadFailed"));
      }
      toast.success(
        t(
          mode === "simple"
            ? "purchases:success.bill"
            : "purchases:success.receiving",
        ),
      );
      onSaved();
      onClose();
    } catch (err) {
      console.error(err);
      setError(t("purchases:errors.saveFailed"));
    } finally {
      setSaving(false);
    }
  };
  if (!open) return null;
  const subtitle = !mode
    ? t("purchases:chooser.subtitle")
    : t(`purchases:chooser.${mode}`);
  return (
    <div
      className="fixed inset-y-0 left-0 right-0 z-50 flex items-center justify-center bg-black/55 p-2 md:left-[var(--app-sidebar-width)] md:p-5"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="purchase-title"
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-[1080px] flex-col overflow-hidden rounded-2xl border border-white/20 bg-[#fffdf7] shadow-2xl md:max-h-[92vh]"
      >
        <header className="flex items-center gap-3 bg-[#173f2a] px-5 py-4 text-[#fff8e7]">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-[#e5c15c]">
            {mode === "receiving" ? (
              <PackagePlus size={19} />
            ) : (
              <FileText size={19} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="purchase-title" className="font-bold">
              {t("purchases:new")}
            </h2>
            <p className="text-xs text-[#fff8e7]/75">{subtitle}</p>
          </div>
          <button
            type="button"
            aria-label={t("common:close")}
            onClick={onClose}
            className="rounded-xl p-2 hover:bg-white/10"
          >
            <X size={18} />
          </button>
        </header>
        {!mode ? (
          <div className="grid gap-3 p-5 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMode("simple")}
              className="rounded-2xl border border-[#d7e2d8] bg-white p-5 text-start shadow-sm hover:border-[#6e9a75] focus-visible:ring-2 focus-visible:ring-[#173f2a]"
            >
              <FileText className="mb-4 text-[#173f2a]" />
              <b>{t("purchases:chooser.simple")}</b>
              <p className="mt-1 text-sm text-gray-600">
                {t("purchases:chooser.simpleDescription")}
              </p>
              <p className="mt-4 text-xs text-[#526b59]">
                {t("purchases:chooser.simpleHelper")}
              </p>
            </button>
            <button
              type="button"
              onClick={() => setMode("receiving")}
              className="rounded-2xl border border-[#d7e2d8] bg-white p-5 text-start shadow-sm hover:border-[#6e9a75] focus-visible:ring-2 focus-visible:ring-[#173f2a]"
            >
              <PackagePlus className="mb-4 text-[#173f2a]" />
              <b>{t("purchases:chooser.receiving")}</b>
              <p className="mt-1 text-sm text-gray-600">
                {t("purchases:chooser.receivingDescription")}
              </p>
              <p className="mt-4 text-xs text-[#526b59]">
                {t("purchases:chooser.receivingHelper")}
              </p>
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="space-y-4">
                <Section n={1} title={t("purchases:sections.details")}>
                  <label className="label" htmlFor="date">
                    {t("purchases:fields.date")} *
                  </label>
                  <input
                    id="date"
                    className="input max-w-xs"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </Section>
                <Section n={2} title={t("purchases:sections.supplierBill")}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="label" htmlFor="supplier">
                        {t("purchases:fields.supplier")} *
                      </label>
                      <select
                        id="supplier"
                        className="input"
                        value={supplierId}
                        onChange={(e) => setSupplierId(e.target.value)}
                      >
                        <option value="">
                          {t("purchases:fields.selectSupplier")}
                        </option>
                        {scopedSuppliers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {dn(s.name, s.name_ar)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label" htmlFor="bill">
                        {t("purchases:fields.billNumber")}
                      </label>
                      <input
                        id="bill"
                        className="input"
                        value={bill}
                        onChange={(e) => setBill(e.target.value)}
                      />
                    </div>
                  </div>
                  <label className="mt-3 inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-[#31543f]">
                    <Paperclip size={14} />
                    {file?.name || t("purchases:chooser.addAttachment")}
                    <input
                      className="sr-only"
                      type="file"
                      accept="application/pdf,image/*"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                </Section>
                {mode === "receiving" && (
                  <Section n={3} title={t("purchases:sections.purchaseItems")}>
                    <div className="space-y-3">
                      {detail.map((x, i) => (
                        <div
                          key={x.id}
                          className="rounded-xl border border-[#dfe7df] bg-[#fbfdfb] p-3"
                        >
                          <div className="mb-2 flex justify-between">
                            <b className="text-xs text-[#31543f]">
                              {t("purchases:chooser.productLine", {
                                number: i + 1,
                              })}
                            </b>
                            {lines.length > 1 && (
                              <button
                                type="button"
                                aria-label={t("purchases:modal.removeLine", {
                                  number: i + 1,
                                })}
                                onClick={() =>
                                  setLines((v) =>
                                    v.filter((y) => y.id !== x.id),
                                  )
                                }
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <div>
                              <label className="label">
                                {t("purchases:fields.product")} *
                              </label>
                              <select
                                className="input"
                                value={x.productId}
                                disabled={productsLoading || productsError}
                                onChange={(e) =>
                                  selectProduct(x.id, e.target.value)
                                }
                              >
                                <option value="">
                                  {productsLoading
                                    ? t("common:loading")
                                    : productsError
                                      ? t("purchases:errors.productsLoadFailed", { defaultValue: "Couldn’t load products. Try again." })
                                      : products.length === 0
                                        ? t("purchases:errors.noEligibleProducts", { defaultValue: "No stock-tracked products are available for this branch." })
                                        : t("purchases:fields.selectProduct")}
                                </option>
                                {products.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {`${dn(p.name, p.name_ar)}${p.sku ? ` · ${p.sku}` : ""}`}
                                  </option>
                                ))}
                              </select>
                              {productsError && <p className="mt-1 text-xs text-red-700" role="alert">{t("purchases:errors.productsLoadFailed", { defaultValue: "Couldn’t load products. Try again." })}</p>}
                              {!productsLoading && !productsError && products.length === 0 && <p className="mt-1 text-xs text-amber-700">{t("purchases:errors.noEligibleProducts", { defaultValue: "No stock-tracked products are available for this branch." })}</p>}
                            </div>
                            <div>
                              <label className="label">
                                {t("purchases:fields.receivingUnit")} *
                              </label>
                              <select
                                className="input"
                                value={x.unitId}
                                disabled={!x.productId}
                                onChange={(e) =>
                                  update(x.id, { unitId: e.target.value })
                                }
                              >
                                <option value="">
                                  {t("purchases:fields.selectUnit")}
                                </option>
                                {(units[x.productId] ?? []).map((u) => (
                                  <option key={u.id} value={u.id}>
                                    {dn(u.name, u.name_ar)}
                                  </option>
                                ))}
                              </select>
                              {x.productId && !units[x.productId]?.length && <p className="mt-1 text-xs text-amber-700">{t("purchases:errors.noReceivingUnits", { defaultValue: "This product has no receiving unit configured." })}</p>}
                            </div>
                            <div>
                              <label className="label">
                                {t("purchases:fields.quantity")} *
                              </label>
                              <input
                                className="input"
                                type="number"
                                min="0"
                                step={
                                  x.unit ? 10 ** -x.unit.quantity_scale : ".001"
                                }
                                value={x.quantity}
                                onChange={(e) =>
                                  update(x.id, { quantity: e.target.value })
                                }
                              />
                            </div>
                            <div>
                              <label className="label">
                                {t("purchases:fields.unitCost")} *
                              </label>
                              <MoneyInput
                                className="input text-gray-900 placeholder:text-gray-400"
                                placeholder="0.00"
                                value={x.unitCost}
                                onValueChange={(value) =>
                                  update(x.id, { unitCost: value })
                                }
                              />
                            </div>
                          </div>
                          {x.product && <p className="mt-2 text-xs text-[#526b59]">{t("purchases:chooser.currentStock", { defaultValue: "Current stock: {{quantity}} {{unit}}", quantity: x.product.stock_quantity ?? 0, unit: x.product.unit ?? t("purchases:chooser.baseUnits") })}</p>}
                          <div className="mt-2 flex justify-between text-xs">
                            <span className="text-[#526b59]">
                              {x.unit && x.q > 0
                                ? t("purchases:chooser.receivesBase", {
                                    quantity: money(
                                      x.q * x.unit.conversion_to_base,
                                    ),
                                    unit: t("purchases:chooser.baseUnits"),
                                  })
                                : ""}
                            </span>
                            <b>
                              <Rial amount={x.lineTotal} />
                            </b>
                          </div>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setLines((v) => [...v, line()])}
                      >
                        <Plus size={14} />
                        {t("purchases:chooser.addProduct")}
                      </Button>
                    </div>
                  </Section>
                )}
                <Section
                  n={mode === "receiving" ? 4 : 3}
                  title={t("purchases:sections.payment")}
                >
                  <p className="mb-2 text-xs text-gray-500">
                    {t("purchases:chooser.paymentRequired")}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {(
                      [
                        { value: "cash", Icon: Banknote },
                        { value: "card", Icon: CreditCard },
                        { value: "bank_transfer", Icon: Boxes },
                      ] as const
                    ).map(({ value, Icon }) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={payment === value}
                        onClick={() => setPayment(value)}
                        className={`rounded-xl border p-2 text-xs font-semibold ${payment === value ? "border-[#173f2a] bg-[#173f2a] text-[#fff8e7]" : "border-[#d7e2d8] text-[#31543f]"}`}
                      >
                        <Icon className="mx-auto mb-1" size={15} />
                        {t(`purchases:paymentMethod.${value}`)}
                      </button>
                    ))}
                  </div>
                </Section>
                <Section
                  n={mode === "receiving" ? 5 : 4}
                  title={t("purchases:sections.amountVat")}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    {mode === "simple" && (
                      <div>
                        <label className="label">
                          {t("purchases:fields.totalAmount")} *
                        </label>
                        <MoneyInput
                          className="input text-gray-900 placeholder:text-gray-400"
                          placeholder="0.00"
                          value={amount}
                          onValueChange={(value) => setAmount(value)}
                        />
                      </div>
                    )}
                    <div>
                      <p className="label">
                        {t("purchases:chooser.vatTreatment")} *
                      </p>
                      <div className="flex gap-2">
                        {(["included", "excluded"] as Tax[]).map((v) => (
                          <button
                            type="button"
                            key={v}
                            aria-pressed={tax === v}
                            onClick={() => setTax(v)}
                            className={`rounded-xl border px-3 py-2 text-xs font-semibold ${tax === v ? "border-[#173f2a] bg-[#e5efe6]" : "border-[#d7e2d8]"}`}
                          >
                            {t(`purchases:taxMode.${v}`)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </Section>
                <Section
                  n={mode === "receiving" ? 6 : 5}
                  title={t("purchases:chooser.optionalDetails")}
                >
                  <button
                    type="button"
                    onClick={() => setNotesOpen((v) => !v)}
                    className="inline-flex gap-1 text-xs font-semibold text-[#31543f]"
                  >
                    <Plus size={14} />
                    {t("purchases:chooser.addNotes")}
                  </button>
                  {notesOpen && (
                    <textarea
                      className="input mt-3 min-h-20"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder={t("purchases:placeholders.notes")}
                    />
                  )}
                </Section>
              </div>
              <aside className="h-fit rounded-2xl border border-[#d7e2d8] bg-[#f5f8f3] p-4">
                <b className="text-xs uppercase tracking-wide text-[#31543f]">
                  {t("purchases:modal.financialPreview")}
                </b>
                <dl className="mt-4 space-y-3 text-sm">
                  <div className="flex justify-between">
                    <dt>{t("purchases:fields.subtotal")}</dt>
                    <dd>
                      <Rial amount={totals.subtotal} />
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>{t("purchases:fields.vat")}</dt>
                    <dd className="text-teal-700">
                      <Rial amount={totals.vat} />
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>{t("purchases:fields.method")}</dt>
                    <dd>
                      {payment
                        ? t(`purchases:paymentMethod.${payment}`)
                        : t("purchases:chooser.notSelected")}
                    </dd>
                  </div>
                  <div className="flex justify-between border-t pt-3 font-bold">
                    <dt>{t("purchases:modal.totalBill")}</dt>
                    <dd>
                      <Rial amount={totals.total} />
                    </dd>
                  </div>
                </dl>
              </aside>
            </div>
            {error && (
              <p role="alert" className="px-6 pb-2 text-sm text-red-700">
                {error}
              </p>
            )}
            <footer className="flex justify-between border-t bg-white px-5 py-3">
              <Button type="button" variant="secondary" onClick={onClose}>
                {t("common:cancel")}
              </Button>
              <Button
                type="submit"
                loading={saving}
                disabled={!valid || saving}
                className="!bg-[#173f2a] text-[#fff8e7]"
              >
                {mode === "simple"
                  ? t("purchases:chooser.recordPurchase")
                  : t("purchases:chooser.recordReceive")}
                <Check size={15} />
              </Button>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
}
