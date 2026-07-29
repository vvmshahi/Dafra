// Auto-generated types matching supabase/schema.sql
// Run `supabase gen types typescript` to regenerate after schema changes.

export type UserRole = 'super_admin' | 'owner' | 'branch'
export type BusinessType = 'trading' | 'service'
export type BranchPosMode = 'touch' | 'quick'
export type ZatcaEnvironment = 'production' | 'sandbox'
export type VatExpenseTreatment = 'no_vat' | 'included' | 'on_top'
export type ExpenseVatClaimStatus = 'no_vat' | 'claimable' | 'not_claimable' | 'needs_review'
export type ExpensePaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'other'
export type InvoiceType = 'standard' | 'simplified' | 'credit_note' | 'debit_note'
export type InvoiceStatus = 'draft' | 'posted' | 'cancelled'
export type ZatcaStatus = 'not_submitted' | 'pending' | 'reported' | 'cleared' | 'failed'
export type ZatcaFinalizationStatus = 'not_started' | 'finalizing' | 'finalized' | 'failed'
export type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'other'
export type PaymentStatus = 'pending' | 'paid' | 'partial' | 'refunded'
export type SubscriptionStatus = 'trial' | 'active' | 'expired' | 'cancelled'
export type ManualSubscriptionPlanInterval = 'monthly' | 'yearly' | 'manual' | 'custom' | 'lifetime'
export type ManualPaymentStatus = 'unpaid' | 'manual_verified' | 'overdue' | 'refunded'
export type BillingSignal = 'paid' | 'due_soon' | 'in_grace' | 'overdue' | 'suspended' | 'unknown'
export type SubscriptionLifecycleStatus =
  | 'setup_pending'
  | 'active'
  | 'payment_due'
  | 'grace_period'
  | 'suspended'
  | 'cancelled'
  | 'lifetime_free'
export type TenantOnboardingStatusValue =
  | 'details_pending'
  | 'owner_invited'
  | 'owner_setup_complete'
  | 'branch_setup_pending'
  | 'zatca_setup_pending'
  | 'ready_for_billing'
  | 'live'
export type OwnerSetupStatus = 'owner_invited' | 'owner_setup_complete' | 'setup_link_expired' | 'setup_blocked'
export type BranchSetupStatus = 'branch_setup_pending' | 'first_branch_created' | 'branch_setup_complete'
export type ZatcaSetupStatus = 'zatca_setup_pending' | 'not_required' | 'in_progress' | 'production_ready' | 'needs_attention'
export type TenantSupportNoteType = 'general' | 'payment' | 'onboarding' | 'support' | 'risk' | 'zatca'
export type SyncStatus = 'pending' | 'processing' | 'success' | 'failed'
export type CertificateStatus = 'pending' | 'compliance' | 'active' | 'revoked' | 'expired'

