import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  calculatePreview,
  canCheckout,
  resolveMobileRole,
} from "../src/domain.ts";
import { products } from "../src/fixtures.ts";
import {
  classifyIdentifier,
  normalizeBranchUsername,
  safeAuthMessage,
  validateBranchUsername,
} from "../src/authContract.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const app = read("src/RedesignedApp.tsx").replaceAll('"', "'");
const auth = read("src/mobileAuth.ts");
const api = read("src/mobileApi.ts").replaceAll('"', "'");
const envExample = read(".env.example");
const css = read("src/redesign.css");
const pkg = read("package.json");
const vite = read("vite.config.ts");
const storage = read("src/platform/cartStorage.ts");

function test(name: string, run: () => void) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("approved Kubri assets are used for icon, wordmark and header mark", () => {
  for (const asset of [
    "kubiri-app-icon.png",
    "kubiri-wordmark.png",
    "kubiri-logo-mark.png",
  ]) {
    assert.match(app, new RegExp(asset));
    assert.equal(
      fs.existsSync(path.resolve(root, "../../public/brand", asset)),
      true,
    );
  }
  assert.match(vite, /publicDir:\s*'\.\.\/\.\.\/public'/);
});
test("POC language is absent from the redesigned experience", () =>
  assert.doesNotMatch(
    app,
    /proof of concept|Kubri Mobile Operations|run the day from your pocket/i,
  ));
