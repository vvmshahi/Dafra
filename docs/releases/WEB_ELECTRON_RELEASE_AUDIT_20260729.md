# Kubri web and Electron release-readiness audit — 2026-07-29

## 1. Executive summary

The current web source builds and its focused authentication, routing, Owner, Branch, checkout, invoice, reporting, printing, barcode, and security contracts pass. No P0 defect was found. The production web deployment is `READY`, and Supabase migration history is aligned with no pending migration. A final authenticated production smoke test is still required because this audit used no Owner or Branch password and issued no invoice.

Electron is **not release-ready**. It packages the authoritative root Vite application rather than a copied frontend, and its BrowserWindow defaults are appropriately hardened. However, Electron 28 is end-of-support, macOS packaging is unsigned and failed before producing installers because the workstation ran out of space, the Windows NSIS output is unsigned, and the installed `1.0.2` application contains a different frontend bundle from current main while using the same version number.

Recommendation: **B — release/retain web today after the authenticated smoke gate; keep Electron as a release candidate.**

## 2. Current main and production state

- Audited branch point: `main`
- Local and `origin/main`: `46017f6406884cccca94e969560afe6ee1886463`
- Working tree before audit: clean; no merge or rebase
- Production Vercel deployment: `dpl_HktcdSH77uBS1YxZE9K6NSE6WgR9`
- State/target: `READY` / `production`
- Deployment URL: `dafra-2pk9jwklq-mohammed-shahin-v-vs-projects.vercel.app`
- Aliases: `kubri.shop`, `www.kubri.shop`, `dafra.vercel.app`, `dafra-mohammed-shahin-v-vs-projects.vercel.app`, `dafra-git-main-mohammed-shahin-v-vs-projects.vercel.app`
- Public checks: `/` and `/login` returned HTTP 200. One cold root sample was 3.385 s TTFB; a following `/login` sample was 0.894 s TTFB.
- No deployment, migration, or production-data write was performed.

## 3. Web readiness

### Authentication and routing

- Source and focused tests pass for profile bootstrap security, existing Owner/Branch routing, mounted route recovery, inactive-profile handling, authoritative role routing, and tenant/Branch scoping.
- Source supports Owner email, Branch email/username resolution, forgot/reset password, logout, persisted session restoration, suspended/inactive checks, Super Admin routing, and protected role routes.
- No authenticated production session was used in this audit. Owner login, Branch login, password recovery delivery, inactive/suspended live responses, and cross-tenant rejection therefore remain a mandatory release smoke gate, not a claimed live pass.

### Owner/Admin and Branch workflows

- Focused contracts pass for Owner workspace, dashboard/product schema compatibility, register-session access, products, customers, reports, invoices, receipt/printing, barcode capture, configured/blocked checkout routing, atomic Simplified checkout, and demo checkout.
- Routes exist for dashboards, Branches, ZATCA, employees, settings, POS, invoices/details, products, inventory, purchases, customers, expenses, reports, suppliers, day closing, and printer settings.
- No uncontrolled real fiscal invoice was issued. Production fiscal behavior is supported by architecture/runtime contract evidence only.
- No release-blocking responsive/RTL defect was identified from the current source and focused UI tests. Authenticated primary screens were not visually exercised in production during this audit and must be included in the smoke gate at 1024 px and 1440 px widths in English and Arabic.

### Checkout and invoice safety

- Configured production routing, `INVOICE_CAPABILITY_NOT_CONFIGURED`, atomic Simplified behavior, legacy fallback boundaries, idempotency, stock/payment/register atomicity, print eligibility, and outbox authorization pass focused tests.
- Demo checkout is server-authorized, ignores client demo flags, produces explicitly non-fiscal output, and is guarded against production ZATCA/outbox/chain behavior by the deployed contract.
- The single physical end-to-end demo Cash sale remains incomplete after the latest Android reinstall cleared authentication; mobile is parked and out of this release scope. For web release, perform one controlled web demo sale only if authorized.

## 4. Electron readiness

### Architecture and functionality

- Project path: `electron/`
- Package/product/version: `kubri` / `Kubri` / `1.0.2`
- Electron: `28.3.3`; builder: `electron-builder 24.13.3`
- App identifiers: macOS/Windows `com.kubri.pos`; Windows artifact name `Kubri-Setup-1.0.2.exe`
- Production content model: local root `dist/` served through `kubri://app/`; it reuses the current authoritative React application. Development loads only `http://127.0.0.1:5175`.
- Preload: `electron/preload.cjs`; explicit printer/settings bridge only.
- Owner, Branch, Super Admin, POS, invoices, reports, Arabic/RTL, persisted Supabase session, and keyboard barcode-scanner behavior reuse the web implementation.
- Receipt and A4 printing code supports named printers, 58 mm/80 mm/custom receipt widths, copies, margins, calibration, silent receipt output, and preview fallback. No physical Windows/macOS printer was tested, so hardware compatibility is unverified.
- Default browser download behavior exists, but there is no dedicated `will-download`/safe-save contract. There is no deep-link or auto-update implementation. There is no desktop-wide proactive offline banner; request-level network errors provide the current workaround.
- The installed `/Applications/Kubri.app` reports version `1.0.2` but its `app.asar` hash and frontend asset names differ from the current main package. Current source contains `index-C4UVeJfJ.js`; installed app contains `index-CzxPAhHP.js`.

