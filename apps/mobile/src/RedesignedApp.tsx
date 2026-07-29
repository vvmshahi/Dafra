import { useEffect, useMemo, useState, type FormEvent } from "react";
import { App as NativeApp } from "@capacitor/app";
import { Network } from "@capacitor/network";
import { Share } from "@capacitor/share";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Bell,
  Boxes,
  Camera,
  Check,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  Eye,
  EyeOff,
  Flame,
  Globe2,
  HelpCircle,
  Home,
  Landmark,
  LockKeyhole,
  LogOut,
  Menu,
  MessageCircle,
  Minus,
  Package,
  PackageOpen,
  Plus,
  Printer,
  ReceiptText,
  ScanLine,
  Search,
  Settings,
  Share2,
  ShoppingBag,
  ShoppingCart,
  Store,
  Truck,
  UserPlus,
  Users,
  WalletCards,
  WifiOff,
  X,
} from "lucide-react";
import type { CartLine, ConnectionState, Locale, Product } from "./domain";
import { calculatePreview, canCheckout } from "./domain";
import {
  products as fixtureProducts,
  customers as fixtureCustomers,
} from "./fixtures";
import { cartStorage } from "./platform/cartStorage";
import { scanSingleBarcode } from "./platform/scanner";
import { SystemPrintAdapter } from "./platform/printer";
import {
  authConfigured,
  restoreSession,
  signIn,
  signOut,
  type MobileProfile,
} from "./mobileAuth";
import {
  loadBranchData,
  loadOwnerData,
  loadInvoiceDetail,
  loadOperationalModule,
  closeRegister,
  isAuthorisedOperationalScope,
  openRegister,
  resolveProductBarcode,
  type BranchData,
  type MobileInvoice,
  type InvoiceDetail,
  type OperationalModule,
} from "./mobileApi";

type BranchTab = "home" | "sale" | "invoices";
type BranchDestination =
  | BranchTab
  | OperationalModule
  | "stock"
  | "reports"
  | "settings"
  | "help";
type Payment = "cash" | "card" | "split";
const DEMO_ENABLED = import.meta.env.VITE_MOBILE_DEMO_MODE === "true";
const WA_NUMBER = "971561373210";
const COPY = {
  en: {
    signIn: "Sign in",
    account: "Email or branch username",
    password: "Password",
    remember: "Keep me signed in",
    forgot: "Forgot password?",
    noAccount: "Don't have a Kubri account?",
    contact: "Contact Kubri",
    home: "Home",
    sale: "New Sale",
    invoices: "Invoices",
    today: "Today's sales",
    register: "Register open",
    search: "Search products or barcode",
    cart: "Current cart",
    checkout: "Choose payment",
  },
  ar: {
    signIn: "تسجيل الدخول",
    account: "البريد الإلكتروني أو اسم مستخدم الفرع",
    password: "كلمة المرور",
    remember: "إبقائي مسجلاً",
    forgot: "نسيت كلمة المرور؟",
    noAccount: "ليس لديك حساب في Kubri؟",
    contact: "تواصل مع Kubri",
    home: "الرئيسية",
    sale: "بيع جديد",
    invoices: "الفواتير",
    today: "مبيعات اليوم",
    register: "الصندوق مفتوح",
    search: "ابحث عن منتج أو باركود",
    cart: "السلة الحالية",
    checkout: "اختر طريقة الدفع",
  },
};
const money = (value: number, locale: Locale) =>
  new Intl.NumberFormat(locale === "ar" ? "ar-SA" : "en-SA", {
    style: "currency",
    currency: "SAR",
    maximumFractionDigits: 2,
  }).format(value);