export interface Database {
  public: {
    Tables: {
      subscription_plans: {
        Row: SubscriptionPlan
        Insert: Omit<SubscriptionPlan, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<SubscriptionPlan, 'id'>>
      }
      tenants: {
        Row: Tenant
        Insert: TenantInsert
        Update: Partial<Omit<Tenant, 'id'>>
      }
      tenant_subscriptions: {
        Row: TenantSubscription
        Insert: TenantSubscriptionInsert
        Update: Partial<Omit<TenantSubscription, 'id'>>
      }
      manual_subscription_payments: {
        Row: ManualSubscriptionPayment
        Insert: ManualSubscriptionPaymentInsert
        Update: Partial<Omit<ManualSubscriptionPaymentInsert, 'tenant_id'>>
      }
      tenant_onboarding_status: {
        Row: TenantOnboardingStatus
        Insert: TenantOnboardingStatusInsert
        Update: Partial<Omit<TenantOnboardingStatusInsert, 'tenant_id'>>
      }
      tenant_support_notes: {
        Row: TenantSupportNote
        Insert: TenantSupportNoteInsert
        Update: Partial<Omit<TenantSupportNoteInsert, 'tenant_id' | 'created_by'>>
      }
      branches: {
        Row: Branch
        // Explicit insert/update types avoid TypeScript resolving union literals to
        // `never` when supabase-js reconciles narrow types against its overloads.
        Insert: BranchInsert
        Update: BranchUpdate
      }
      user_profiles: {
        Row: UserProfile
        Insert: Omit<UserProfile, 'created_at' | 'updated_at'>
        Update: UserProfileUpdate
      }
      branch_login_usernames: {
        Row: BranchLoginUsername
        Insert: BranchLoginUsernameInsert
        Update: BranchLoginUsernameUpdate
      }
      zatca_certificates: {
        Row: ZatcaCertificate
        Insert: Omit<ZatcaCertificate, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<ZatcaCertificate, 'id'>>
      }
      categories: {
        Row: Category
        Insert: CategoryInsert
        Update: CategoryUpdate
      }
      products: {
        Row: Product
        Insert: ProductInsert
        Update: ProductUpdate
      }
      customers: {
        Row: Customer
        Insert: CustomerInsert
        Update: CustomerUpdate
      }
      employees: {
        Row: Employee
        Insert: Omit<Employee, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Employee, 'id'>>
      }
      invoices: {
        Row: Invoice
        Insert: Omit<Invoice, 'id' | 'created_at' | 'updated_at' | 'zatca_uuid'>
        Update: Partial<Omit<Invoice, 'id'>>
      }
      invoice_items: {
        Row: InvoiceItem
        Insert: Omit<InvoiceItem, 'id' | 'created_at'>
        Update: Partial<Omit<InvoiceItem, 'id'>>
      }
      payments: {
        Row: Payment
        Insert: Omit<Payment, 'id' | 'created_at' | 'updated_at' | 'amount_received' | 'change_amount'> & {
          amount_received?: number | null
          change_amount?: number | null
        }
        Update: Partial<Omit<Payment, 'id'>>
      }
      payment_refunds: {
        Row: PaymentRefund
        Insert: Omit<PaymentRefund, 'id' | 'created_at'>
        Update: Partial<Omit<PaymentRefund, 'id'>>
      }
      sync_queue: {
        Row: SyncQueueItem
        Insert: Omit<SyncQueueItem, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<SyncQueueItem, 'id'>>
      }
      expense_categories: {
        Row: ExpenseCategory
        Insert: ExpenseCategoryInsert
        Update: ExpenseCategoryUpdate
      }
      expenses: {
        Row: Expense
        Insert: ExpenseInsert
        Update: ExpenseUpdate
      }
      fixed_expenses: {
        Row: FixedExpense
        Insert: FixedExpenseInsert
        Update: FixedExpenseUpdate
      }
      suppliers: {
        Row: Supplier
        Insert: SupplierInsert
        Update: SupplierUpdate
      }
      inventory_items: {
        Row: InventoryItem
        Insert: InventoryItemInsert
        Update: InventoryItemUpdate
      }
      product_stock_receipts: {
        Row: ProductStockReceipt
        Insert: ProductStockReceiptInsert
        Update: never
      }
      zatca_sandbox_credentials: {
        Row: never
        Insert: never
        Update: never
      }
      zatca_sandbox_chain_state: {
        Row: never
        Insert: never
        Update: never
      }
      zatca_sandbox_submission_reservations: {
        Row: never
        Insert: never
        Update: never
      }
      purchases: {
        Row: Purchase
        Insert: PurchaseInsert
        Update: PurchaseUpdate
      }
      purchase_items: {
        Row: PurchaseItem
        Insert: PurchaseItemInsert
        Update: Partial<PurchaseItemInsert>
      }
      supplier_item_mappings: {
        Row: SupplierItemMapping
        Insert: SupplierItemMappingInsert
        Update: Partial<SupplierItemMappingInsert>
      }
    }
    Functions: {
      get_next_invoice_counter: {
        Args: { p_branch_id: string }
        Returns: number
      }
      get_next_zatca_counter: {
        Args: { p_branch_id: string; p_env?: string }
        Returns: number
      }
      reconcile_zatca_sandbox_onboarding: {
        Args: {
          p_credential_id: string
          p_tenant_id: string
          p_branch_id: string
          p_expected_operation: ZatcaSandboxOnboardingAction
          p_decision: ZatcaSandboxReconciliationDecision
          p_reconciled_by: string
          p_summary: string
          p_verified_result?: Record<string, unknown>
        }
        Returns: Record<string, unknown>
      }
      get_my_tenant_id: { Args: Record<never, never>; Returns: string }
      get_my_branch_id: { Args: Record<never, never>; Returns: string }
      get_my_role: { Args: Record<never, never>; Returns: UserRole }
      is_super_admin: { Args: Record<never, never>; Returns: boolean }
      normalize_branch_login_username: { Args: { p_username: string }; Returns: string }
      is_reserved_branch_login_username: { Args: { p_username: string }; Returns: boolean }
      is_valid_branch_login_username: { Args: { p_username: string }; Returns: boolean }
      can_manage_branch_login_username: { Args: { p_tenant_id: string }; Returns: boolean }
      get_tenant_branch_usage: {
        Args: { p_tenant_id: string }
        Returns: TenantBranchUsage[]
      }
      can_create_branch: {
        Args: { p_tenant_id: string }
        Returns: boolean
      }
      get_tenant_subscription_access: {
        Args: { p_tenant_id: string }
        Returns: TenantSubscriptionAccess[]
      }
      get_super_admin_clients_billing_summary: {
        Args: Record<never, never>
        Returns: SuperAdminClientBillingSummary[]
      }
      mark_owner_setup_complete: {
        Args: Record<never, never>
        Returns: OwnerSetupCompletionResult[]
      }
      complete_onboarding: {
        Args: {
          p_company_name:     string
          p_company_name_ar?: string
          p_vat_number?:      string
          p_cr_number?:       string
          p_city?:            string
          p_country?:         string
          p_phone?:           string
          p_website?:         string
          p_branch_name?:     string
          p_branch_name_ar?:  string
          p_vat_mode?:        string
          p_invoice_prefix?:  string
          p_building_number?: string
          p_street?:          string
          p_district?:        string
          p_postal_code?:     string
          p_plan_id?:         string
        }
        Returns: { tenant_id: string; branch_id: string }
      }
      create_branch_for_tenant: {
        Args: { p_payload: Record<string, unknown> }
        Returns: Record<string, unknown>
      }
      pos_checkout: {
        Args: { p_payload: Record<string, unknown> }
        Returns: Record<string, unknown>
      }
      update_branch_pos_settings: {
        Args: {
          p_branch_id: string
          p_payload: {
            allow_split_payments?: boolean
            show_pos_scroll_buttons?: boolean
            pos_mode?: BranchPosMode
          }
        }
        Returns: Record<string, unknown>
      }
      update_product_stock_settings: {
        Args: {
          p_payload: {
            product_id: string
            track_stock?: boolean
            opening_stock_quantity?: number | null
            adjustment_quantity?: number | null
            idempotency_key?: string | null
            reason?: 'opening_stock' | 'manual_adjustment' | 'tracking_enabled' | 'tracking_disabled'
          }
        }
        Returns: Record<string, unknown>
      }
      receive_product_stock: {
        Args: {
          p_payload: {
            product_id: string
            supplier_id?: string | null
            quantity?: number
            product_unit_id?: string | null
            package_quantity?: number
            expected_product_unit_version?: number
            unit_cost: number
            idempotency_key: string
            note?: string | null
            reference?: string | null
          }
        }
        Returns: Record<string, unknown>
      }
      suggest_product_sku: {
        Args: { p_payload: ProductSkuSuggestionPayload }
        Returns: ProductSkuSuggestionResult
      }
      create_product_secure: {
        Args: { p_payload: ProductSecurePayload }
        Returns: ProductSecureResult
      }
      update_product_secure: {
        Args: { p_payload: ProductSecureUpdatePayload }
        Returns: ProductSecureResult
      }
      mark_demo_tenant_secure: {
        Args: { p_tenant_id: string; p_is_demo?: boolean }
        Returns: Record<string, unknown>
      }
      set_branch_zatca_environment_secure: {
        Args: { p_branch_id: string; p_environment: ZatcaEnvironment }
        Returns: Record<string, unknown>
      }
      reserve_zatca_sandbox_submission: {
        Args: { p_tenant_id: string; p_branch_id: string; p_device_id: string; p_invoice_id: string }
        Returns: ZatcaSandboxReservationResult[]
      }
      store_zatca_sandbox_signed_payload: {
        Args: {
          p_reservation_id: string; p_tenant_id: string; p_branch_id: string; p_device_id: string
          p_invoice_id: string; p_invoice_hash: string; p_signed_xml: string
          p_submission_payload: Record<string, unknown>; p_signature_value: string; p_qr_code: string
        }
        Returns: undefined
      }
      mark_zatca_sandbox_dispatched: {
        Args: { p_reservation_id: string; p_tenant_id: string; p_branch_id: string; p_device_id: string; p_invoice_id: string }
        Returns: undefined
      }
      mark_zatca_sandbox_ambiguous: {
        Args: { p_reservation_id: string; p_tenant_id: string; p_branch_id: string; p_device_id: string; p_invoice_id: string; p_reason: string }
        Returns: undefined
      }
      reconcile_zatca_sandbox_submission: {
        Args: {
          p_reservation_id: string
          p_tenant_id: string
          p_branch_id: string
          p_environment: 'sandbox'
          p_device_id: string
          p_invoice_id: string
          p_counter: number
          p_action: 'mark_ambiguous' | 'mark_dispatched'
        }
        Returns: Record<string, unknown>
      }
      finalize_zatca_sandbox_submission: {
        Args: {
          p_reservation_id: string; p_tenant_id: string; p_branch_id: string; p_device_id: string
          p_invoice_id: string; p_outcome: 'accepted' | 'rejected'; p_http_status: number
          p_response_body: Record<string, unknown>
        }
        Returns: Record<string, unknown>
      }
      cancel_zatca_sandbox_before_dispatch: {
        Args: { p_reservation_id: string; p_tenant_id: string; p_branch_id: string; p_device_id: string; p_invoice_id: string; p_reason: string }
        Returns: undefined
      }
      update_branch_module_settings: {
        Args: {
          p_branch_id: string
          p_stock_enabled: boolean | null
        }
        Returns: Record<string, unknown>
      }
      get_register_sessions_filtered: {
        Args: {
          p_branch_id?: string | null
          p_limit?: number | null
          p_start_date?: string | null
          p_end_date?: string | null
        }
        Returns: Record<string, unknown>
      }
      get_supplier_purchase_totals: {
        Args: {
          p_branch_id: string
          p_start_date: string
          p_end_date: string
        }
        Returns: Record<string, unknown>
      }
      get_dashboard_summary: {
        Args: {
          p_branch_id?: string | null
          p_start_date?: string | null
          p_end_date?: string | null
        }
        Returns: Record<string, unknown>
      }
      get_branch_dashboard_recent_invoices: {
        Args: {
          p_branch_id: string
          p_limit?: number | null
        }
        Returns: Record<string, unknown>[]
      }
      create_full_credit_note: {
        Args: { p_payload: Record<string, unknown> }
        Returns: Record<string, unknown>
      }
      create_partial_credit_note: {
        Args: { p_payload: Record<string, unknown> }
        Returns: Record<string, unknown>
      }
      get_invoice_refundable_items: {
        Args: { p_invoice_id: string }
        Returns: RefundableInvoiceItem[]
      }
      get_invoice_refundable_items_v2: {
        Args: { p_invoice_id: string }
        Returns: RefundableInvoiceItem[]
      }
      get_branch_selling_product_units: {
        Args: { p_branch_id: string }
        Returns: ProductUnit[]
      }
      get_sales_report_summary_v2: {
        Args: {
          p_start_date: string
          p_end_date: string
          p_branch_id?: string | null
        }
        Returns: Record<string, unknown>
      }
      confirm_purchase_receiving: {
        Args: { p_purchase_id: string; p_confirm?: boolean }
        Returns: Record<string, unknown>
      }
      cancel_purchase_receiving: {
        Args: { p_purchase_id: string; p_reason: string; p_confirm?: boolean }
        Returns: Record<string, unknown>
      }
      delete_purchase_receiving: {
        Args: { p_purchase_id: string; p_confirm?: boolean }
        Returns: Record<string, unknown>
      }
      update_purchase_entry: {
        Args: { p_payload: Record<string, unknown> }
        Returns: Record<string, unknown>
      }
      suggest_supplier_item_mapping: {
        Args: { p_supplier_id: string; p_supplier_item_name: string; p_branch_id?: string | null }
        Returns: Record<string, unknown>
      }
      upsert_supplier_item_mapping: {
        Args: { p_payload: Record<string, unknown> }
        Returns: Record<string, unknown>
      }
      set_purchase_bill_attachment: {
        Args: { p_purchase_id: string; p_bill_path?: string | null; p_clear?: boolean }
        Returns: Record<string, unknown>
      }
      record_purchase_attachment_viewed: {
        Args: { p_purchase_id: string }
        Returns: Record<string, unknown>
      }
    }
    Enums: {
      user_role: UserRole
      invoice_type: InvoiceType
      invoice_status: InvoiceStatus
      zatca_status: ZatcaStatus
      zatca_finalization_status: ZatcaFinalizationStatus
      payment_method: PaymentMethod
      payment_status: PaymentStatus
      subscription_status: SubscriptionStatus
      sync_status: SyncStatus
      certificate_status: CertificateStatus
    }
  }
}

