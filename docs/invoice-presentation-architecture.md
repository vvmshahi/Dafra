# Invoice presentation architecture

Invoice Settings values are normalized by `normalizeInvoiceSettings` and resolved
through `resolveInvoicePresentationSettings`. Preview settings use
`documentFromPreviewDraft`, which builds a `DocumentViewModel` consumed by
`ThermalReceipt` and `A4Document`.

Stored historical invoices continue to use the legacy branch/tenant fallback in
`documentFromLegacyInvoice`; Phase 6A identity snapshots and compliance profiles
remain deferred. This fallback is presentation-only and does not alter invoice
identity, totals, VAT, QR, XML, hashes, UUIDs, or payment data. Legal seller
identity in the view model remains separate from presentation contact overrides;
the latter is rendered only as an optional, deduplicated contact line.

POS, ReceiptPrintPage, and Invoice Detail now pass the same canonical
`DocumentViewModel` contract to the renderers. Their print execution helpers
remain intentionally unchanged.
