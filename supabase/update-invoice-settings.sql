-- Invoice Settings columns for branches table
-- Run after update-branches.sql (show_logo and website already exist)

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS display_name       text,
  ADD COLUMN IF NOT EXISTS show_website       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_email         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_footer        boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_cash_change   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS print_mode         text    NOT NULL DEFAULT 'thermal'
    CHECK (print_mode IN ('thermal', 'pdf', 'both'));

COMMENT ON COLUMN branches.display_name     IS 'Optional UI display name override — shown on invoice headers; QR tag 1 always uses business_name';
COMMENT ON COLUMN branches.show_website     IS 'Whether to print website URL on invoices';
COMMENT ON COLUMN branches.show_email       IS 'Whether to print email on invoices';
COMMENT ON COLUMN branches.show_footer      IS 'Whether to print the receipt_footer text on receipts';
COMMENT ON COLUMN branches.show_cash_change IS 'Whether to print change amount on cash receipts';
COMMENT ON COLUMN branches.print_mode       IS 'Default print format shown after each POS sale: thermal | pdf | both';