test("real auth supports email, branch username and authoritative role resolution", () => {
  assert.match(pkg, /@supabase\/supabase-js/);
  assert.match(auth, /signInWithPassword/);
  assert.match(auth, /resolve-branch-username/);
  assert.match(auth, /user_profiles/);
  assert.match(auth, /data\.role === 'super_admin'/);
});
test("identifier classification supports Owner email and Branch email/username", () => {
  assert.equal(classifyIdentifier("owner@example.com"), "email");
  assert.equal(classifyIdentifier("branch@example.com"), "email");
  assert.equal(classifyIdentifier("branch_name"), "branch-username");
});
test("Branch username normalization exactly mirrors the production web contract", () => {
  assert.equal(normalizeBranchUsername("  Branch_Name  "), "branch_name");
  assert.equal(normalizeBranchUsername("Kubri Trading"), "kubri trading");
  assert.equal(
    validateBranchUsername("kubri trading"),
    "Use 3–32 lowercase letters, numbers, underscore, or hyphen.",
  );
  assert.equal(validateBranchUsername("branch_name"), null);
});
test("display names are not fuzzily converted into login usernames", () => {
  assert.notEqual(normalizeBranchUsername("Kubri Trading"), "kubritrading");
  assert.notEqual(normalizeBranchUsername("Kubri Trading"), "kubri-trading");
});
test("reserved, malformed and ambiguous-looking usernames fail before resolver invocation", () => {
  assert.ok(validateBranchUsername("admin"));
  assert.ok(validateBranchUsername("_branch"));
  assert.ok(validateBranchUsername("branch--one"));
  assert.ok(validateBranchUsername("فرع"));
});
test("safe errors distinguish resolver and post-resolution password failures", () => {
  assert.match(safeAuthMessage("username-not-found"), /could not find/i);
  assert.match(safeAuthMessage("invalid-password"), /password is incorrect/i);
  assert.match(safeAuthMessage("network"), /connect/i);
  assert.doesNotMatch(
    safeAuthMessage("email-credentials"),
    /account exists|email found/i,
  );
});
test("session restoration, refresh and logout are supported", () => {
  assert.match(auth, /persistSession:\s*true/);
  assert.match(auth, /autoRefreshToken:\s*true/);
  assert.match(auth, /getSession/);
  assert.match(auth, /auth\.signOut/);
  assert.match(auth, /Preferences/);
});
test("profile failure clears the accepted Auth session locally", () => {
  assert.match(auth, /catch \(profileError\)/);
  assert.match(auth, /signOut\(\{ scope: 'local' \}\)/);
});
test("auth diagnostics contain categories but no password or token values", () => {
  assert.match(auth, /resolver=resolved mapped-email=true/);
  assert.doesNotMatch(auth, /console\\.(?:info|log).*password/);
  assert.doesNotMatch(
    auth,
    /console\\.(?:info|log).*access_token|console\\.(?:info|log).*refresh_token/,
  );
});
test("public production configuration is validated without secret credentials", () => {
  for (const key of [
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
    "VITE_APP_ENV",
    "VITE_MOBILE_ACCESS_MODE",
  ])
    assert.match(envExample, new RegExp(key));
  assert.doesNotMatch(
    auth + api + envExample,
    /service[_-]?role|database.password|jwt.signing|production_csid/i,
  );
});
test("production data queries are tenant and Branch scoped", () => {
  for (const table of ["'products'", "'customers'", "'invoices'"])
    assert.match(api, new RegExp(`from\\(${table}\\)`));
  assert.match(api, /\.eq\('tenant_id', profile\.tenantId\)/);
  assert.match(api, /\.eq\('branch_id', profile\.branchId\)/);
});
test("authoritative dashboard, session and register contracts are reused", () => {
  for (const rpc of [
    "get_dashboard_summary",
    "get_register_session_summary",
    "open_register_session",
    "close_register_session",
  ])
    assert.match(api, new RegExp(rpc));
});
test("operational writes require exact configured tenant and Branch scope", () => {
  assert.match(api, /profile\.tenantId === authorisedTenant/);
  assert.match(api, /profile\.branchId === authorisedBranch/);
  assert.match(api, /accessMode !== 'read-only'/);
});
test("production checkout has an explicit multi-condition safety gate", () => {
  assert.match(api, /VITE_MOBILE_PRODUCTION_CHECKOUT === 'true'/);
  assert.match(api, /accessMode !== 'production-checkout'/);
  assert.match(api, /register\?\.status !== 'open'/);
  assert.doesNotMatch(api, /\.rpc\('pos_checkout'/);
});
test("barcode resolution is server-scoped and does not download every product", () => {
  const resolver = api.slice(
    api.indexOf("export async function resolveProductBarcode"),
  );
  assert.match(resolver, /\.eq\('barcode', barcode\)/);
  assert.match(resolver, /\.eq\('branch_id', profile\.branchId\)/);
  assert.doesNotMatch(resolver, /loadBranchData/);
});
test("demo bypass is guarded by an explicit build-time flag", () => {
  assert.match(app, /VITE_MOBILE_DEMO_MODE === ["']true["']/);
  assert.doesNotMatch(app, /VITE_MOBILE_DEMO_MODE !== 'false'/);
});
test("WhatsApp uses the approved support number and localized prefill", () => {
  assert.match(app, /971561373210/);
  assert.match(app, /create a Kubri account/);
  assert.match(app, /إنشاء حساب Kubri/);
});
test("Branch bottom navigation has exactly the three approved destinations", () => {
  const nav = app.slice(
    app.indexOf("function BranchNav"),
    app.indexOf("function BranchHome"),
  );
  for (const tab of ["'home'", "'sale'", "'invoices'"])
    assert.match(nav, new RegExp(tab));
  assert.equal((nav.match(/\['(?:home|sale|invoices)'/g) ?? []).length, 3);
});
test("drawer preserves the supported Branch modules", () => {
  for (const label of [
    "Products",
    "Stock",
    "Customers",
    "Purchases",
    "Suppliers",
    "Expenses",
    "Reports",
    "Settings / Profile",
    "Help & Support",
  ])
    assert.match(app, new RegExp(label.replace("/", "\\/")));
  assert.doesNotMatch(
    app.slice(app.indexOf("function Drawer")),
    /\["register",/,
  );
});
test("RTL and Android Back behavior are present", () => {
  assert.match(app, /document\.documentElement\.dir/);
  assert.match(css, /\[dir=(?:"rtl"|rtl)\]/);
  assert.match(app, /addListener\('backButton'/);
  assert.match(app, /NativeApp\.minimizeApp/);
});
test("home contains featured KPI, register, recent invoices and low-stock attention", () => {
  for (const contract of [
    "sales-ledger",
    "quick-grid",
    "register-card",
    "Recent invoices",
    "low in stock",
  ])
    assert.match(app, new RegExp(contract));
});
test("POS provides search, categories, scanner, repeated quantity and cart dock", () => {
  for (const contract of [
    "product-search",
    "category-row",
    "scanSingleBarcode",
    "Math.min\\(l.quantity\\s*\\+\\s*1",
    "final-cart-dock",
  ])
    assert.match(app, new RegExp(contract));
});
test("cart survives tab changes and stores no invoice/payment queue", () => {
  assert.match(app, /cartStorage\.restore/);
  assert.match(app, /cartStorage\.save/);
  assert.doesNotMatch(storage, /queue|invoice_number|payment|fiscal/i);
});
test("payment methods are Cash, Card and Split only and checkout remains disabled", () => {
  assert.match(
    app,
    /type Payment = ["']cash["'] \| ["']card["'] \| ["']split["']/,
  );
  assert.doesNotMatch(
    app,
    /type Payment = .*credit|payment:\s*["']credit["']|>Credit</,
  );
  assert.match(app, /Production checkout not enabled/);
  assert.match(app, /disabled=\{!isFixture \|\| !canCheckout/);
});
test("offline and reconciliation boundaries prevent checkout", () => {
  const line = [{ product: products[0], quantity: 1 }];
  assert.equal(canCheckout("offline", false, line), false);
  assert.equal(canCheckout("online", true, line), false);
  assert.match(app, /Nothing will be queued/);
});
test("mobile never chooses a production fiscal path", () => {
  assert.doesNotMatch(
    app + auth,
    /pos_checkout|prepare_zatca|production_csid|service_role/i,
  );
  const preview = calculatePreview(
    [{ product: products[0], quantity: 1 }],
    "request-123",
  );
  assert.equal(preview.serverConfirmed, false);
  assert.equal(preview.requestId, "request-123");
});
test("invoice screen includes mobile filters, status and actions", () => {
  for (const contract of [
    "loadInvoiceDetail",
    "InvoiceDetailSheet",
    "View invoice",
    "Share.share",
  ])
    assert.match(app, new RegExp(contract));
  assert.match(api, /printEligible/);
});
test("operational drawer destinations are real read-only views or clearly unavailable", () => {
  for (const module of ["products", "customers", "purchases", "suppliers"])
    assert.match(api, new RegExp(`module === '${module}'`));
  assert.match(api, /\.from\('expenses'\)/);
  assert.match(app, /Safe read-only view/);
  assert.match(app, /No mobile-safe contract is approved/);
});
test("register uses authoritative guarded mutations and refreshes Branch data", () => {
  assert.match(app, /function RegisterFlow/);
  assert.match(app, /isAuthorisedOperationalScope/);
  assert.match(app, /await openRegister/);
  assert.match(app, /await closeRegister/);
  assert.match(app, /await refreshed\(\)/);
});
test("accessibility and reduced-motion contracts are present", () => {
  assert.match(app, /aria-label=/);
  assert.match(app, /role='alert'/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /min-height:\s*44px/);
});
test("required native dependencies remain present", () => {
  for (const dependency of [
    "@capacitor/barcode-scanner",
    "@capacitor/share",
    "@capacitor/network",
    "@capacitor/app",
  ])
    assert.match(pkg, new RegExp(dependency.replace("/", "\\/")));
});

console.log("Mobile redesign focused contract suite complete.");
