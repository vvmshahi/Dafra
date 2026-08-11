# Kubri production release safety

`main` is Kubri's only Production source of truth. A Production Vercel
deployment must be built from a committed SHA on `origin/main`; do not deploy a
feature branch, a detached worktree, or uncommitted local files to Production.

## Starting UI work

Start every UI change from the latest remote Production baseline:

```sh
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c feature/<focused-change>
```

Use a clean secondary worktree for recovery or release work. Do not develop in
or clean up a dirty legacy worktree. Keep unrelated local artifacts outside the
release staging set.

## Before merging a feature

1. Fetch `origin` and bring the feature branch up to date with `origin/main`.
2. Resolve only understood conflicts; do not replace `main` with an old branch
   or merge a historical feature branch wholesale.
3. Run the build and the required regression checks, including document
   presentation and printing checks.
4. Review the final diff for changes to invoice issue, receipts, refunds,
   returns, payments, VAT, totals, QR, counters, inventory, authentication,
   branch scope, and customer selection.
5. Use focused commits or known focused cherry-picks only. Never force-push
   `main`.

At minimum, a document/UI release should run:

```sh
npm ci
npm test
npm run build
node scripts/test-invoice-settings-ux-redesign.mjs
npm run test:phase4e-thermal-receipts
npm run test:phase4f-a4-templates
git diff --check
```

Run any applicable checkout, credit-note/refund, and ZATCA regression scripts
when a change touches those surfaces. Do not use `npm audit fix` as part of a
release.

## Deployment procedure

1. Push the reviewed stabilization or release commit to `origin/main`.
2. Confirm `git rev-parse HEAD` matches `origin/main`.
3. Deploy the exact committed worktree to the existing Vercel project as a
   Preview first.
4. Validate the Preview with a safe test account, including login, branch
   isolation, invoice settings save/reload, invoice issue, receipt issue,
   refund/return, Walk-in Customer, Arabic/English, QR, totals, and browser
   printing.
5. Only after the Preview passes, deploy that same committed SHA to Production
   and repeat the live smoke checks.

Do not change Vercel domains or environment variables during a normal release.
Do not promote an uncommitted Preview build to Production.

## Stable recovery points and rollback

Every verified Production milestone receives an immutable annotated tag:

```sh
git tag -l 'kubri-web-stable-*' --sort=-creatordate
git show kubri-web-stable-YYYY-MM-DD
```

Never move or reuse a stable tag. To roll back, identify the verified stable
tag, create a focused rollback commit from the current `main` history (or use
the hosting provider's deployment rollback for an immediate operational
recovery), validate it, then deploy the resulting committed `main` SHA. Do not
force-push or reset Production history to roll back.

## Financial and document integrity

Presentation work must remain presentation-only. It must not change ZATCA
signing/XML, invoice hashes or numbering, counters, VAT/totals, payments,
refund calculations, return linkage, inventory effects, customer semantics, or
branch isolation unless the release explicitly documents and independently
validates that change.

Receipt and invoice customization must be checked end-to-end: UI, normalized
settings, save, reload, preview, newly issued document, browser print, and
thermal/Electron print. Web printing must not open a visible new tab; Electron
printing must retain its existing behavior.
