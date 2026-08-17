import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Loader2,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import {
  loadBranchCustomerCreditSettings,
  notifyCustomerCreditPolicyChanged,
  saveBranchCustomerCreditSettings,
  type BranchCustomerCreditSettings,
} from "@/lib/customers/receivables";
import { Button } from "@/components/ui/Button";

type SectionId = "general" | "pos" | "credit" | "zatca";
type BranchOption = {
  id: string;
  name: string;
  name_ar: string | null;
  is_active: boolean;
};
type BranchRecord = BranchOption & {
  phone: string | null;
  email: string | null;
  website: string | null;
  building_number: string | null;
  street: string | null;
  district: string | null;
  city: string | null;
  country: string | null;
  postal_code: string | null;
  allow_split_payments: boolean | null;
  show_pos_scroll_buttons: boolean | null;
  pos_mode: "touch" | "quick" | null;
};

const sections: Array<{ id: SectionId; icon: React.ElementType }> = [
  { id: "general", icon: Building2 },
  { id: "pos", icon: Settings2 },
  { id: "credit", icon: CreditCard },
  { id: "zatca", icon: ShieldCheck },
];

const branchSelect =
  "id,name,name_ar,is_active,phone,email,website,building_number,street,district,city,country,postal_code,allow_split_payments,show_pos_scroll_buttons,pos_mode";

const branchSettingsV3Copy = {
  en: {
    subtitle: "Manage this branch's identity and operational controls.",
    identityStatus: "Identity & status",
    status: "Status",
    posHelp: "Configure checkout layout and payment controls for this branch.",
    touchPos: "Touch POS",
    touchPosHelp: "Visual product tiles for counter selling.",
    quickBilling: "Quick Billing",
    quickBillingHelp: "Fast search and barcode-based checkout.",
    splitPaymentHelp: "Allow one sale to use multiple payment methods.",
    navigationArrowsHelp: "Show larger browsing controls in Touch POS.",
    currentPosConfiguration: "Current POS configuration",
    layout: "Layout",
    creditStatus: "Credit status",
    eligibleCustomerType: "Eligible customer type",
    businessB2b: "Business / B2B",
    accountCreation: "Account creation",
    automaticWhenRequired: "Automatic when required",
    contactOwner: "Contact the account owner for onboarding or connection changes.",
    zatcaHelp: "ZATCA setup for this branch is managed by the account owner.",
    zatcaStatus: "ZATCA status",
    branchAvailability: "Branch availability",
    configurationOwner: "Configuration owner",
    ownerAccount: "Owner account",
    connectionManagement: "Connection management",
    ownerManaged: "Owner-managed",
    availabilityNote: "This page shows branch availability, not live ZATCA submission status.",
  },
  ar: {
    subtitle: "إدارة هوية الفرع وضوابطه التشغيلية.",
    identityStatus: "الهوية والحالة",
    status: "الحالة",
    posHelp: "اضبط تخطيط نقطة البيع وضوابط الدفع لهذا الفرع.",
    touchPos: "نقطة البيع اللمسية",
    touchPosHelp: "بطاقات منتجات مرئية للبيع عند نقطة الكاشير.",
    quickBilling: "الفوترة السريعة",
    quickBillingHelp: "بحث سريع وفوترة بالباركود.",
    splitPaymentHelp: "السماح بعملية بيع واحدة باستخدام عدة طرق دفع.",
    navigationArrowsHelp: "إظهار أدوات تصفح أكبر في نقطة البيع اللمسية.",
    currentPosConfiguration: "إعدادات نقطة البيع الحالية",
    layout: "التخطيط",
    creditStatus: "حالة الائتمان",
    eligibleCustomerType: "نوع العميل المؤهل",
    businessB2b: "الأعمال / B2B",
    accountCreation: "إنشاء الحساب",
    automaticWhenRequired: "تلقائي عند الحاجة",
    contactOwner: "تواصل مع مالك الحساب لتحديثات التهيئة أو الاتصال.",
    zatcaHelp: "يدير مالك الحساب إعداد ZATCA لهذا الفرع.",
    zatcaStatus: "حالة ZATCA",
    branchAvailability: "توفر الفرع",
    configurationOwner: "مالك الإعداد",
    ownerAccount: "حساب المالك",
    connectionManagement: "إدارة الاتصال",
    ownerManaged: "يديرها المالك",
    availabilityNote: "تعرض هذه الصفحة توفر الفرع، وليست حالة إرسال ZATCA المباشرة.",
  },
} as const;