### Security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and `webSecurity: true`.
- Production navigation is restricted to `kubri://app`; external navigation/window requests permit only `https:` and `mailto:` through `shell.openExternal`.
- No certificate bypass, disabled web security, service-role key, database password, or bundled private key was found.
- IPC exposes printer/settings operations only and validates receipt UUIDs, printer names, settings keys, numeric ranges, and copy limits.
- IPC handlers do not independently validate `event.senderFrame.url`. The current local-only navigation boundary limits exposure, but sender validation should be added before release as defense in depth.
- Supabase session persistence uses Chromium storage under Electron user data. It is not a service credential, but encrypted-at-rest/OS-account expectations should be documented.
- Electron 28.3.3 embeds Chromium 120 and is explicitly end-of-support. Electron supports only its latest three stable majors; upgrading is release-blocking. See the official [Electron 28.3.3 release status](https://releases.electronjs.org/release/v28.3.3) and [support policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines).

### Build results

- macOS configured targets: DMG and ZIP for x64 and arm64.
- x64 `.app` packaging reached `dist-electron/mac/Kubri.app` unsigned.
- The combined macOS command failed during arm64 extraction with `no space left on device`; no DMG/ZIP completed.
- No valid `Developer ID Application` identity was found; notarization credentials/configuration are absent.
- Windows x64 cross-build succeeded on macOS with no native dependencies, producing an unsigned 105,371,984-byte NSIS installer at `dist-electron/Kubri-Setup-1.0.2.exe`. Wine emitted missing-FreeType warnings, but the build exited 0.
- Windows Authenticode signing configuration is absent. The installer was not launched on Windows.
- Audit-generated packages were moved to Trash after recording evidence and were not published.

## 5. P0/P1 blockers

No P0 blocker was found.

| ID | Area | Target | Severity | Exact evidence / reproducibility | Customer impact | Data/fiscal risk | Smallest safe fix | Complexity | Required testing | EOD | Blocking |
|---|---|---|---|---|---|---|---|---|---|---|---|
| E-01 | Runtime security | Electron | P1 | `electron@28.3.3`; official release page says end-of-support | Unsupported Chromium/Node runtime in a desktop app handling authenticated business data | Elevated security exposure; no observed breach | Upgrade to a currently supported Electron major, update builder if required, and rerun security/printing/package regression | Medium | macOS/Windows launch, auth, navigation, IPC, print, package smoke | No | Yes |
| E-02 | macOS distribution | Electron | P1 | `desktop:build:mac` failed with `no space left on device`; zero valid signing identities; no DMG/ZIP | No installable, Gatekeeper-compatible macOS release | No direct fiscal risk | Free sufficient disk space, configure Developer ID signing/notarization, build each architecture, verify both | Medium | clean x64/arm64 build, codesign, notarization, install/reopen, printer smoke | No | Yes |
| E-03 | Windows distribution | Electron | P1 | NSIS cross-build succeeds but is unsigned; no Windows launch/printer test | SmartScreen friction and unverified production behavior | Checkout/printing behavior unverified on target OS | Configure Authenticode, bump version, build, sign, and test on real Windows x64 | Medium | signature, clean install/upgrade/uninstall, auth, POS, scanner, printers, PDF/download | No | Yes |
| E-04 | Version/provenance | Electron | P1 | Installed and current packages both say `1.0.2`, but `app.asar` and entry assets differ | Operators cannot identify authoritative build; same-version upgrade is ambiguous | Users may run stale checkout/UI logic | Increment version, embed/verify main SHA, produce a release manifest, test upgrade from installed `1.0.2` | Small | in-app version/SHA, installer upgrade, package checksum | Yes | Yes |
| R-01 | Release validation | Both | P1 | No Owner/Branch credentials or authenticated production browser session were used; no target-OS desktop smoke | Core live workflows cannot be claimed verified for this release | Fiscal/data risk if an unobserved live mismatch exists | Execute a controlled read-first Owner/Branch smoke and one authorized demo checkout; no real fiscal sale | Small | checklist in section 10 plus read-only deltas | Yes for web; no for desktop | Yes |

## 6. P2/P3 deferred issues

| ID | Area | Target | Severity | Exact evidence / reproducibility | Customer impact | Data/fiscal risk | Smallest safe fix | Complexity | Required testing | EOD | Blocking |
|---|---|---|---|---|---|---|---|---|---|---|---|
| W-01 | Bundle/load | Both | P2 | Main entry is 2.80 MB / 748.76 KB gzip locally; production entry is 2.89 MB and took 1.68 s in one sample | Slower cold start, especially on weak networks/devices | None | Route-split primary workspaces and defer heavy report/emoji/PDF code | Medium | bundle budget plus cold authenticated route timings | No | No |
| E-05 | IPC hardening | Electron | P2 | IPC handlers validate payloads but not sender frame origin | Reduces defense in depth if renderer compromise occurs | Limited printer/settings misuse | Central trusted-sender guard for every IPC handler/event | Small | negative IPC tests from untrusted frame | Yes | No after E-01 |
| E-06 | Platform features | Electron | P2 | No updater, deep links, dedicated download handler, or desktop-wide offline indicator | Manual updates and less clear recovery/download behavior | None if checkout remains server-confirmed | Define signed update/download policy and add online-only warning later | Medium | update rollback, safe-save paths, network loss | No | No |
| T-01 | Test harness | Web | P3 | `test-phase1-route-auth-recovery-runtime.mjs` prints PASS but retains a live Node handle | CI/manual suite can hang after success | None | Dispose imported client/timer or explicitly close the harness | Small | process exits 0 without timeout | Yes | No |
| E-07 | Package metadata | Electron | P3 | Builder warns `description` and `author` are missing; icon path first resolves redundantly | Installer metadata polish | None | Add package metadata and normalize build-resource icon path | Small | package metadata inspection | Yes | No |

## 7. Performance findings

- Root production HTML: 1,193 bytes; immutable asset caching is enabled.
- Main production JS: 2,889,131 bytes. Current local build main JS: 2,798,150 bytes (748.76 KB gzip).
- Heavy split assets already include report PDF exporters (452 KB), emoji picker (309 KB), html2canvas (201 KB), and jsPDF support; the base application still remains too large.
- No obvious N+1 loop or duplicated checkout request was found in the focused source review. Authentication has guards against duplicate profile reloads.
- Authenticated dashboard/POS/invoice/report timings were not measurable without an authenticated web session. Measure these during R-01 before declaring performance acceptance.

## 8. Migration status

- Linked Supabase project: `bkbphkpqcxuejozayrsy`, status `ACTIVE_HEALTHY`.
- `supabase migration list --linked`: local and remote histories align through `20260729000400`.
- Recorded recent migrations include Sales report `20260729000100`, demo checkout `20260729000300`, and demo invoice read grant `20260729000400`.
- `supabase db push --linked --dry-run`: `Remote database is up to date.`
- No pending, failed, or partially applied migration was observed. No schema change was applied.

## 9. Test results

Passed:

- TypeScript and Vite production build; `git diff --check`.
- Auth profile bootstrap security and existing Owner/Branch routing.
- Route/auth recovery assertions (PASS output; harness non-termination recorded as T-01).
- Owner workspace and dashboard product-schema compatibility.
- POS register-session access, product catalogue, and customer modal.
- Atomic Simplified checkout (28 architecture/incident scenarios), production checkout hotfix, and demo checkout.
- Invoice detail, Phase 4G invoice release readiness, printing documents, unified barcode scanner, Sales report fix, and ZATCA outbox security.
- Windows x64 unsigned NSIS cross-build.

Failed/blocked:

- macOS combined x64/arm64 DMG+ZIP: disk exhaustion during arm64 extraction; signing identity absent.
- Authenticated production web and real Windows/macOS hardware workflow smoke: not executed because credentials/hardware evidence were not available in scope.

## 10. EOD release recommendation

Choose **B: release/retain web today; Electron remains a release candidate**, conditional on the following web smoke gate:

1. Owner email sign-in, session restore, role route, dashboard, Branch list, Sales report zero/data state, invoice list/detail, logout.
2. Branch email and username sign-in, open-session visibility, POS product/barcode/cart/customer paths, invoice history, and logout.
3. One authorized Kubri Trading Demo Cash checkout with read-only before/after invoice/payment/stock/register/outbox/chain evidence.
4. Read-only verification that an unconfigured real Branch remains blocked and a configured Branch retains its route; issue no real invoice.
5. English and Arabic checks at 1024×768 and 1440×900, including dialogs, tables, receipt, error/empty/loading states.
6. Confirm production aliases point to the intended main deployment and review console/network errors.

Web deployment after a fix, if one is actually needed:

```sh
git checkout main
git pull --ff-only origin main
npm ci
npm run build
git diff --check
git push origin main
```

Do **not** release Electron today. Do not publish the unsigned Windows installer or any unsigned/unnotarized macOS package. Do not issue a real fiscal test invoice, add an updater hurriedly, or attempt broad performance redesign.

## 11. Exact next implementation order

1. Complete R-01 authenticated web smoke; release/retain web only if it passes.
2. Bump the desktop application version and establish SHA/checksum release provenance (E-04).
3. Upgrade Electron to a supported major and rerun security/print regressions (E-01).
4. Add IPC sender validation (E-05).
5. Free build capacity; configure macOS Developer ID signing/notarization and Windows Authenticode (E-02/E-03).
6. Build clean macOS x64/arm64 and Windows x64 packages; test install/upgrade/reopen on each target OS.
7. Validate real 58 mm/80 mm printers, A4/PDF, keyboard barcode scanners, Arabic/RTL, downloads, session restoration, offline recovery, and checkout result reconciliation.
8. Defer bundle splitting, updater/deep links, and metadata polish until the signed desktop release candidate is functionally proven.