// ── Row types ──────────────────────────────────────────────────────────────

export interface SubscriptionPlan {
  id: string
  name: string
  name_ar: string | null
  description: string | null
  description_ar: string | null
  price_monthly: number
  price_yearly: number
  max_branches: number
  max_users: number
  max_products: number
  features: string[]
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Tenant {
  id: string
  name: string
  name_ar: string | null
  vat_number: string
  cr_number: string | null
  email: string | null
  phone: string | null
  business_type: BusinessType | null
  address: string | null
  address_ar: string | null
  building_number: string | null
  additional_number: string | null
  street: string | null
  street_ar: string | null
  district: string | null
  district_ar: string | null
  city: string | null
  city_ar: string | null
  country: string
  postal_code: string | null
  logo_url: string | null
  is_active: boolean
  is_demo: boolean
  suspended_at: string | null
  suspended_reason: string | null
  last_active_at: string | null
  max_branches: number
  created_at: string
  updated_at: string
}

export interface TenantSubscription {
  id: string
  tenant_id: string
  plan_id: string
  status: SubscriptionStatus
  starts_at: string
  ends_at: string | null
  trial_ends_at: string | null
  cancelled_at: string | null
  moyasar_subscription_id: string | null
  plan_interval: ManualSubscriptionPlanInterval
  price_per_branch: number | null
  paid_branch_count: number
  current_period_start: string | null
  current_period_end: string | null
  next_due_date: string | null
  grace_until_date: string | null
  manual_payment_status: ManualPaymentStatus
  subscription_lifecycle_status: SubscriptionLifecycleStatus
  last_payment_id: string | null
  last_payment_at: string | null
  suspended_at: string | null
  suspended_reason: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export interface TenantInsert {
  name: string
  name_ar?: string | null
  vat_number: string
  cr_number?: string | null
  email?: string | null
  phone?: string | null
  business_type?: BusinessType | null
  address?: string | null
  address_ar?: string | null
  building_number?: string | null
  additional_number?: string | null
  street?: string | null
  street_ar?: string | null
  district?: string | null
  district_ar?: string | null
  city?: string | null
  city_ar?: string | null
  country?: string
  postal_code?: string | null
  logo_url?: string | null
  is_active?: boolean
  suspended_at?: string | null
  suspended_reason?: string | null
  last_active_at?: string | null
  max_branches?: number
}

export interface TenantSubscriptionInsert {
  tenant_id: string
  plan_id: string
  status?: SubscriptionStatus
  starts_at?: string
  ends_at?: string | null
  trial_ends_at?: string | null
  cancelled_at?: string | null
  moyasar_subscription_id?: string | null
  plan_interval?: ManualSubscriptionPlanInterval
  price_per_branch?: number | null
  paid_branch_count?: number
  current_period_start?: string | null
  current_period_end?: string | null
  next_due_date?: string | null
  grace_until_date?: string | null
  manual_payment_status?: ManualPaymentStatus
  subscription_lifecycle_status?: SubscriptionLifecycleStatus
  last_payment_id?: string | null
  last_payment_at?: string | null
  suspended_at?: string | null
  suspended_reason?: string | null
  updated_by?: string | null
}

export interface ManualSubscriptionPayment {
  id: string
  tenant_id: string
  subscription_id: string | null
  amount: number
  currency: string
  plan_interval: ManualSubscriptionPlanInterval
  paid_branch_count: number
  price_per_branch: number | null
  payment_method: string | null
  payment_reference: string | null
  payment_received_at: string
  coverage_start_date: string
  coverage_end_date: string
  next_due_date: string
  grace_until_date: string
  status: ManualPaymentStatus
  money_back_until_date: string | null
  notes: string | null
  verified_by: string | null
  created_at: string
  updated_at: string
}

export interface TenantOnboardingStatus {
  id: string
  tenant_id: string
  onboarding_status: TenantOnboardingStatusValue
  owner_setup_status: OwnerSetupStatus
  branch_setup_status: BranchSetupStatus
  zatca_setup_status: ZatcaSetupStatus
  ready_for_billing: boolean
  owner_setup_link_sent_at: string | null
  owner_setup_completed_at: string | null
  first_branch_created_at: string | null
  first_invoice_created_at: string | null
  notes: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export interface TenantSupportNote {
  id: string
  tenant_id: string
  note: string
  note_type: TenantSupportNoteType
  created_by: string | null
  created_at: string
}

export interface TenantBranchUsage {
  tenant_id: string
  max_branches: number
  active_branch_count: number
  total_branch_count: number
  remaining_branches: number
  can_create_branch: boolean
  reason: string
}

export interface TenantSubscriptionAccess {
  tenant_id: string
  lifecycle_status: string
  manual_payment_status: string
  max_branches: number
  paid_branch_count: number
  current_period_end: string | null
  next_due_date: string | null
  grace_until_date: string | null
  days_until_due: number | null
  days_overdue: number | null
  can_use_pos: boolean
  can_create_branch: boolean
  reason: string
}

export interface SuperAdminClientBillingSummary {
  tenant_id: string
  business_name: string
  business_name_ar: string | null
  vat_number: string
  city: string | null
  contact_name: string | null
  contact_email: string | null
  phone: string | null
  business_type: BusinessType | null
  tenant_is_active: boolean
  suspended_at: string | null
  suspended_reason: string | null
  created_at: string
  subscription_id: string | null
  subscription_plan_name: string | null
  lifecycle_status: string
  manual_payment_status: string
  current_period_start: string | null
  current_period_end: string | null
  next_due_date: string | null
  grace_until_date: string | null
  days_until_due: number | null
  days_overdue: number | null
  can_use_pos: boolean
  access_reason: string
  paid_branch_count: number
  max_branches: number
  active_branch_count: number
  total_branch_count: number
  user_count: number
  remaining_branches: number
  can_create_branch: boolean
  branch_usage_reason: string
  last_payment_at: string | null
  last_payment_amount: number | null
  last_payment_currency: string | null
  last_payment_method: string | null
  onboarding_status: TenantOnboardingStatusValue | null
  owner_setup_status: OwnerSetupStatus | null
  branch_setup_status: BranchSetupStatus | null
  zatca_setup_status: ZatcaSetupStatus | null
  ready_for_billing: boolean
  billing_signal: BillingSignal
}

export interface OwnerSetupCompletionResult {
  tenant_id: string
  onboarding_status: TenantOnboardingStatusValue
  owner_setup_status: OwnerSetupStatus
  owner_setup_completed_at: string | null
  already_completed: boolean
}

export interface ManualSubscriptionPaymentInsert {
  tenant_id: string
  subscription_id?: string | null
  amount: number
  currency?: string
  plan_interval: ManualSubscriptionPlanInterval
  paid_branch_count: number
  price_per_branch?: number | null
  payment_method?: string | null
  payment_reference?: string | null
  payment_received_at?: string
  coverage_start_date: string
  coverage_end_date: string
  next_due_date: string
  grace_until_date: string
  status?: ManualPaymentStatus
  money_back_until_date?: string | null
  notes?: string | null
  verified_by?: string | null
}

export interface TenantOnboardingStatusInsert {
  tenant_id: string
  onboarding_status?: TenantOnboardingStatusValue
  owner_setup_status?: OwnerSetupStatus
  branch_setup_status?: BranchSetupStatus
  zatca_setup_status?: ZatcaSetupStatus
  ready_for_billing?: boolean
  owner_setup_link_sent_at?: string | null
  owner_setup_completed_at?: string | null
  first_branch_created_at?: string | null
  first_invoice_created_at?: string | null
  notes?: string | null
  updated_by?: string | null
}

export interface TenantSupportNoteInsert {
  tenant_id: string
  note: string
  note_type?: TenantSupportNoteType
  created_by?: string | null
}

export interface Branch {
  id: string
  tenant_id: string
  name: string
  name_ar: string | null
  branch_code: string | null
  phone: string | null
  email: string | null
  address: string | null
  address_ar: string | null
  building_number: string | null
  additional_number: string | null
  street: string | null
  street_ar: string | null
  district: string | null
  district_ar: string | null
  city: string | null
  city_ar: string | null
  country: string
  postal_code: string | null
  is_main_branch: boolean
  is_active: boolean
  invoice_counter: number
  // Added by update-branches.sql
  business_name: string | null
  business_name_ar: string | null
  vat_number: string | null
  cr_number: string | null
  logo_url: string | null
  website: string | null
  vat_mode: 'exclusive' | 'inclusive'
  invoice_prefix: string | null
  receipt_footer: string | null
  show_logo: boolean
  invoice_language: 'en' | 'ar' | 'both'
  zatca_phase: 1 | 2
  branch_email: string | null   // login email for the branch POS account
  // Added by update-invoice-settings.sql
  display_name: string | null
  show_website: boolean
  show_email: boolean
  show_footer: boolean
  show_cash_change: boolean
  print_mode: 'thermal' | 'pdf' | 'both'
  invoice_display_heading: string | null
  invoice_display_subheading: string | null
  show_company_display_name: boolean
  show_branch_display_name: boolean
  thermal_density: 'compact' | 'standard' | 'detailed'
  a4_template_id: string
  document_template_version: number
  logo_asset_version: number
  presentation_settings: InvoicePresentationSettings | null
  compliance_identity_mode: 'legacy' | 'protected'
  allow_split_payments: boolean
  show_pos_scroll_buttons: boolean
  pos_mode: BranchPosMode
  stock_enabled: boolean | null
  zatca_environment: ZatcaEnvironment
  created_at: string
  updated_at: string
}

export interface ZatcaSandboxCredential {
  id: string
  tenant_id: string
  branch_id: string
  environment: 'sandbox'
  device_id: string
  encrypted_private_key: string
  encrypted_compliance_csid: string | null
  encrypted_compliance_secret: string | null
  encrypted_production_csid: string | null
  encrypted_production_secret: string | null
  certificate: string | null
  status: 'pending' | 'compliance' | 'active' | 'revoked' | 'expired' | 'failed'
  onboarding_status: ZatcaSandboxOnboardingStatus
  last_successful_onboarding_status: Exclude<
    ZatcaSandboxOnboardingStatus,
    'compliance_checks_pending' | 'failed' | 'expired'
  >
  failed_step: ZatcaSandboxOnboardingAction | null
  onboarding_operation: ZatcaSandboxOnboardingAction | null
  operation_started_at: string | null
  reconciliation_status: ZatcaSandboxReconciliationStatus
  reconciliation_decision: ZatcaSandboxReconciliationDecision | null
  reconciled_at: string | null
  reconciled_by: string | null
  reconciliation_summary: Record<string, unknown> | null
  functionality_map: '0100' | '1000' | '1100' | null
  egs_serial_number: string | null
  csr_common_name: string | null
  csr_organization_name: string | null
  csr_organizational_unit_name: string | null
  csr_location: string | null
  csr_industry: string | null
  csr_pem: string | null
  public_key_pem: string | null
  compliance_request_id: string | null
  compliance_sample_results: Record<string, unknown>[]
  last_safe_response: Record<string, unknown>
  last_error: string | null
  certificate_valid_from: string | null
  expires_at: string | null
  csr_generated_at: string | null
  compliance_csid_received_at: string | null
  compliance_checked_at: string | null
  sandbox_production_csid_received_at: string | null
  activated_at: string | null
  created_at: string
  updated_at: string
}

export type ZatcaSandboxOnboardingStatus =
  | 'not_started'
  | 'csr_ready'
  | 'compliance_csid_ready'
  | 'compliance_checks_pending'
  | 'compliance_passed'
  | 'sandbox_production_csid_ready'
  | 'active'
  | 'failed'
  | 'expired'

export type ZatcaSandboxOnboardingAction =
  | 'request_compliance_csid'
  | 'submit_compliance_documents'
  | 'request_sandbox_production_csid'
  | 'activate'

export type ZatcaSandboxReconciliationStatus = 'not_required' | 'required' | 'resolved'

export type ZatcaSandboxReconciliationDecision =
  | 'mark_verified_success'
  | 'mark_verified_failure'
  | 'revoke_and_restart_device'

export interface ZatcaSandboxChainState {
  tenant_id: string
  branch_id: string
  environment: 'sandbox'
  device_id: string
  last_counter: number
  previous_hash: string
  created_at: string
  updated_at: string
}

export type ZatcaSandboxReservationState =
  | 'reserved' | 'dispatched' | 'accepted' | 'rejected' | 'ambiguous' | 'cancelled_before_dispatch'

export interface ZatcaSandboxSubmissionReservation {
  id: string
  tenant_id: string
  branch_id: string
  environment: 'sandbox'
  device_id: string
  invoice_id: string
  counter: number
  previous_hash: string
  invoice_uuid: string
  invoice_hash: string | null
  signed_xml: string | null
  submission_payload: Record<string, unknown> | null
  signature_value: string | null
  qr_code: string | null
  state: ZatcaSandboxReservationState
  endpoint_kind: 'reporting' | 'clearance'
  response_status: number | null
  response_body: Record<string, unknown> | null
  failure_reason: string | null
  reserved_at: string
  signed_at: string | null
  dispatched_at: string | null
  finalized_at: string | null
  updated_at: string
}

export interface ZatcaSandboxReservationResult {
  reservation_id: string
  invoice_counter: number
  previous_invoice_hash: string
  invoice_uuid: string
  reservation_state: ZatcaSandboxReservationState
  invoice_hash: string | null
  signed_xml: string | null
  submission_payload: Record<string, unknown> | null
  signature_value: string | null
  qr_code: string | null
}

export interface UserProfile {
  id: string
  tenant_id: string | null
  branch_id: string | null
  role: UserRole
  email: string | null
  full_name: string | null
  full_name_ar: string | null
  phone: string | null
  avatar_url: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface BranchLoginUsername {
  id: string
  tenant_id: string
  branch_id: string
  user_id: string
  username: string
  normalized_username: string
  internal_auth_email: string
  is_active: boolean
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export interface ZatcaCertificate {
  id: string
  tenant_id: string
  branch_id: string
  csr: string | null
  certificate: string | null
  private_key_encrypted: string | null
  otp: string | null
  compliance_request_id: string | null
  compliance_csid: string | null
  production_request_id: string | null
  production_csid: string | null
  compliance_secret: string | null
  production_secret: string | null
  public_key_pem: string | null
  activated_at: string | null
  status: CertificateStatus
  environment: string
  serial_number: string | null
  valid_from: string | null
  valid_to: string | null
  last_invoice_hash: string | null
  invoice_counter: number
  created_at: string
  updated_at: string
}

export interface Employee {
  id: string
  tenant_id: string
  branch_id: string | null
  full_name: string
  full_name_ar: string | null
  role: string | null
  phone: string | null
  email: string | null
  hire_date: string | null
  salary: number | null
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Category {
  id: string
  tenant_id: string
  branch_id: string
  parent_id: string | null
  name: string
  name_ar: string | null
  description: string | null
  color: string | null
  icon: string | null
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export type VatTreatment = 'inherit' | 'exclusive' | 'inclusive' | 'exempt'

export interface Product {
  id: string
  tenant_id: string
  branch_id: string
  category_id: string | null
  name: string
  name_ar: string | null
  description: string | null
  description_ar: string | null
  sku: string | null
  barcode: string | null
  unit: string
  unit_ar: string | null
  price: number
  cost: number
  tax_rate: number
  tax_category: string
  is_taxable: boolean
  stock_quantity: number
  min_stock_alert: number
  image_url: string | null
  is_active: boolean
  is_service: boolean
  track_stock: boolean
  // Added by update-products.sql
  vat_treatment: VatTreatment
  is_available: boolean
  sort_order: number
  notes: string | null
  created_at: string
  updated_at: string
}

export type CustomerType = 'individual' | 'business'

export interface Customer {
  id: string
  tenant_id: string
  name: string
  name_ar: string | null
  customer_type: CustomerType
  // Added by update-customers.sql (legacy legal entity name)
  company_name: string | null
  // Added by add-customer-type.sql (B2B legal entity names)
  business_name: string | null
  business_name_ar: string | null
  vat_number: string | null
  cr_number: string | null
  email: string | null
  phone: string | null
  address: string | null
  address_ar: string | null
  building_number: string | null
  additional_number: string | null
  district: string | null
  city: string | null
  country: string
  postal_code: string | null
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Employee {
  id: string
  tenant_id: string
  branch_id: string | null
  user_id: string | null
  full_name: string
  full_name_ar: string | null
  national_id: string | null
  iqama_number: string | null
  email: string | null
  phone: string | null
  position: string | null
  position_ar: string | null
  department: string | null
  department_ar: string | null
  salary: number | null
  hire_date: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Invoice {
  is_demo?: boolean
  id: string
  tenant_id: string
  branch_id: string
  customer_id: string | null
  created_by: string | null
  invoice_number: string
  document_language: 'en' | 'ar' | 'both' | null
  identity_snapshot: InvoiceIdentitySnapshot | null
  invoice_reference: string | null
  original_invoice_id: string | null
  credit_reason: string | null
  credit_note_idempotency_key: string | null
  zatca_uuid: string
  zatca_invoice_type: InvoiceType
  zatca_type_code: string
  zatca_counter_number: number | null
  zatca_prev_invoice_hash: string | null
  zatca_xml: string | null
  zatca_xml_hash: string | null
  zatca_signature: string | null
  zatca_qr_code: string | null
  zatca_finalization_status?: ZatcaFinalizationStatus
  zatca_finalized_at?: string | null
  zatca_finalization_error?: Record<string, unknown> | null
  zatca_finalization_version: number | null
  zatca_artifact_provenance?: string | null
  zatca_document_kind?: 'simplified' | 'standard' | null
  zatca_lifecycle_state?: string | null
  zatca_artifact_stage?: string | null
  zatca_simplified_qr?: string | null
  zatca_cleared_qr?: string | null
  zatca_status: ZatcaStatus
  zatca_submission_id: string | null
  zatca_submitted_at: string | null
  zatca_clearance_status: string | null
  zatca_clearance_response: Record<string, unknown> | null
  zatca_reporting_response: Record<string, unknown> | null
  zatca_warnings: Record<string, unknown> | null
  subtotal: number
  discount_amount: number
  taxable_amount: number
  tax_amount: number
  total_amount: number
  currency_code: string
  invoice_date: string
  supply_date: string | null
  due_date: string | null
  status: InvoiceStatus
  payment_status: PaymentStatus
  payment_method: PaymentMethod | null
  session_id: string | null
  checkout_idempotency_key: string | null
  notes: string | null
  notes_ar: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
  created_at: string
  updated_at: string
}

export interface InvoiceIdentitySnapshotV1 {
  version: 1
  legacy: false
  compliance: {
    registeredSellerName: string
    registeredSellerNameAr: string | null
    vatNumber: string
    registrationScheme: string
    registrationIdentifier: string
    address: { buildingNumber: string; street: string; district: string; city: string; postalCode: string; country: string }
  }
  presentation: {
    displayHeading: string | null; displaySubheading: string | null
    showCompanyDisplayName: boolean; showBranchDisplayName: boolean
    companyDisplayName: string | null; branchDisplayName: string | null; branchDisplayNameAr: string | null
    logoUrl: string | null; logoAssetVersion: number; showLogo: boolean; phone: string | null; email: string | null; website: string | null
    showEmail: boolean; showWebsite: boolean; footer: string | null; showFooter: boolean; showCashChange: boolean
  }
  document: { language: 'en' | 'ar' | 'both'; thermalDensity: string; printMode: 'thermal' | 'pdf' | 'both'; a4TemplateId: string; templateVersion: number }
}

export type LogoAssetSize = 'small' | 'medium' | 'large'
export type ThermalWidth = '58mm' | '80mm'
export type ThermalDensity = 'compact' | 'standard' | 'detailed'
export type QrSize = 'small' | 'standard' | 'large'
export type QrAlignment = 'left' | 'center' | 'right'
export type A4TemplateId =
  | 'classic'
  | 'modern_split'
  | 'minimal_professional'
  | 'executive_green'
  | 'clean_ledger'
  | 'contemporary_border'
export type A4HeaderStyle = 'standard' | 'compact' | 'branded'
export type A4HeaderFit = 'contain' | 'cover'
export type A4ArtworkScope = 'selected' | 'all'

export interface InvoicePresentationSettings {
  schema_version: 1
  identity: { display_heading: string | null; display_subheading: string | null; custom_display_name: string | null; show_company_name: boolean; show_branch_name: boolean; heading_mode?: 'branch' | 'custom' }
  contact: { phone: string | null; email: string | null; website: string | null; address_override?: string | null; show_phone: boolean; show_email: boolean; show_website: boolean; show_address: boolean }
  footer: { thank_you_message: string | null; footer_note: string | null; refund_note: string | null; bold?: boolean; show_thank_you: boolean; show_footer: boolean; show_refund_note: boolean }
  logo: { visible: boolean; asset_path: string | null; asset_version: number; size: LogoAssetSize }
  thermal: { width: ThermalWidth; density: ThermalDensity; qr_size: QrSize; qr_alignment: QrAlignment; wrap_item_names: boolean; show_cash_change: boolean }
  a4: {
    template_id: A4TemplateId
    template_version: 1
    header_style: A4HeaderStyle
    accent_color: string
    heading_color: string
    body_color: string
    auto_foreground: boolean
    header_asset_path: string | null
    header_asset_version: number
    header_asset_enabled: boolean
    header_asset_fit: A4HeaderFit
    header_asset_height: number
    header_asset_spacing: number
    header_crop_top: number
    header_crop_height: number
    footer_asset_path: string | null
    footer_asset_version: number
    footer_asset_enabled: boolean
    footer_asset_fit: A4HeaderFit
    footer_asset_height: number
    footer_asset_spacing: number
    footer_crop_top: number
    footer_crop_height: number
    artwork_scope: A4ArtworkScope
    artwork_template_id: A4TemplateId
  }
  after_sale_action?: 'receipt' | 'a4' | 'both'
}

export interface InvoiceIdentitySnapshotV2 {
  version: 2
  legacy: false
  compliance: InvoiceIdentitySnapshotV1['compliance']
  presentationSettings: InvoicePresentationSettings
  document: { language: 'en' | 'ar' | 'both'; printMode: 'thermal' | 'pdf' | 'both' }
}

export type InvoiceIdentitySnapshot = InvoiceIdentitySnapshotV1 | InvoiceIdentitySnapshotV2

export interface InvoiceItem {
  id: string
  invoice_id: string
  tenant_id: string
  product_id: string | null
  original_invoice_item_id: string | null
  name: string
  name_ar: string | null
  description: string | null
  sku: string | null
  unit: string | null
  quantity: number
  unit_price: number
  discount_percent: number
  discount_amount: number
  subtotal: number
  tax_rate: number
  tax_category: string
  tax_amount: number
  total: number
  sort_order: number
  created_at: string
  product_unit_id?: string | null
  product_unit_version?: number | null
  selling_unit_name?: string | null
  selling_unit_name_ar?: string | null
  selling_unit_code?: string | null
  package_quantity?: number | null
  package_quantity_scale?: number | null
  conversion_to_base?: number | null
  base_quantity?: number | null
  base_unit_name?: string | null
  base_unit_name_ar?: string | null
  base_unit_code?: string | null
  base_quantity_scale?: number | null
  package_pricing_method?: 'calculated' | 'custom' | null
  base_unit_price?: number | null
  package_unit_price?: number | null
  stock_tracked_at_sale?: boolean | null
  service_item_at_sale?: boolean | null
}

export interface RefundableInvoiceItem {
  original_invoice_item_id: string
  name: string
  name_ar: string | null
  sku: string | null
  unit: string | null
  product_id: string | null
  original_quantity: number
  credited_quantity: number
  remaining_quantity: number
  unit_price: number
  subtotal: number
  discount_amount: number
  tax_rate: number
  tax_amount: number
  total: number
  credited_subtotal: number
  credited_discount_amount: number
  credited_tax_amount: number
  credited_total: number
  remaining_subtotal: number
  remaining_discount_amount: number
  remaining_tax_amount: number
  remaining_total: number
  track_stock: boolean
  is_service: boolean
  product_unit_id?: string | null
  product_unit_version?: number | null
  selling_unit_name?: string | null
  selling_unit_name_ar?: string | null
  selling_unit_code?: string | null
  package_quantity?: number | null
  package_quantity_scale?: number | null
  conversion_to_base?: number | null
  base_quantity?: number | null
  base_unit_name?: string | null
  base_unit_name_ar?: string | null
  base_unit_code?: string | null
  base_quantity_scale?: number | null
  package_unit_price?: number | null
  base_unit_price?: number | null
  stock_tracked_at_sale?: boolean | null
  service_item_at_sale?: boolean | null
}

export interface ProductUnit {
  id: string
  product_id: string
  name: string
  name_ar: string | null
  unit_code: string
  conversion_to_base: number
  quantity_scale: number
  pricing_method: 'calculated' | 'custom'
  custom_selling_price?: number | null
  resolved_selling_price: number
  selling_enabled?: boolean
  receiving_enabled?: boolean
  is_base: boolean
  is_active?: boolean
  sort_order?: number
  version: number
}

export interface Payment {
  id: string
  tenant_id: string
  invoice_id: string
  recorded_by: string | null
  amount: number
  amount_received: number | null
  change_amount: number | null
  method: PaymentMethod
  reference: string | null
  notes: string | null
  paid_at: string
  created_at: string
  updated_at: string
}

export interface PaymentRefund {
  id: string
  tenant_id: string
  branch_id: string
  original_invoice_id: string
  credit_note_invoice_id: string
  payment_id: string | null
  method: PaymentMethod
  amount: number
  reason: string
  status: 'pending' | 'completed' | 'failed'
  created_by: string | null
  created_at: string
}

export interface SyncQueueItem {
  id: string
  tenant_id: string
  branch_id: string
  invoice_id: string | null
  action: string
  payload: Record<string, unknown> | null
  status: SyncStatus
  attempts: number
  max_attempts: number
  last_attempt_at: string | null
  last_error: string | null
  processed_at: string | null
  created_at: string
  updated_at: string
}

// ── Explicit Insert/Update helpers ─────────────────────────────────────────
// Using string/number instead of narrow union literals avoids supabase-js
// resolving overload parameter types to `never` when strict checks run.

export interface BranchInsert {
  tenant_id: string
  name: string
  name_ar?: string | null
  branch_code?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  address_ar?: string | null
  building_number?: string | null
  additional_number?: string | null
  street?: string | null
  street_ar?: string | null
  district?: string | null
  district_ar?: string | null
  city?: string | null
  city_ar?: string | null
  country?: string | null
  postal_code?: string | null
  is_main_branch?: boolean
  is_active?: boolean
  business_name?: string | null
  business_name_ar?: string | null
  vat_number?: string | null
  cr_number?: string | null
  logo_url?: string | null
  website?: string | null
  vat_mode?: string | null
  invoice_prefix?: string | null
  receipt_footer?: string | null
  show_logo?: boolean
  invoice_language?: string | null
  zatca_phase?: number | null
  display_name?: string | null
  show_website?: boolean
  show_email?: boolean
  show_footer?: boolean
  show_cash_change?: boolean
  print_mode?: string | null
  invoice_display_heading?: string | null
  invoice_display_subheading?: string | null
  show_company_display_name?: boolean
  show_branch_display_name?: boolean
  thermal_density?: string | null
  a4_template_id?: string | null
  document_template_version?: number
  logo_asset_version?: number
  presentation_settings?: InvoicePresentationSettings | null
  compliance_identity_mode?: string | null
  allow_split_payments?: boolean
  show_pos_scroll_buttons?: boolean
  pos_mode?: string | null
  stock_enabled?: boolean | null
}

export type BranchUpdate = Partial<BranchInsert>

export type UserProfileUpdate = Partial<Omit<UserProfile, 'id' | 'created_at' | 'updated_at'>>

export interface BranchLoginUsernameInsert {
  tenant_id: string
  branch_id: string
  user_id: string
  username: string
  normalized_username: string
  internal_auth_email: string
  is_active?: boolean
  created_by?: string | null
  updated_by?: string | null
}

export type BranchLoginUsernameUpdate = Partial<Omit<BranchLoginUsername, 'id' | 'created_at' | 'updated_at'>>

export interface CategoryInsert {
  tenant_id: string
  branch_id?: string | null
  parent_id?: string | null
  name: string
  name_ar?: string | null
  description?: string | null
  color?: string | null
  icon?: string | null
  is_active?: boolean
  sort_order?: number
}

export type CategoryUpdate = Partial<Omit<CategoryInsert, 'tenant_id'>>

export interface ProductInsert {
  tenant_id: string
  branch_id?: string | null
  category_id?: string | null
  name: string
  name_ar?: string | null
  description?: string | null
  description_ar?: string | null
  sku?: string | null
  barcode?: string | null
  unit?: string
  unit_ar?: string | null
  price?: number
  cost?: number
  tax_rate?: number
  tax_category?: string
  is_taxable?: boolean
  stock_quantity?: number
  min_stock_alert?: number
  image_url?: string | null
  is_active?: boolean
  is_service?: boolean
  track_stock?: boolean
  vat_treatment?: string
  is_available?: boolean
  sort_order?: number
  notes?: string | null
}

export type ProductUpdate = Partial<ProductInsert>

export interface ProductSkuSuggestionPayload {
  name: string
  branch_id?: string | null
}

export interface ProductSkuSuggestionResult {
  ok: boolean
  sku: string
  prefix: string
  tenant_id: string
  branch_id: string
}

export interface ProductSecurePayload {
  branch_id?: string | null
  name: string
  name_ar?: string | null
  category_id?: string | null
  description?: string | null
  price: number
  vat_treatment?: VatTreatment
  image_url?: string | null
  is_available?: boolean
  sort_order?: number
  sku?: string | null
  notes?: string | null
  is_service?: boolean
}

export type ProductSecureUpdatePayload = Omit<ProductSecurePayload, 'branch_id'> & {
  product_id: string
}

export interface ProductSecureResult {
  ok: boolean
  product_id: string
  sku: string
  tenant_id: string
  branch_id: string
}

export interface CustomerInsert {
  tenant_id: string
  name: string
  name_ar?: string | null
  customer_type?: string
  company_name?: string | null
  business_name?: string | null
  business_name_ar?: string | null
  vat_number?: string | null
  cr_number?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  address_ar?: string | null
  building_number?: string | null
  additional_number?: string | null
  district?: string | null
  city?: string | null
  country?: string
  postal_code?: string | null
  notes?: string | null
  is_active?: boolean
}

export type CustomerUpdate = Partial<Omit<CustomerInsert, 'tenant_id'>>

// ── Expense types (added by update-expenses.sql) ───────────────────────────

export interface ExpenseCategory {
  id: string
  tenant_id: string | null    // NULL = system/global category
  name: string
  name_ar: string | null
  color: string | null
  icon: string | null
  is_system: boolean
  sort_order: number
  created_at: string
}

export interface Expense {
  id: string
  tenant_id: string
  branch_id: string
  category_id: string | null
  added_by: string | null
  expense_date: string
  description: string
  vendor_name: string | null
  amount: number
  vat_treatment: VatExpenseTreatment
  vat_claim_status: ExpenseVatClaimStatus | null
  expense_before_vat: number | null
  vat_amount: number
  total_paid: number
  payment_method: ExpensePaymentMethod
  session_id: string | null
  tax_invoice_number: string | null
  supplier_vat_number: string | null
  supplier_id: string | null
  supplier_cr_number: string | null
  supplier_contact: string | null
  invoice_time: string | null
  receipt_url: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface FixedExpense {
  id: string
  tenant_id: string
  branch_id: string
  category_id: string | null
  name: string
  monthly_amount: number
  payment_method: ExpensePaymentMethod
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ExpenseCategoryInsert {
  tenant_id?: string | null
  name: string
  name_ar?: string | null
  color?: string | null
  icon?: string | null
  is_system?: boolean
  sort_order?: number
}
export type ExpenseCategoryUpdate = Partial<ExpenseCategoryInsert>

export interface ExpenseInsert {
  tenant_id: string
  branch_id: string
  category_id?: string | null
  added_by?: string | null
  expense_date?: string
  description: string
  vendor_name?: string | null
  amount: number
  vat_treatment?: VatExpenseTreatment
  vat_claim_status?: ExpenseVatClaimStatus | null
  expense_before_vat?: number | null
  vat_amount?: number
  total_paid?: number
  payment_method?: ExpensePaymentMethod
  session_id?: string | null
  tax_invoice_number?: string | null
  supplier_vat_number?: string | null
  supplier_id?: string | null
  supplier_cr_number?: string | null
  supplier_contact?: string | null
  invoice_time?: string | null
  receipt_url?: string | null
  notes?: string | null
}
export type ExpenseUpdate = Partial<Omit<ExpenseInsert, 'tenant_id' | 'branch_id'>>

export interface FixedExpenseInsert {
  tenant_id: string
  branch_id: string
  category_id?: string | null
  name: string
  monthly_amount: number
  payment_method?: string
  is_active?: boolean
}
export type FixedExpenseUpdate = Partial<Omit<FixedExpenseInsert, 'tenant_id' | 'branch_id'>>

// ── Inventory & Supplier types (added by update-inventory.sql) ─────────────

export type SupplierPaymentTerms = 'cash' | 'credit_30' | 'credit_60'
export type InventoryUnitType = 'pieces' | 'kg' | 'grams' | 'liters' | 'ml' | 'boxes' | 'bags' | 'other'
export type PurchasePaymentMethod = 'cash' | 'card' | 'bank_transfer'
export type PurchaseMode = 'simple_bill' | 'detailed_receiving'
export type PurchaseStatus = 'draft' | 'posted' | 'cancelled'
export type PurchaseReceivingStatus = 'not_applicable' | 'draft' | 'pending_confirmation' | 'confirmed' | 'cancelled' | 'reversed' | 'confirmed_legacy'
export type PurchaseTaxInputMode = 'none' | 'included' | 'excluded' | 'manual'
export type PurchasePaymentStatus = 'paid' | 'unpaid' | 'partial'
export type PurchaseItemLineType = 'stock' | 'non_stock' | 'unmatched' | 'ignored'
export type PurchaseItemReceivingStatus = 'pending' | 'confirmed' | 'skipped' | 'cancelled' | 'reversed'
export type PurchaseItemMatchSource = 'manual' | 'ai' | 'mapping' | 'none'

export interface Supplier {
  id: string
  tenant_id: string
  branch_id: string
  name: string
  name_ar: string | null
  vat_number: string | null
  cr_number: string | null
  contact_person: string | null
  phone: string | null
  email: string | null
  city: string | null
  address: string | null
  payment_terms: SupplierPaymentTerms
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface InventoryItem {
  id: string
  tenant_id: string
  branch_id: string
  category_id: string | null
  supplier_id: string | null
  name: string
  name_ar: string | null
  unit_type: InventoryUnitType
  current_quantity: number
  minimum_quantity: number
  unit_cost: number
  notes: string | null
  created_at: string
  updated_at: string
}

export interface ProductStockReceipt {
  id: string
  tenant_id: string
  branch_id: string
  product_id: string
  supplier_id: string | null
  quantity: number
  unit_cost: number
  total_cost: number
  idempotency_key: string
  note: string | null
  reference: string | null
  created_by: string
  created_at: string
  product_unit_id?: string | null
  product_unit_version?: number | null
  package_quantity?: number | null
  conversion_to_base?: number | null
  base_quantity?: number | null
  package_unit_name?: string | null
  base_unit_name?: string | null
  package_unit_code?: string | null
  base_unit_code?: string | null
  package_unit_cost?: number | null
  base_unit_cost?: number | null
  request_fingerprint?: string | null
}

export type ProductStockReceiptInsert = Omit<ProductStockReceipt, 'id' | 'created_at'>

export interface Purchase {
  id: string
  tenant_id: string
  branch_id: string
  supplier_id: string | null
  added_by: string | null
  purchase_date: string
  purchase_mode: PurchaseMode
  status: PurchaseStatus
  receiving_status: PurchaseReceivingStatus
  received_at: string | null
  received_by: string | null
  cancelled_at: string | null
  cancelled_by: string | null
  cancellation_reason: string | null
  reversed_at: string | null
  reversed_by: string | null
  reversal_reason: string | null
  bill_number: string | null
  tax_input_mode: PurchaseTaxInputMode
  payment_status: PurchasePaymentStatus
  subtotal: number
  vat_amount: number
  total_amount: number
  payment_method: PurchasePaymentMethod
  bill_url: string | null
  bill_path: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface PurchaseItem {
  id: string
  purchase_id: string
  inventory_item_id: string | null
  name: string
  supplier_item_name: string | null
  line_type: PurchaseItemLineType
  receiving_status: PurchaseItemReceivingStatus
  received_quantity: number
  tax_rate: number | null
  vat_amount: number
  discount_amount: number
  match_confidence: number | null
  match_source: PurchaseItemMatchSource
  ignored_at: string | null
  confirmed_at: string | null
  quantity: number
  unit_cost: number
  total: number
  created_at: string
}

export type SupplierItemMappingSource = 'manual' | 'ai' | 'imported'
export type SupplierItemMappingStatus = 'ai_suggested' | 'manual_confirmed' | 'rejected'

export interface SupplierItemMapping {
  id: string
  tenant_id: string
  branch_id: string | null
  supplier_id: string
  supplier_item_name: string
  normalized_supplier_item_name: string
  normalized_name: string
  matched_inventory_item_id: string | null
  matched_product_id: string | null
  confidence: number | null
  match_confidence: number | null
  match_source: SupplierItemMappingSource
  confirmation_status: SupplierItemMappingStatus
  is_active: boolean
  confirmed_by: string | null
  confirmed_at: string | null
  last_used_at: string | null
  created_at: string
  updated_at: string
}

export interface SupplierInsert {
  tenant_id: string
  branch_id?: string | null
  name: string
  name_ar?: string | null
  vat_number?: string | null
  cr_number?: string | null
  contact_person?: string | null
  phone?: string | null
  email?: string | null
  city?: string | null
  address?: string | null
  payment_terms?: string
  notes?: string | null
  is_active?: boolean
}
export type SupplierUpdate = Partial<Omit<SupplierInsert, 'tenant_id'>>

export interface InventoryItemInsert {
  tenant_id: string
  branch_id: string
  category_id?: string | null
  supplier_id?: string | null
  name: string
  name_ar?: string | null
  unit_type?: string
  current_quantity?: number
  minimum_quantity?: number
  unit_cost?: number
  notes?: string | null
}
export type InventoryItemUpdate = Partial<Omit<InventoryItemInsert, 'tenant_id' | 'branch_id'>>

export interface PurchaseInsert {
  tenant_id: string
  branch_id: string
  supplier_id?: string | null
  added_by?: string | null
  purchase_date?: string
  purchase_mode?: PurchaseMode
  status?: PurchaseStatus
  receiving_status?: PurchaseReceivingStatus
  received_at?: string | null
  received_by?: string | null
  cancelled_at?: string | null
  cancelled_by?: string | null
  cancellation_reason?: string | null
  reversed_at?: string | null
  reversed_by?: string | null
  reversal_reason?: string | null
  bill_number?: string | null
  tax_input_mode?: PurchaseTaxInputMode
  payment_status?: PurchasePaymentStatus
  subtotal?: number
  vat_amount?: number
  total_amount?: number
  payment_method?: string
  bill_url?: string | null
  bill_path?: string | null
  notes?: string | null
}
export type PurchaseUpdate = Partial<Omit<PurchaseInsert, 'tenant_id' | 'branch_id'>>

export interface PurchaseItemInsert {
  purchase_id: string
  inventory_item_id?: string | null
  name: string
  supplier_item_name?: string | null
  line_type?: PurchaseItemLineType
  receiving_status?: PurchaseItemReceivingStatus
  received_quantity?: number
  tax_rate?: number | null
  vat_amount?: number
  discount_amount?: number
  match_confidence?: number | null
  match_source?: PurchaseItemMatchSource
  ignored_at?: string | null
  confirmed_at?: string | null
  quantity: number
  unit_cost: number
  total: number
}

export interface SupplierItemMappingInsert {
  tenant_id: string
  branch_id?: string | null
  supplier_id: string
  supplier_item_name: string
  normalized_supplier_item_name: string
  normalized_name?: string
  matched_inventory_item_id?: string | null
  matched_product_id?: string | null
  confidence?: number | null
  match_confidence?: number | null
  match_source?: SupplierItemMappingSource
  confirmation_status?: SupplierItemMappingStatus
  is_active?: boolean
  confirmed_by?: string | null
  confirmed_at?: string | null
  last_used_at?: string | null
}