export default function RedesignedApp() {
  const [phase, setPhase] = useState<"splash" | "auth" | "app">("splash");
  const [profile, setProfile] = useState<MobileProfile | null>(null);
  const [locale, setLocale] = useState<Locale>("en");
  useEffect(() => {
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = locale === "ar" ? "ar-SA" : "en";
  }, [locale]);
  useEffect(() => {
    void restoreSession()
      .then((p) => {
        if (p) {
          setProfile(p);
          setPhase("app");
        } else setTimeout(() => setPhase("auth"), 900);
      })
      .catch(() => setPhase("auth"));
  }, []);
  useEffect(() => {
    const listener = NativeApp.addListener("appStateChange", ({ isActive }) => {
      if (!isActive || phase !== "app") return;
      void restoreSession()
        .then((p) => {
          if (p) setProfile(p);
          else {
            setProfile(null);
            setPhase("auth");
          }
        })
        .catch(() => {
          setProfile(null);
          setPhase("auth");
        });
    });
    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, [phase]);
  if (phase === "splash") return <Splash />;
  if (phase === "auth")
    return (
      <Login
        locale={locale}
        setLocale={setLocale}
        onAuthenticated={(p) => {
          setProfile(p);
          setPhase("app");
        }}
      />
    );
  return profile?.role === "branch" ? (
    <BranchApp
      locale={locale}
      setLocale={setLocale}
      profile={profile}
      onLogout={() => {
        void signOut();
        setProfile(null);
        setPhase("auth");
      }}
    />
  ) : (
    <OwnerBoundary
      locale={locale}
      setLocale={setLocale}
      profile={profile!}
      onLogout={() => {
        void signOut();
        setPhase("auth");
      }}
    />
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <img
      className={compact ? "brand-mark-img" : "brand-wordmark"}
      src={
        compact ? "/brand/kubiri-logo-mark.png" : "/brand/kubiri-wordmark.png"
      }
      alt="Kubri"
    />
  );
}
function Pattern() {
  return <div className="brand-pattern" aria-hidden="true" />;
}
function Splash() {
  return (
    <main className="launch-screen">
      <Pattern />
      <div className="launch-glow" />
      <img src="/brand/kubiri-app-icon.png" alt="" className="launch-icon" />
      <Brand />
      <span className="launch-loader" />
    </main>
  );
}

function Login({
  locale,
  setLocale,
  onAuthenticated,
}: {
  locale: Locale;
  setLocale: (x: Locale) => void;
  onAuthenticated: (p: MobileProfile) => void;
}) {
  const t = COPY[locale];
  const [identifier, setIdentifier] = useState(""),
    [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      onAuthenticated(await signIn(identifier, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setLoading(false);
    }
  }
  function whatsapp() {
    const msg =
      locale === "ar"
        ? "مرحباً، أرغب في إنشاء حساب Kubri لنشاطي التجاري."
        : "Hi, I would like to create a Kubri account for my business.";
    location.href = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(msg)}`;
  }
  return (
    <main className="login-screen">
      <section className="login-brand">
        <Pattern />
        <Brand />
        <div>
          <span>{locale === "ar" ? "مساحة عمل آمنة" : "SECURE WORKSPACE"}</span>
          <h1>
            {locale === "ar"
              ? "أعمالك اليومية، في مكان واحد."
              : "Your daily business, in one place."}
          </h1>
          <p>
            {locale === "ar"
              ? "المبيعات والفواتير والمخزون والجلسات بتجربة مصممة للعمل."
              : "Sales, invoices, stock and sessions in one focused workspace."}
          </p>
        </div>
      </section>
      <section className="login-form-wrap">
        <header>
          <Brand />
          <button
            className="language-btn"
            onClick={() => setLocale(locale === "en" ? "ar" : "en")}
          >
            <Globe2 />
            {locale === "en" ? "العربية" : "English"}
          </button>
        </header>
        <form onSubmit={submit}>
          <p className="overline">
            {locale === "ar" ? "دخول آمن" : "SECURE ACCESS"}
          </p>
          <h2>
            {locale === "ar" ? "تسجيل الدخول إلى Kubri" : "Sign in to Kubri"}
          </h2>
          <p className="form-intro">
            {locale === "ar"
              ? "ادخل إلى نقطة البيع وعمليات الفرع."
              : "Access your POS, invoices and branch operations."}
          </p>
          {error && (
            <div className="error-state" role="alert">
              <AlertTriangle />
              {error}
            </div>
          )}
          <label>
            {t.account}
            <div className="field">
              <Users />
              <input
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="username"
                inputMode="email"
                required
                placeholder={t.account}
              />
            </div>
          </label>
          <label>
            {t.password}
            <div className="field">
              <LockKeyhole />
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type={visible ? "text" : "password"}
                autoComplete="current-password"
                required
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setVisible(!visible)}
                aria-label="Show password"
              >
                {visible ? <EyeOff /> : <Eye />}
              </button>
            </div>
          </label>
          <div className="form-row">
            <label className="remember">
              <input type="checkbox" defaultChecked />
              {t.remember}
            </label>
            <button type="button" className="text-button">
              {t.forgot}
            </button>
          </div>
          <button className="gold-action" disabled={loading || !authConfigured}>
            {loading ? "Signing in…" : t.signIn}
            <ChevronRight />
          </button>
          {!authConfigured && (
            <p className="config-note">
              Authentication environment is not configured in this build.
            </p>
          )}
          {DEMO_ENABLED && (
            <button
              type="button"
              className="demo-entry"
              onClick={() =>
                onAuthenticated({
                  id: "fixture",
                  role: "branch",
                  tenantId: "fixture",
                  branchId: "fixture",
                  fullName: "Demo cashier",
                  active: true,
                  branchName: "Olaya Branch",
                })
              }
            >
              Open development fixture
            </button>
          )}
          <div className="contact-block">
            <span>{t.noAccount}</span>
            <button type="button" onClick={whatsapp}>
              <MessageCircle />
              {t.contact}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

function OwnerBoundary({
  locale,
  setLocale,
  profile,
  onLogout,
}: {
  locale: Locale;
  setLocale: (x: Locale) => void;
  profile: MobileProfile;
  onLogout: () => void;
}) {
  const [data, setData] = useState<Awaited<
      ReturnType<typeof loadOwnerData>
    > | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    void loadOwnerData(profile)
      .then(setData)
      .catch(() => setError("Owner data could not be loaded safely."));
  }, [profile]);
  const summary = data?.summary ?? {},
    branches = data?.branches ?? [];
  return (
    <main className="owner-boundary">
      <header>
        <Brand />
        <button onClick={() => setLocale(locale === "en" ? "ar" : "en")}>
          <Globe2 />
        </button>
      </header>
      <div>
        <span className="role-chip">Owner / Admin</span>
        <h1>Welcome back, {profile.fullName}.</h1>
        {error ? (
          <p role="alert">{error}</p>
        ) : !data ? (
          <p>Loading your business…</p>
        ) : (
          <>
            <p>Authenticated production overview</p>
            <div className="owner-live-grid">
              <b>
                Today
                <br />
                {money(
                  Number(summary.totalSales ?? summary.total_sales ?? 0),
                  locale,
                )}
              </b>
              <b>
                Invoices
                <br />
                {String(summary.invoiceCount ?? summary.invoice_count ?? 0)}
              </b>
              <b>
                Active branches
                <br />
                {branches.filter((branch: any) => branch.is_active).length}
              </b>
              <b>
                Open registers
                <br />
                {Array.isArray(data.registers) ? data.registers.length : 0}
              </b>
            </div>
          </>
        )}
        <button className="green-action" onClick={onLogout}>
          <LogOut />
          Sign out
        </button>
      </div>
    </main>
  );
}

function BranchApp({
  locale,
  setLocale,
  profile,
  onLogout,
}: {
  locale: Locale;
  setLocale: (x: Locale) => void;
  profile: MobileProfile;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState<BranchTab>("home"),
    [drawer, setDrawer] = useState(false),
    [connection, setConnection] = useState<ConnectionState>("online"),
    [cart, setCart] = useState<CartLine[]>([]),
    [cartOpen, setCartOpen] = useState(false),
    [registerOpen, setRegisterOpen] = useState(false),
    [module, setModule] = useState<BranchDestination | null>(null);
  const [live, setLive] = useState<BranchData | null>(null),
    [loadError, setLoadError] = useState("");
  const isFixture = profile.id === "fixture";
  async function refreshBranch() {
    if (isFixture) return;
    setLoadError("");
    try {
      setLive(await loadBranchData(profile));
    } catch {
      setLoadError(
        "Branch data could not be loaded. Check your connection and try again.",
      );
    }
  }
  useEffect(() => {
    void refreshBranch();
  }, [profile, isFixture]);
  useEffect(() => {
    void cartStorage.restore().then(setCart);
    void Network.getStatus().then((s) =>
      setConnection(s.connected ? "online" : "offline"),
    );
    let remove: (() => void) | undefined;
    void Network.addListener("networkStatusChange", (s) =>
      setConnection(s.connected ? "online" : "offline"),
    ).then((h) => (remove = () => void h.remove()));
    return () => remove?.();
  }, []);
  useEffect(() => {
    void cartStorage.save(cart);
  }, [cart]);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [tab, module]);
  useEffect(() => {
    const promise = NativeApp.addListener("backButton", () => {
      if (cartOpen) return setCartOpen(false);
      if (registerOpen) return setRegisterOpen(false);
      if (drawer) return setDrawer(false);
      if (module) return setModule(null);
      if (tab !== "home") return setTab("home");
      void NativeApp.minimizeApp();
    });
    return () => {
      void promise.then((h) => h.remove());
    };
  }, [cartOpen, registerOpen, drawer, module, tab]);
  function navigate(destination: BranchDestination) {
    if (
      destination === "home" ||
      destination === "sale" ||
      destination === "invoices"
    ) {
      setTab(destination);
      setModule(null);
      return;
    }
    setModule(destination);
  }
  const products = isFixture ? fixtureProducts : (live?.products ?? []),
    customers = isFixture ? fixtureCustomers : (live?.customers ?? []);
  return (
    <div className="mobile-app">
      <header className="branch-bar">
        <button
          className="round-button"
          onClick={() => setDrawer(true)}
          aria-label="Open menu"
        >
          <Menu />
        </button>
        <div className="branch-title">
          <Brand compact />
          <span>
            <small>{profile.branchName || "Branch"}</small>
            <b>
              <i className="online-dot" />
              {live?.register?.status === "open" || isFixture
                ? COPY[locale].register
                : "Register closed"}
            </b>
          </span>
        </div>
        <button className="avatar-button">MK</button>
      </header>
      {connection === "offline" && (
        <div className="offline-strip">
          <WifiOff />
          Offline · Billing and payment are unavailable
        </div>
      )}
      {loadError && (
        <div className="offline-strip" role="alert">
          <AlertTriangle />
          {loadError}
        </div>
      )}
      <main className="branch-content">
        {module ? (
          <OperationalModuleScreen
            locale={locale}
            profile={profile}
            module={module}
            back={() => setModule(null)}
          />
        ) : tab === "home" ? (
          <BranchHome
            locale={locale}
            onSale={() => setTab("sale")}
            onRegister={() => setRegisterOpen(true)}
            live={live}
          />
        ) : tab === "sale" ? (
          <Sale
            locale={locale}
            connection={connection}
            cart={cart}
            setCart={setCart}
            openCart={() => setCartOpen(true)}
            products={products}
            profile={profile}
          />
        ) : (
          <Invoices
            locale={locale}
            profile={profile}
            invoices={isFixture ? undefined : live?.invoices}
          />
        )}
      </main>
      <BranchNav
        tab={tab}
        setTab={(next) => navigate(next)}
        locale={locale}
        count={cart.reduce((s, l) => s + l.quantity, 0)}
      />
      {drawer && (
        <Drawer
          locale={locale}
          setLocale={setLocale}
          close={() => setDrawer(false)}
          go={(x) => {
            navigate(x);
            setDrawer(false);
          }}
          onLogout={onLogout}
        />
      )}{" "}
      {cartOpen && (
        <CartFlow
          locale={locale}
          connection={connection}
          cart={cart}
          setCart={setCart}
          close={() => setCartOpen(false)}
          done={() => {
            setCart([]);
            setCartOpen(false);
            setTab("home");
          }}
          customers={customers}
          isFixture={isFixture}
        />
      )}
      {registerOpen && (
        <RegisterFlow
          locale={locale}
          profile={profile}
          register={live?.register ?? null}
          close={() => setRegisterOpen(false)}
          refreshed={refreshBranch}
        />
      )}
    </div>
  );
}

function BranchNav({
  tab,
  setTab,
  locale,
  count,
}: {
  tab: BranchTab;
  setTab: (x: BranchTab) => void;
  locale: Locale;
  count: number;
}) {
  const t = COPY[locale];
  return (
    <nav className="branch-nav">
      {(
        [
          ["home", Home, t.home],
          ["sale", Plus, t.sale],
          ["invoices", ReceiptText, t.invoices],
        ] as const
      ).map(([id, Icon, label]) => (
        <button
          key={id}
          className={`${tab === id ? "active " : ""}${id === "sale" ? "sale-nav" : ""}`}
          onClick={() => setTab(id)}
        >
          <span>
            <Icon />
            {id === "sale" && count > 0 && <i>{count}</i>}
          </span>
          <b>{label}</b>
        </button>
      ))}
    </nav>
  );
}

function BranchHome({
  locale,
  onSale,
  onRegister,
  live,
}: {
  locale: Locale;
  onSale: () => void;
  onRegister: () => void;
  live: BranchData | null;
}) {
  const summary = live?.dashboard ?? {},
    total = Number(summary.totalSales ?? summary.total_sales ?? 0),
    count = Number(
      summary.totalCount ??
        summary.total_count ??
        summary.invoiceCount ??
        summary.invoice_count ??
        0,
    ),
    register = live?.register;
  return (
    <>
      <section className="home-welcome">
        <div>
          <p>
            {new Date().toLocaleDateString(
              locale === "ar" ? "ar-SA" : "en-GB",
              { dateStyle: "full" },
            )}
          </p>
          <h1>{locale === "ar" ? "مرحباً بعودتك." : "Welcome back."}</h1>
        </div>
        <button disabled aria-label="Notifications are not enabled">
          <Bell />
          <i />
        </button>
      </section>
      <section className="sales-ledger">
        <Pattern />
        <div className="ledger-top">
          <span>
            <small>{COPY[locale].today}</small>
            <strong>{money(total, locale)}</strong>
          </span>
        </div>
        <div className="ledger-meta">
          <span>{count} invoices</span>
          <span>
            Cash{" "}
            {money(
              Number(summary.totalCash ?? summary.total_cash ?? 0),
              locale,
            )}
          </span>
        </div>
        <div className="mini-bars">
          {[34, 48, 39, 64, 55, 78, 92, 70, 84, 97].map((n, i) => (
            <i key={i} style={{ height: `${n}%` }} />
          ))}
        </div>
      </section>
      <section className="quick-grid">
        <Kpi
          icon={ReceiptText}
          label="Invoices"
          value={String(count)}
          note={count ? `${money(total / count, locale)} avg` : "No sales yet"}
        />
        <Kpi
          icon={Landmark}
          label="Expected cash"
          value={money(register?.expectedCash ?? 0, locale)}
          note={`Opening ${money(register?.openingCash ?? 0, locale)}`}
        />
        <Kpi
          icon={CreditCard}
          label="Card sales"
          value={money(register?.cardTotal ?? 0, locale)}
          note="Current session"
        />
        <Kpi
          icon={Flame}
          label="VAT"
          value={money(
            Number(summary.totalVat ?? summary.total_vat ?? 0),
            locale,
          )}
          note="Posted documents"
        />
      </section>
      <section className="register-card">
        <div className="register-icon">
          <Store />
        </div>
        <div>
          <small>REGISTER SESSION</small>
          <strong>
            {register?.status === "open" ? "Register open" : "Register closed"}
          </strong>
          <span>
            {register
              ? `${register.invoiceCount} invoices · ${money(register.totalSales, locale)}`
              : "No current session"}
          </span>
        </div>
        <button onClick={onRegister}>
          {register?.status === "open" ? "Manage" : "Open"}
          <ChevronRight />
        </button>
      </section>
      <div className="section-heading">
        <h2>Quick actions</h2>
      </div>
      <div className="quick-actions">
        <button onClick={onSale}>
          <span>
            <ShoppingBag />
          </span>
          New sale
        </button>
        <button onClick={onSale}>
          <span>
            <ScanLine />
          </span>
          Scan item
        </button>
        <button disabled title="Use New Sale to select a customer">
          <span>
            <UserPlus />
          </span>
          Customer
        </button>
        <button disabled title="Open Products from the menu">
          <span>
            <PackageOpen />
          </span>
          Stock
        </button>
      </div>
      <div className="section-heading">
        <h2>Recent invoices</h2>
        <button>View all</button>
      </div>
      <InvoiceCards compact invoices={live?.invoices} />
      <section className="attention-line">
        <AlertTriangle />
        <span>
          <strong>
            {live?.lowStock.length ?? 0} products are low in stock
          </strong>
          <small>Review before the next delivery</small>
        </span>
        <ChevronRight />
      </section>
    </>
  );
}
function Kpi({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: typeof ReceiptText;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <article className="kpi-card">
      <span>
        <Icon />
      </span>
      <small>{label}</small>
      <strong>{value}</strong>
      <p>{note}</p>
    </article>
  );
}

function addProduct(
  cart: CartLine[],
  setCart: (x: CartLine[]) => void,
  p: Product,
) {
  const found = cart.find((l) => l.product.id === p.id);
  setCart(
    found
      ? cart.map((l) =>
          l.product.id === p.id
            ? { ...l, quantity: Math.min(l.quantity + 1, p.stock) }
            : l,
        )
      : [...cart, { product: p, quantity: 1 }],
  );
}
function Sale({
  locale,
  connection,
  cart,
  setCart,
  openCart,
  products,
  profile,
}: {
  locale: Locale;
  connection: ConnectionState;
  cart: CartLine[];
  setCart: (x: CartLine[]) => void;
  openCart: () => void;
  products: Product[];
  profile: MobileProfile;
}) {
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("All"),
    [scanner, setScanner] = useState(false),
    [notice, setNotice] = useState("");
  const shown = products.filter(
    (p) =>
      (category === "All" || p.category === category) &&
      `${p.name} ${p.nameAr} ${p.barcode}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const total = cart.reduce((s, l) => s + l.product.price * l.quantity, 0);
  function add(p: Product) {
    if (!p.stock) return setNotice("This product is out of stock");
    addProduct(cart, setCart, p);
    setNotice(`${p.name} added`);
  }
  async function scan() {
    try {
      const code = await scanSingleBarcode();
      if (!code) return setNotice("No barcode was captured");
      const p =
        profile.id === "fixture"
          ? products.find((x) => x.barcode === code)
          : await resolveProductBarcode(profile, code);
      if (!p) setNotice("Barcode not found in this branch");
      else add(p);
    } catch {
      setNotice("Camera permission is required to scan products.");
    }
  }
  return (
    <>
      <section className="sale-heading">
        <div>
          <p>Register open · 08:12</p>
          <h1>New sale</h1>
        </div>
        <button className="scan-trigger" onClick={() => setScanner(true)}>
          <Camera />
          Scan
        </button>
      </section>
      <div className="product-search">
        <Search />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={COPY[locale].search}
        />
        <button onClick={() => setQuery("")}>
          <X />
        </button>
      </div>
      <div className="category-row">
        {["All", "Pantry", "Drinks", "Spices", "Supplies"].map((x) => (
          <button
            key={x}
            className={category === x ? "active" : ""}
            onClick={() => setCategory(x)}
          >
            {x}
          </button>
        ))}
      </div>
      {notice && (
        <div className="inline-toast">
          <Check />
          {notice}
          <button onClick={() => setNotice("")}>
            <X />
          </button>
        </div>
      )}
      <div className="final-product-grid">
        {shown.map((p) => (
          <button
            key={p.id}
            className="final-product"
            disabled={!p.stock}
            onClick={() => add(p)}
          >
            <span className="product-photo">
              {p.name[0]}
              {!p.stock && <i>Out</i>}
            </span>
            <strong>{locale === "ar" ? p.nameAr : p.name}</strong>
            <small>
              {p.stock} in stock · VAT {p.taxRate}%
            </small>
            <b>{money(p.price, locale)}</b>
            <i className="add-circle">
              <Plus />
            </i>
          </button>
        ))}
      </div>
      {scanner && (
        <div className="sheet-backdrop">
          <section className="scanner-sheet">
            <header>
              <div>
                <small>BARCODE SCANNER</small>
                <h2>Scan a product</h2>
              </div>
              <button onClick={() => setScanner(false)}>
                <X />
              </button>
            </header>
            <div className="scanner-view">
              <div className="scan-corners" />
              <Camera />
              <p>Camera opens securely in the native scanner</p>
            </div>
            <p>
              Keep the barcode inside the frame. Successful scans add directly
              to your cart.
            </p>
            <button className="green-action" onClick={() => void scan()}>
              <ScanLine />
              Open camera
            </button>
          </section>
        </div>
      )}
      <button
        className="final-cart-dock"
        disabled={!cart.length}
        onClick={openCart}
      >
        <span className="dock-icon">
          <ShoppingCart />
          <i>{cart.reduce((s, l) => s + l.quantity, 0)}</i>
        </span>
        <span>
          <small>{COPY[locale].cart}</small>
          <strong>
            {cart.length} items · {money(total, locale)}
          </strong>
        </span>
        <b>
          Open
          <ChevronRight />
        </b>
      </button>
      {connection === "offline" && (
        <div className="sale-offline">
          <WifiOff />
          Cart saved. Reconnect to continue billing.
        </div>
      )}
    </>
  );
}

function CartFlow({
  locale,
  connection,
  cart,
  setCart,
  close,
  done,
  customers,
  isFixture,
}: {
  locale: Locale;
  connection: ConnectionState;
  cart: CartLine[];
  setCart: (x: CartLine[]) => void;
  close: () => void;
  done: () => void;
  customers: import("./domain").Customer[];
  isFixture: boolean;
}) {
  const [step, setStep] = useState<"cart" | "payment" | "success">("cart"),
    [payment, setPayment] = useState<Payment>("cash"),
    [customer, setCustomer] = useState("Walk-in customer");
  const preview = calculatePreview(cart, "mobile-review-001"),
    printer = useMemo(() => new SystemPrintAdapter(), []);
  function change(id: string, d: number) {
    setCart(
      cart.flatMap((l) =>
        l.product.id !== id
          ? [l]
          : l.quantity + d <= 0
            ? []
            : [{ ...l, quantity: Math.min(l.quantity + d, l.product.stock) }],
      ),
    );
  }
  if (step === "success")
    return (
      <div className="sheet-backdrop">
        <section className="success-screen">
          <div className="success-mark">
            <Check />
          </div>
          <span>PAYMENT COMPLETE · SIMULATION</span>
          <h2>{money(preview.total, locale)}</h2>
          <p>Invoice PREVIEW-1047 · {payment.toUpperCase()}</p>
          <div className="receipt-summary">
            <div>
              <small>Customer</small>
              <b>{customer}</b>
            </div>
            <div>
              <small>Reporting</small>
              <b className="pending">Preview only</b>
            </div>
          </div>
          <div className="success-actions">
            <button
              onClick={() =>
                void printer.printReceipt({
                  invoiceNumber: "PREVIEW-1047",
                  html: "",
                  paperWidth: "80mm",
                })
              }
            >
              <Printer />
              Print
            </button>
            <button
              onClick={() =>
                void Share.share({
                  title: "Kubri receipt preview",
                  text: `PREVIEW-1047 · ${money(preview.total, locale)} · No invoice was issued.`,
                })
              }
            >
              <Share2 />
              Share
            </button>
            <button
              onClick={() =>
                (location.href = `https://wa.me/?text=${encodeURIComponent("Kubri receipt preview PREVIEW-1047")}`)
              }
            >
              <MessageCircle />
              WhatsApp
            </button>
          </div>
          <button className="gold-action" onClick={done}>
            <Plus />
            Start new sale
          </button>
          <button className="text-button" onClick={done}>
            Return home
          </button>
        </section>
      </div>
    );
  return (
    <div className="sheet-backdrop">
      <section className="cart-sheet">
        <header>
          <button onClick={step === "payment" ? () => setStep("cart") : close}>
            <ArrowLeft />
          </button>
          <div>
            <small>{step === "cart" ? "CURRENT SALE" : "PAYMENT"}</small>
            <h2>{step === "cart" ? "Review cart" : "Choose payment"}</h2>
          </div>
          <button onClick={close}>
            <X />
          </button>
        </header>
        {step === "cart" ? (
          <>
            <button
              className="customer-row"
              onClick={() =>
                setCustomer(
                  customer === "Walk-in customer"
                    ? (customers[0]?.name ?? "Walk-in customer")
                    : "Walk-in customer",
                )
              }
            >
              <Users />
              <span>
                <small>Customer</small>
                <b>{customer}</b>
              </span>
              <ChevronRight />
            </button>
            <div className="cart-items">
              {cart.map((l) => (
                <article key={l.product.id}>
                  <span className="product-photo small">
                    {l.product.name[0]}
                  </span>
                  <span>
                    <b>{locale === "ar" ? l.product.nameAr : l.product.name}</b>
                    <small>
                      {money(l.product.price, locale)} · VAT included
                    </small>
                  </span>
                  <div className="quantity">
                    <button onClick={() => change(l.product.id, -1)}>
                      <Minus />
                    </button>
                    <b>{l.quantity}</b>
                    <button onClick={() => change(l.product.id, 1)}>
                      <Plus />
                    </button>
                  </div>
                </article>
              ))}
            </div>
            <Totals preview={preview} locale={locale} />
            <button
              className="gold-action"
              disabled={connection !== "online" || !cart.length}
              onClick={() => setStep("payment")}
            >
              {COPY[locale].checkout}
              <ChevronRight />
            </button>
            {connection !== "online" && (
              <p className="blocked-note">
                <WifiOff />
                Connect to continue. Nothing will be queued.
              </p>
            )}
          </>
        ) : (
          <>
            <div className="payment-grid">
              {(
                [
                  ["cash", CircleDollarSign, "Cash"],
                  ["card", CreditCard, "Card"],
                  ["split", WalletCards, "Split"],
                ] as const
              ).map(([id, Icon, label]) => (
                <button
                  className={payment === id ? "active" : ""}
                  onClick={() => setPayment(id)}
                  key={id}
                >
                  <Icon />
                  <b>{label}</b>
                  <small>Available</small>
                </button>
              ))}
            </div>
            {payment === "cash" && (
              <section className="cash-panel">
                <small>AMOUNT RECEIVED</small>
                <strong>{money(preview.total, locale)}</strong>
                <p>Change due · {money(0, locale)}</p>
              </section>
            )}
            {payment === "split" && (
              <section className="cash-panel">
                <small>SPLIT PAYMENT</small>
                <strong>Cash {money(preview.total / 2, locale)}</strong>
                <p>Card remaining · {money(preview.total / 2, locale)}</p>
              </section>
            )}
            <Totals preview={preview} locale={locale} />
            <div className="simulation-box">
              <AlertTriangle />
              <span>
                <b>
                  {isFixture
                    ? "Development fixture"
                    : "Controlled checkout required"}
                </b>
                {isFixture
                  ? "No production invoice, payment or stock record will be created."
                  : "Production sale confirmation is disabled until the controlled checkout phase."}
              </span>
            </div>
            <button
              className="gold-action"
              disabled={!isFixture || !canCheckout(connection, false, cart)}
              onClick={() => isFixture && setStep("success")}
            >
              {isFixture
                ? `Confirm fixture · ${money(preview.total, locale)}`
                : "Production checkout not enabled"}
            </button>
          </>
        )}
      </section>
    </div>
  );
}
function Totals({
  preview,
  locale,
}: {
  preview: ReturnType<typeof calculatePreview>;
  locale: Locale;
}) {
  return (
    <section className="cart-totals">
      <p>
        <span>Subtotal</span>
        <b>{money(preview.subtotal, locale)}</b>
      </p>
      <p>
        <span>VAT</span>
        <b>{money(preview.tax, locale)}</b>
      </p>
      <p className="grand">
        <span>Total</span>
        <b>{money(preview.total, locale)}</b>
      </p>
    </section>
  );
}

function RegisterFlow({
  locale,
  profile,
  register,
  close,
  refreshed,
}: {
  locale: Locale;
  profile: MobileProfile;
  register: BranchData["register"];
  close: () => void;
  refreshed: () => Promise<void>;
}) {
  const [amount, setAmount] = useState(String(register?.expectedCash ?? 0));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const authorised = isAuthorisedOperationalScope(profile);
  async function submit() {
    setBusy(true);
    setMessage("");
    try {
      if (register?.status === "open") {
        await closeRegister(profile, register.sessionId, Number(amount), notes);
        setMessage(locale === "ar" ? "تم إغلاق الصندوق." : "Register closed.");
      } else {
        await openRegister(profile, Number(amount));
        setMessage(locale === "ar" ? "تم فتح الصندوق." : "Register opened.");
      }
      await refreshed();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Register action failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="sheet-backdrop">
      <section className="cart-sheet register-flow">
        <header>
          <span />
          <div>
            <small>
              {locale === "ar" ? "جلسة الصندوق" : "REGISTER SESSION"}
            </small>
            <h2>
              {register?.status === "open"
                ? locale === "ar"
                  ? "إغلاق الصندوق"
                  : "Close register"
                : locale === "ar"
                  ? "فتح الصندوق"
                  : "Open register"}
            </h2>
          </div>
          <button onClick={close} aria-label="Close register sheet">
            <X />
          </button>
        </header>
        {register && (
          <div className="register-summary-grid">
            <b>
              {locale === "ar" ? "الرصيد الافتتاحي" : "Opening cash"}
              <span>{money(register.openingCash, locale)}</span>
            </b>
            <b>
              {locale === "ar" ? "المبيعات النقدية" : "Cash sales"}
              <span>{money(register.cashTotal, locale)}</span>
            </b>
            <b>
              {locale === "ar" ? "مبيعات البطاقة" : "Card sales"}
              <span>{money(register.cardTotal, locale)}</span>
            </b>
            <b>
              {locale === "ar" ? "النقد المتوقع" : "Expected cash"}
              <span>{money(register.expectedCash, locale)}</span>
            </b>
          </div>
        )}
        <label className="operational-field">
          {register
            ? locale === "ar"
              ? "النقد المعدود"
              : "Counted cash"
            : locale === "ar"
              ? "الرصيد الافتتاحي"
              : "Opening cash"}
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        {register && (
          <label className="operational-field">
            {locale === "ar" ? "ملاحظات" : "Notes"}
            <input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
        )}
        {!authorised && (
          <div className="simulation-box">
            <LockKeyhole />
            <span>
              <b>
                {locale === "ar" ? "للقراءة فقط" : "Read-only production mode"}
              </b>
              {locale === "ar"
                ? "يلزم اعتماد هذا الفرع قبل تغيير جلسة الصندوق."
                : "This Branch must be explicitly authorised before a register mutation."}
            </span>
          </div>
        )}
        {message && (
          <p role="status" className="blocked-note">
            {message}
          </p>
        )}
        <button
          className="green-action"
          disabled={!authorised || busy || Number(amount) < 0}
          onClick={() => void submit()}
        >
          {busy
            ? "Working…"
            : register
              ? locale === "ar"
                ? "تأكيد الإغلاق"
                : "Confirm close"
              : locale === "ar"
                ? "فتح الصندوق"
                : "Open register"}
        </button>
      </section>
    </div>
  );
}

function Invoices({
  locale,
  profile,
  invoices,
}: {
  locale: Locale;
  profile: MobileProfile;
  invoices?: MobileInvoice[];
}) {
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const filtered = invoices?.filter((invoice) =>
    `${invoice.number} ${invoice.customer}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <>
      <section className="invoice-heading">
        <div>
          <p>Sales history</p>
          <h1>Invoices</h1>
        </div>
        <button disabled title="Summary export is not available in this build">
          <BarChart3 />
          Summary
        </button>
      </section>
      <div className="invoice-search">
        <Search />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Invoice number or customer"
        />
        <button
          disabled
          title="Advanced filters are not available in this build"
        >
          <Settings />
        </button>
      </div>
      <div className="filter-pills">
        <button className="active">Recent</button>
      </div>
      <section className="invoice-summary">
        <span>
          <small>Loaded total</small>
          <b>
            {money(
              (invoices ?? []).reduce((sum, row) => sum + row.total, 0),
              locale,
            )}
          </b>
        </span>
        <span>
          <small>Invoices</small>
          <b>{invoices?.length ?? 0}</b>
        </span>
        <span>
          <small>Pending</small>
          <b>
            {invoices?.filter((row) => row.zatcaStatus === "pending").length ??
              0}
          </b>
        </span>
      </section>
      {error && (
        <p className="blocked-note" role="alert">
          {error}
        </p>
      )}
      <InvoiceCards
        invoices={filtered}
        onOpen={async (id) => {
          if (profile.id === "fixture") return;
          setLoading(true);
          setError("");
          try {
            setDetail(await loadInvoiceDetail(profile, id));
          } catch (reason) {
            setError(
              reason instanceof Error
                ? reason.message
                : "Invoice details could not be loaded.",
            );
          } finally {
            setLoading(false);
          }
        }}
      />
      {loading && <p className="blocked-note">Loading invoice…</p>}
      {detail && (
        <InvoiceDetailSheet
          detail={detail}
          locale={locale}
          close={() => setDetail(null)}
        />
      )}
    </>
  );
}
function InvoiceCards({
  compact = false,
  invoices,
  onOpen,
}: {
  compact?: boolean;
  invoices?: MobileInvoice[];
  onOpen?: (id: string) => void;
}) {
  const rows =
    invoices?.map(
      (row) =>
        [
          row.number,
          row.customer,
          row.paymentMethods.join(" + ") || "—",
          row.total.toFixed(2),
          row.zatcaStatus,
          row.id,
        ] as const,
    ) ??
    ([
      [
        "INV-1046",
        "Walk-in customer",
        "Cash",
        "57.50",
        "Reported",
        "fixture-1",
      ],
      ["INV-1045", "Noura Al Harbi", "Card", "126.50", "Pending", "fixture-2"],
    ] as const);
  return (
    <div className={`invoice-cards ${compact ? "compact" : ""}`}>
      {rows
        .slice(0, compact ? 3 : 50)
        .map(([id, customer, payment, total, status, key]) => (
          <article key={key}>
            <span className="invoice-icon">
              <ReceiptText />
            </span>
            <span>
              <b>{id}</b>
              <small>
                {customer} · {payment}
              </small>
              <i
                className={
                  String(status).toLowerCase() === "pending" ? "pending" : ""
                }
              >
                {status}
              </i>
            </span>
            <span>
              <b>SAR {total}</b>
              <button
                aria-label="View invoice"
                disabled={!onOpen}
                onClick={() => onOpen?.(key)}
              >
                <ChevronRight />
              </button>
            </span>
          </article>
        ))}
    </div>
  );
}

function InvoiceDetailSheet({
  detail,
  locale,
  close,
}: {
  detail: InvoiceDetail;
  locale: Locale;
  close: () => void;
}) {
  const share = () =>
    Share.share({
      title: detail.number,
      text: `${detail.number}\n${detail.customer}\n${money(detail.total, locale)}`,
    });
  return (
    <div className="sheet-backdrop">
      <section className="cart-sheet invoice-detail-sheet">
        <header>
          <button onClick={close} aria-label="Close invoice">
            <X />
          </button>
          <span>
            <small>{locale === "ar" ? "الفاتورة" : "Invoice"}</small>
            <b>{detail.number}</b>
          </span>
          <button onClick={() => void share()} aria-label="Share invoice">
            <Share2 />
          </button>
        </header>
        <div className="register-summary-grid">
          <b>
            {locale === "ar" ? "العميل" : "Customer"}
            <span>{detail.customer}</span>
          </b>
          <b>
            {locale === "ar" ? "الحالة" : "Status"}
            <span>{detail.status}</span>
          </b>
          <b>
            {locale === "ar" ? "الدفع" : "Payment"}
            <span>{detail.paymentMethods.join(" + ") || "—"}</span>
          </b>
          <b>
            ZATCA<span>{detail.zatcaStatus}</span>
          </b>
        </div>
        <div className="invoice-detail-items">
          {detail.items.map((item) => (
            <article key={item.id}>
              <span>
                <b>{item.name}</b>
                <small>
                  {item.quantity} {item.unit} × {money(item.price, locale)}
                </small>
              </span>
              <b>{money(item.total, locale)}</b>
            </article>
          ))}
        </div>
        <div className="invoice-total">
          <span>
            {locale === "ar" ? "الضريبة" : "VAT"}
            <b>{money(detail.tax, locale)}</b>
          </span>
          <span>
            {locale === "ar" ? "الإجمالي" : "Total"}
            <b>{money(detail.total, locale)}</b>
          </span>
        </div>
        <button
          className="green-action"
          disabled
          title="Authoritative receipt rendering is not enabled in this build"
        >
          <Printer />
          {locale === "ar" ? "الطباعة غير مفعلة" : "Printing not enabled"}
        </button>
      </section>
    </div>
  );
}

const OPERATIONAL_MODULES: OperationalModule[] = [
  "products",
  "customers",
  "purchases",
  "suppliers",
  "expenses",
];

function OperationalModuleScreen({
  locale,
  profile,
  module,
  back,
}: {
  locale: Locale;
  profile: MobileProfile;
  module: BranchDestination;
  back: () => void;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const supported = OPERATIONAL_MODULES.includes(module as OperationalModule);
  useEffect(() => {
    if (!supported || profile.id === "fixture") return;
    setError("");
    void loadOperationalModule(profile, module as OperationalModule)
      .then(setRows)
      .catch((reason) =>
        setError(
          reason instanceof Error
            ? reason.message
            : "Branch data could not be loaded.",
        ),
      );
  }, [module, profile, supported]);
  const labels: Record<BranchDestination, [string, string]> = {
    home: ["Home", "الرئيسية"],
    sale: ["New Sale", "بيع جديد"],
    invoices: ["Invoices", "الفواتير"],
    products: ["Products", "المنتجات"],
    stock: ["Stock", "المخزون"],
    customers: ["Customers", "العملاء"],
    purchases: ["Purchases", "المشتريات"],
    suppliers: ["Suppliers", "الموردون"],
    expenses: ["Expenses", "المصروفات"],
    reports: ["Reports", "التقارير"],
    settings: ["Settings / Profile", "الإعدادات / الملف الشخصي"],
    help: ["Help & Support", "المساعدة والدعم"],
  };
  const visible = rows.filter((row) =>
    JSON.stringify(row).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="operational-module">
      <header className="invoice-heading">
        <button className="round-button" onClick={back} aria-label="Back">
          <ArrowLeft />
        </button>
        <div>
          <p>{locale === "ar" ? "عمليات الفرع" : "Branch operations"}</p>
          <h1>{labels[module][locale === "ar" ? 1 : 0]}</h1>
        </div>
      </header>
      {!supported ? (
        <div className="simulation-box">
          <LockKeyhole />
          <span>
            <b>{locale === "ar" ? "غير متاح بأمان" : "Not safely available"}</b>
            {locale === "ar"
              ? "لم يتم اعتماد عقد جوال لهذه الوحدة. استخدم مساحة الويب."
              : "No mobile-safe contract is approved for this module. Use the web workspace."}
          </span>
        </div>
      ) : (
        <>
          <div className="invoice-search">
            <Search />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                locale === "ar" ? "بحث" : "Search loaded branch records"
              }
            />
          </div>
          <div className="simulation-box">
            <LockKeyhole />
            <span>
              <b>
                {locale === "ar" ? "عرض آمن للقراءة" : "Safe read-only view"}
              </b>
              {locale === "ar"
                ? "الإضافة والتعديل والحذف غير مفعلة في هذا الإصدار."
                : "Add, edit and delete remain disabled in this production build."}
            </span>
          </div>
          {error && (
            <p className="blocked-note" role="alert">
              {error}
            </p>
          )}
          <div className="operational-list">
            {visible.map((row) => (
              <article key={row.id}>
                <span>
                  <b>
                    {row.name ||
                      row.description ||
                      row.purchase_number ||
                      row.vendor_name ||
                      "Record"}
                  </b>
                  <small>
                    {row.phone ||
                      row.barcode ||
                      row.purchase_date ||
                      row.expense_date ||
                      row.status ||
                      "—"}
                  </small>
                </span>
                <b>
                  {row.total_amount != null
                    ? money(Number(row.total_amount), locale)
                    : row.total_paid != null
                      ? money(Number(row.total_paid), locale)
                      : (row.stock_quantity ?? "")}
                </b>
              </article>
            ))}
            {!error && visible.length === 0 && (
              <p className="blocked-note">
                {locale === "ar"
                  ? "لا توجد سجلات مطابقة."
                  : "No matching records."}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Drawer({
  locale,
  setLocale,
  close,
  go,
  onLogout,
}: {
  locale: Locale;
  setLocale: (x: Locale) => void;
  close: () => void;
  go: (x: BranchDestination) => void;
  onLogout: () => void;
}) {
  const items = [
    ["home", Home, "Home"],
    ["sale", ShoppingBag, "New Sale"],
    ["invoices", ReceiptText, "Invoices"],
    ["products", Package, "Products"],
    ["stock", Boxes, "Stock"],
    ["customers", Users, "Customers"],
    ["purchases", ShoppingCart, "Purchases"],
    ["suppliers", Truck, "Suppliers"],
    ["expenses", WalletCards, "Expenses"],
    ["reports", BarChart3, "Reports"],
    ["settings", Settings, "Settings / Profile"],
    ["help", HelpCircle, "Help & Support"],
  ] as const;
  return (
    <div className="drawer-backdrop" onClick={close}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header>
          <Brand />
          <button onClick={close}>
            <X />
          </button>
        </header>
        <section className="drawer-profile">
          <span>MK</span>
          <div>
            <b>Olaya Branch</b>
            <small>
              <i />
              Register open · Online
            </small>
          </div>
        </section>
        <nav>
          {items.map(([id, Icon, label]) => (
            <button
              key={id}
              className={id === "home" ? "active" : ""}
              onClick={() => go(id)}
            >
              <Icon />
              <span>{label}</span>
              <ChevronRight />
            </button>
          ))}
        </nav>
        <footer>
          <button onClick={() => setLocale(locale === "en" ? "ar" : "en")}>
            <Globe2 />
            {locale === "en" ? "العربية" : "English"}
          </button>
          <button onClick={onLogout}>
            <LogOut />
            Sign out
          </button>
        </footer>
      </aside>
    </div>
  );
}
