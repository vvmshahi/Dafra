-- Keep the existing column-level invoice read boundary while exposing the
-- non-sensitive demo marker required by authenticated invoice history.
GRANT SELECT (is_demo) ON TABLE public.invoices TO authenticated;
