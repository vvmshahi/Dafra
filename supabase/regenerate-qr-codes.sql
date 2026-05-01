-- Null out all stored QR codes so InvoiceDetailPage regenerates them
-- on next view using the fixed normalizeTimestamp (Z suffix counted in TLV length byte).
UPDATE invoices SET zatca_qr_code = NULL;
