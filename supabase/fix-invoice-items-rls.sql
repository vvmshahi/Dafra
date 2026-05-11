DROP POLICY IF EXISTS "invoice_items_branch_read" ON invoice_items;

CREATE POLICY "invoice_items_branch_read"
  ON invoice_items
  FOR SELECT TO authenticated
  USING (
    invoice_id IN (
      SELECT id FROM invoices
      WHERE branch_id = get_my_branch_id()
        AND tenant_id = get_my_tenant_id()
    )
    OR get_my_role() IN (
      'owner'::user_role,
      'super_admin'::user_role
    )
  );
