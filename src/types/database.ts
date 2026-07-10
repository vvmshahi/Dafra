// Auto-generated types matching supabase/schema.sql
// Run `supabase gen types typescript` to regenerate after schema changes.

export type UserRole = 'super_admin' | 'owner' | 'branch'
export type BusinessType = 'trading' | 'service'
export type VatExpenseTreatment = 'no_vat' | 'included' | 'on_top'
export type ExpenseVatClaimStatus = 'no_vat' | 'claimable' | 'not_claimable' | 'needs_review'
export type ExpensePaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'other'
export type InvoiceType = 'standard' | 'simplified' | 'credit_note' | 'debit_note'
export type InvoiceStatus = 'draft' | 'posted' | 'cancelled'
export type ZatcaStatus = 'not_submitted' | 'pending' | 'reported' | 'cleared' | 'failed'
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
          }
        }
        Returns: Record<string, unknown>
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
  allow_split_payments: boolean
  show_pos_scroll_buttons: boolean
  stock_enabled: boolean | null
  created_at: string
  updated_at: string
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
  id: string
  tenant_id: string
  branch_id: string
  customer_id: string | null
  created_by: string | null
  invoice_number: string
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
  allow_split_payments?: boolean
  show_pos_scroll_buttons?: boolean
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