function StatusChip({
  enabled,
  enabledLabel,
  disabledLabel,
}: {
  enabled: boolean;
  enabledLabel: string;
  disabledLabel: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${enabled ? "bg-[#173f2a] text-[#fff8e7]" : "bg-slate-100 text-slate-600"}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${enabled ? "bg-emerald-300" : "bg-slate-400"}`}
        aria-hidden="true"
      />
      {enabled ? enabledLabel : disabledLabel}
    </span>
  );
}

function InfoRow({
  label,
  value,
  dir = "auto",
}: {
  label: string;
  value: string;
  dir?: "auto" | "ltr" | "rtl";
}) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-5 border-b border-slate-100 py-3 last:border-0">
      <dt className="shrink-0 text-xs font-semibold text-slate-500">{label}</dt>
      <dd
        className="min-w-0 whitespace-pre-line break-words text-end text-sm font-semibold text-slate-900"
        dir={dir}
      >
        {value || "—"}
      </dd>
    </div>
  );
}

type BranchHeaderMetadata = {
  name: string;
  isActive: boolean;
};

function BranchSettingsHeader({
  backPath,
  branch,
  loading,
  labels,
}: {
  backPath: string;
  branch: BranchHeaderMetadata | null;
  loading: boolean;
  labels: {
    active: string;
    backToDashboard: string;
    branchName: string;
    inactive: string;
    loadingBranch: string;
    subtitle: string;
    title: string;
  };
}) {
  return (
    <header className="border-b border-slate-200 pb-4">
      <Link
        to={backPath}
        className="mb-3 inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm font-semibold text-primary-700 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <ArrowLeft size={15} />
        {labels.backToDashboard}
      </Link>
      <h1 className="text-2xl font-black tracking-tight text-slate-950">
        {labels.title}
      </h1>
      <p className="mt-1 text-sm text-slate-500">{labels.subtitle}</p>
      {branch ? (
        <div className="mt-3 flex flex-wrap items-center gap-2.5 rounded-xl border border-slate-200 bg-[#fffdf7] px-3 py-2 text-xs text-slate-500">
          <span className="font-semibold text-slate-900">{branch.name}</span>
          <StatusChip
            enabled={branch.isActive}
            enabledLabel={labels.active}
            disabledLabel={labels.inactive}
          />
        </div>
      ) : loading ? (
        <div
          className="mt-3 flex w-full max-w-md items-center gap-3 rounded-xl border border-slate-200 bg-[#fffdf7] px-3 py-2.5"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="shrink-0 animate-spin text-primary-600" size={16} />
          <span className="h-3 w-32 animate-pulse rounded bg-slate-200" aria-hidden="true" />
          <span className="h-3 w-20 animate-pulse rounded bg-slate-100" aria-hidden="true" />
          <span className="sr-only">{labels.loadingBranch}</span>
        </div>
      ) : null}
    </header>
  );
}

function SummaryPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <aside className="rounded-2xl bg-[#173f2a] p-5 text-[#fff8e7] shadow-sm">
      <h3 className="text-sm font-bold">{title}</h3>
      <div className="mt-4 space-y-3">{children}</div>
    </aside>
  );
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-3 last:border-0 last:pb-0">
      <span className="text-xs font-medium text-emerald-100/75">{label}</span>
      <span className="text-end text-sm font-semibold text-white">{value}</span>
    </div>
  );
}

function ToggleRow({
  label,
  help,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  help: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      className={`flex min-h-16 items-center justify-between gap-4 rounded-xl border px-4 py-3.5 transition-colors ${disabled ? "border-slate-100 bg-slate-50/80 opacity-70" : "border-slate-200 bg-[#fffdf7] hover:border-[#173f2a]/40"}`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-900">
          {label}
        </span>
        <span className="mt-0.5 block text-xs leading-5 text-slate-500">
          {help}
        </span>
      </span>
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        role="switch"
        aria-checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        className="relative h-6 w-11 shrink-0 rounded-full bg-slate-200 transition-colors after:absolute after:start-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-[#173f2a] peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-primary-500 peer-disabled:cursor-not-allowed"
        aria-hidden="true"
      />
    </label>
  );
}

export default function BranchSettingsPage() {
  const { t, i18n } = useTranslation("branches");
  const { profile, branch: authBranch, loading: authLoading } = useAuth();
  const { branchId: routeBranchId } = useParams<{ branchId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isOwner = profile?.role === "owner" || profile?.role === "admin";
  const sectionParam = searchParams.get("section") as SectionId | null;
  const activeSection: SectionId = sections.some(
    (item) => item.id === sectionParam,
  )
    ? (sectionParam as SectionId)
    : "general";
  const selectedBranchId = isOwner
    ? (routeBranchId ?? "")
    : (authBranch?.id ?? profile?.branch_id ?? "");

  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [branchDirectoryLoading, setBranchDirectoryLoading] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<BranchRecord | null>(
    null,
  );
  const [creditSettings, setCreditSettings] =
    useState<BranchCustomerCreditSettings | null>(null);
  const [creditEnabled, setCreditEnabled] = useState(false);
  const [posDraft, setPosDraft] = useState({
    allowSplit: false,
    showArrows: false,
    mode: "touch" as "touch" | "quick",
  });
  const [posSaved, setPosSaved] = useState({
    allowSplit: false,
    showArrows: false,
    mode: "touch" as "touch" | "quick",
  });
  const [loading, setLoading] = useState(true);
  const [savingCredit, setSavingCredit] = useState(false);
  const [savingPos, setSavingPos] = useState(false);
  const [saved, setSaved] = useState<SectionId | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!searchParams.get("section")) {
      const next = new URLSearchParams(searchParams);
      next.set("section", "general");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!isOwner || !profile?.tenant_id) {
      setBranches([]);
      setBranchDirectoryLoading(false);
      return;
    }
    let cancelled = false;
    setBranchDirectoryLoading(true);
    void (async () => {
      const { data, error: loadError } = await (supabase as any)
        .from("branches")
        .select("id,name,name_ar,is_active")
        .eq("tenant_id", profile.tenant_id)
        .eq("is_active", true)
        .order("name");
      if (cancelled) return;
      if (loadError) {
        setError(t("workspace.loadFailed"));
        return;
      }
      const list = (data ?? []) as BranchOption[];
      setBranches(list);
      if (!routeBranchId && list[0]?.id)
        navigate(`/settings/branches/${list[0].id}?section=${activeSection}`, {
          replace: true,
        });
    })().finally(() => {
      if (!cancelled) setBranchDirectoryLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [activeSection, isOwner, navigate, profile?.tenant_id, routeBranchId, t]);

  useEffect(() => {
    if (!selectedBranchId) {
      setSelectedBranch(null);
      setCreditSettings(null);
      if (!authLoading) setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedBranch(null);
    setCreditSettings(null);
    void Promise.all([
      (supabase as any)
        .from("branches")
        .select(branchSelect)
        .eq("id", selectedBranchId)
        .maybeSingle(),
      loadBranchCustomerCreditSettings(selectedBranchId),
    ])
      .then(([branchResult, credit]) => {
        if (cancelled) return;
        if (branchResult.error || !branchResult.data)
          throw branchResult.error ?? new Error("Branch not found");
        const row = branchResult.data as BranchRecord;
        const nextPos = {
          allowSplit: row.allow_split_payments === true,
          showArrows: row.show_pos_scroll_buttons === true,
          mode:
            row.pos_mode === "quick" ? ("quick" as const) : ("touch" as const),
        };
        setSelectedBranch(row);
        setCreditSettings(credit);
        setCreditEnabled(credit.branchCreditEnabled);
        setPosDraft(nextPos);
        setPosSaved(nextPos);
      })
      .catch((loadError) => {
        console.error("Unable to load Branch Settings", loadError);
        if (!cancelled) setError(t("workspace.loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, selectedBranchId, t]);

  useEffect(() => {
    const dirty =
      JSON.stringify(posDraft) !== JSON.stringify(posSaved) ||
      creditEnabled !== creditSettings?.branchCreditEnabled;
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [creditEnabled, creditSettings?.branchCreditEnabled, posDraft, posSaved]);

  const posDirty = JSON.stringify(posDraft) !== JSON.stringify(posSaved);
  const creditDirty = creditSettings
    ? creditEnabled !== creditSettings.branchCreditEnabled
    : false;

  function selectSection(nextSection: SectionId) {
    const next = new URLSearchParams(searchParams);
    next.set("section", nextSection);
    setSearchParams(next);
    setSaved(null);
  }

  async function savePos() {
    if (!selectedBranchId || savingPos || !posDirty) return;
    setSavingPos(true);
    setError(null);
    setSaved(null);
    try {
      await (supabase as any).rpc("update_branch_pos_settings", {
        p_branch_id: selectedBranchId,
        p_payload: {
          allow_split_payments: posDraft.allowSplit,
          show_pos_scroll_buttons: posDraft.showArrows,
          pos_mode: posDraft.mode,
        },
      });
      setPosSaved(posDraft);
      setSelectedBranch((current) =>
        current
          ? {
              ...current,
              allow_split_payments: posDraft.allowSplit,
              show_pos_scroll_buttons: posDraft.showArrows,
              pos_mode: posDraft.mode,
            }
          : current,
      );
      setSaved("pos");
    } catch (saveError) {
      console.error("Unable to save Branch POS settings", saveError);
      setError(t("workspace.posSaveFailed"));
    } finally {
      setSavingPos(false);
    }
  }

  async function saveCredit() {
    if (!selectedBranchId || !creditSettings || savingCredit || !creditDirty)
      return;
    setSavingCredit(true);
    setError(null);
    setSaved(null);
    try {
      const result = await saveBranchCustomerCreditSettings({
        branchId: selectedBranchId,
        creditEnabled,
      });
      setCreditSettings(result);
      setCreditEnabled(result.branchCreditEnabled);
      setSaved("credit");
      notifyCustomerCreditPolicyChanged();
    } catch (saveError) {
      console.error(
        "Unable to save Branch customer credit settings",
        saveError,
      );
      setError(t("workspace.creditSaveFailed"));
    } finally {
      setSavingCredit(false);
    }
  }

  const backPath = isOwner ? "/dashboard" : "/branch";
  const branchDataLoading = authLoading || loading || branchDirectoryLoading;
  const v3 = i18n.language.startsWith("ar")
    ? branchSettingsV3Copy.ar
    : branchSettingsV3Copy.en;
  const posModeDetails = {
    touch: { label: v3.touchPos, help: v3.touchPosHelp },
    quick: { label: v3.quickBilling, help: v3.quickBillingHelp },
  };
  const headerLabels = {
    active: t("workspace.active"),
    backToDashboard: t("workspace.backToDashboard"),
    branchName: t("workspace.branchName"),
    inactive: t("workspace.inactive"),
    loadingBranch: t("workspace.loadingBranch"),
    subtitle: v3.subtitle,
    title: t("workspace.title"),
  };

  if (branchDataLoading)
    return (
      <div className="mx-auto max-w-7xl space-y-5">
        <BranchSettingsHeader
          backPath={backPath}
          branch={null}
          loading={branchDataLoading}
          labels={headerLabels}
        />
        <div
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"
          role="status"
          aria-live="polite"
        >
          <div className="space-y-4" aria-hidden="true">
            <div className="h-4 w-32 animate-pulse rounded bg-slate-200" />
            <div className="h-7 w-56 animate-pulse rounded bg-slate-100" />
            <div className="h-20 max-w-3xl animate-pulse rounded-2xl bg-slate-50" />
          </div>
          <span className="sr-only">{t("workspace.loadingBranch")}</span>
        </div>
      </div>
    );
  if (!selectedBranchId || !selectedBranch || !creditSettings)
    return (
      <div className="mx-auto max-w-7xl space-y-5">
        <BranchSettingsHeader
          backPath={backPath}
          branch={null}
          loading={false}
          labels={headerLabels}
        />
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
          {error ?? t("workspace.noBranch")}
        </div>
      </div>
    );

  const address = [
    [selectedBranch.building_number, selectedBranch.street]
      .filter(Boolean)
      .join(" "),
    selectedBranch.district,
    [selectedBranch.city, selectedBranch.postal_code]
      .filter(Boolean)
      .join(" "),
    selectedBranch.country,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <BranchSettingsHeader
        backPath={backPath}
        branch={{
          name: selectedBranch.name,
          isActive: selectedBranch.is_active,
        }}
        loading={false}
        labels={headerLabels}
      />

      {isOwner && branches.length > 0 && (
        <label className="flex max-w-xl flex-wrap items-center gap-3 text-sm font-semibold text-slate-800">
          <span>{t("workspace.chooseBranch")}</span>
          <select
            value={selectedBranchId}
            onChange={(event) =>
              navigate(
                `/settings/branches/${event.target.value}?section=${activeSection}`,
              )
            }
            className="h-10 min-w-[220px] flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
          >
            {branches.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
                {option.name_ar ? ` · ${option.name_ar}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}
      {saved && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800"
        >
          <CheckCircle2 size={15} />
          {t("workspace.saved")}
        </div>
      )}

      <nav
        className="flex gap-1.5 overflow-x-auto rounded-2xl border border-[#173f2a] bg-[#173f2a] p-1.5 shadow-sm"
        role="tablist"
        aria-label={t("workspace.title")}
      >
        {sections.map((item) => {
          const Icon = item.icon;
          const selected = activeSection === item.id;
          return (
            <button
              key={item.id}
              id={`branch-settings-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`branch-settings-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectSection(item.id)}
              className={`flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3.5 text-xs font-bold outline-none transition-[background-color,color,box-shadow,transform] active:scale-[.98] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#fff8e7] ${selected ? "bg-[#2b6546] text-white shadow-sm ring-1 ring-[#d7b56d]/70" : "text-emerald-50/70 hover:bg-white/10 hover:text-white"}`}
            >
              <Icon
                size={15}
                className={selected ? "text-[#f1d58f]" : "text-emerald-100/55"}
              />
              <span>{t(`workspace.sections.${item.id}`)}</span>
            </button>
          );
        })}
      </nav>

      <main
        id={`branch-settings-panel-${activeSection}`}
        role="tabpanel"
        aria-labelledby={`branch-settings-tab-${activeSection}`}
        className="min-w-0"
      >
        {activeSection === "general" && (
          <section
            aria-labelledby="branch-general-heading"
            className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(260px,1fr)]"
          >
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div>
                <h2 id="branch-general-heading" className="text-lg font-bold text-slate-950">
                  {t("workspace.generalTitle")}
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">{t("workspace.generalHelp")}</p>
              </div>
              <dl className="mt-5 grid gap-x-7 sm:grid-cols-2">
                <InfoRow
                  label={t("workspace.branchName")}
                  value={selectedBranch.name}
                />
                <InfoRow
                  label={t("workspace.phone")}
                  value={selectedBranch.phone ?? ""}
                  dir="ltr"
                />
                {selectedBranch.email && (
                  <InfoRow
                    label={t("workspace.email")}
                    value={selectedBranch.email}
                    dir="ltr"
                  />
                )}
                <div className="md:col-span-2">
                  <InfoRow label={t("workspace.address")} value={address} />
                </div>
              </dl>
            </div>
            <SummaryPanel title={v3.identityStatus}>
              <SummaryRow
                label={v3.status}
                value={selectedBranch.is_active ? t("workspace.active") : t("workspace.inactive")}
              />
              <p className="pt-1 text-xs leading-5 text-emerald-50/70">
                {t("workspace.generalReadOnly")}
              </p>
            </SummaryPanel>
          </section>
        )}

        {activeSection === "pos" && (
          <section aria-labelledby="branch-pos-heading" className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(260px,1fr)]">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div>
                <h2 id="branch-pos-heading" className="text-lg font-bold text-slate-950">
                  {t("workspace.posTitle")}
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  {v3.posHelp}
                </p>
              </div>
              <div className="mt-5 space-y-4">
              <fieldset>
                <legend className="text-xs font-bold text-slate-700">
                  {t("workspace.posMode")}
                </legend>
                <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
                  {(["touch", "quick"] as const).map((mode) => (
                    <label
                      key={mode}
                      className={`cursor-pointer rounded-xl border p-4 transition-[background-color,border-color,color,box-shadow] ${posDraft.mode === mode ? "border-[#173f2a] bg-[#173f2a] text-[#fff8e7] shadow-sm" : "border-slate-200 bg-[#fffdf7] text-slate-900 hover:border-[#173f2a]/40"}`}
                    >
                      <input
                        type="radio"
                        className="sr-only"
                        name="branch-pos-mode"
                        checked={posDraft.mode === mode}
                        onChange={() => {
                          setPosDraft((current) => ({ ...current, mode }));
                          setSaved(null);
                        }}
                      />
                      <span className={`block text-sm font-semibold ${posDraft.mode === mode ? "text-white" : "text-slate-900"}`}>
                        {posModeDetails[mode].label}
                      </span>
                      <span className={`mt-1 block text-xs leading-5 ${posDraft.mode === mode ? "text-emerald-50/80" : "text-slate-500"}`}>
                        {posModeDetails[mode].help}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <ToggleRow
                label={t("workspace.splitPayment")}
                help={v3.splitPaymentHelp}
                checked={posDraft.allowSplit}
                onChange={(value) => {
                  setPosDraft((current) => ({ ...current, allowSplit: value }));
                  setSaved(null);
                }}
              />
              <ToggleRow
                label={t("workspace.categoryArrows")}
                help={v3.navigationArrowsHelp}
                checked={posDraft.showArrows}
                onChange={(value) => {
                  setPosDraft((current) => ({ ...current, showArrows: value }));
                  setSaved(null);
                }}
              />
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
              <Button
                className="bg-[#173f2a] hover:bg-[#102f20]"
                onClick={() => void savePos()}
                disabled={savingPos || !posDirty}
              >
                {savingPos ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                {t("workspace.save")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setPosDraft(posSaved)}
                disabled={savingPos || !posDirty}
              >
                <RefreshCw size={14} />
                {t("workspace.reset")}
              </Button>
              {posDirty && <span className="text-xs text-slate-500" role="status">{t("workspace.unsaved")}</span>}
              {saved === "pos" && <span className="text-xs text-emerald-700" role="status">{t("workspace.saved")}</span>}
              </div>
            </div>
            <SummaryPanel title={v3.currentPosConfiguration}>
              <SummaryRow label={v3.layout} value={posModeDetails[posSaved.mode].label} />
              <SummaryRow label={t("workspace.splitPayment")} value={posSaved.allowSplit ? t("workspace.enabled") : t("workspace.disabled")} />
              <SummaryRow label={t("workspace.categoryArrows")} value={posSaved.showArrows ? t("workspace.enabled") : t("workspace.disabled")} />
            </SummaryPanel>
          </section>
        )}

        {activeSection === "credit" && (
          <section
            aria-labelledby="branch-credit-heading"
            className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(260px,1fr)]"
          >
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div>
                <h2 id="branch-credit-heading" className="text-lg font-bold text-slate-950">
                  {t("workspace.creditTitle")}
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  {t("workspace.creditHelp")}
                </p>
              </div>
              <div className="mt-5">
              <ToggleRow
                label={t("workspace.creditToggle")}
                help={t("workspace.creditToggleHelp")}
                checked={creditEnabled}
                onChange={(value) => {
                  setCreditEnabled(value);
                  setSaved(null);
                }}
              />
              </div>
              <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
              <Button
                className="bg-[#173f2a] hover:bg-[#102f20]"
                onClick={() => void saveCredit()}
                disabled={savingCredit || !creditDirty}
              >
                {savingCredit ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                {t("workspace.save")}
              </Button>
              <Link
                to={`/reports/receivables?branch=${encodeURIComponent(selectedBranchId)}`}
                className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <CreditCard size={14} />
                {t("workspace.openCredit")}
              </Link>
              {creditDirty && <span className="self-center text-xs text-slate-500" role="status">{t("workspace.unsaved")}</span>}
              {saved === "credit" && <span className="self-center text-xs text-emerald-700" role="status">{t("workspace.saved")}</span>}
              </div>
            </div>
            <SummaryPanel title={v3.creditStatus}>
              <SummaryRow label={v3.status} value={creditSettings.branchCreditEnabled ? t("workspace.enabled") : t("workspace.disabled")} />
              <SummaryRow label={v3.eligibleCustomerType} value={v3.businessB2b} />
              <SummaryRow label={v3.accountCreation} value={v3.automaticWhenRequired} />
            </SummaryPanel>
          </section>
        )}

        {activeSection === "zatca" && (
          <section aria-labelledby="branch-zatca-heading" className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(260px,1fr)]">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div>
                <h2 id="branch-zatca-heading" className="text-lg font-bold text-slate-950">
                  {t("workspace.zatcaTitle")}
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  {v3.zatcaHelp}
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-500">{v3.contactOwner}</p>
              </div>
              {isOwner && (
                <Link
                  to="/zatca"
                  className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-xl border border-primary-200 px-4 text-sm font-bold text-primary-800 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  <ShieldCheck size={15} />
                  {t("workspace.manageZatca")}
                  <ExternalLink size={13} />
                </Link>
              )}
            </div>
            <SummaryPanel title={v3.zatcaStatus}>
              <SummaryRow
                label={v3.branchAvailability}
                value={selectedBranch.is_active ? t("workspace.active") : t("workspace.inactive")}
              />
              <SummaryRow label={v3.configurationOwner} value={v3.ownerAccount} />
              <SummaryRow label={v3.connectionManagement} value={v3.ownerManaged} />
              <p className="pt-1 text-xs leading-5 text-emerald-50/70">{v3.availabilityNote}</p>
            </SummaryPanel>
          </section>
        )}
      </main>
    </div>
  );
}
