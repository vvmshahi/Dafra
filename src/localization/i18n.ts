import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import commonEn from './locales/en/common.json'
import navigationEn from './locales/en/navigation.json'
import authEn from './locales/en/auth.json'
import settingsEn from './locales/en/settings.json'
import validationEn from './locales/en/validation.json'
import dialogsEn from './locales/en/dialogs.json'
import posEn from './locales/en/pos.json'
import paymentsEn from './locales/en/payments.json'
import registerEn from './locales/en/register.json'
import invoicesEn from './locales/en/invoices.json'
import creditNotesEn from './locales/en/creditNotes.json'
import refundsEn from './locales/en/refunds.json'
import receiptsEn from './locales/en/receipts.json'
import printingEn from './locales/en/printing.json'
import documentsEn from './locales/en/documents.json'
import dashboardEn from './locales/en/dashboard.json'
import productsEn from './locales/en/products.json'
import inventoryEn from './locales/en/inventory.json'
import purchasesEn from './locales/en/purchases.json'
import suppliersEn from './locales/en/suppliers.json'
import customersEn from './locales/en/customers.json'
import customerIntelligenceEn from './locales/en/customerIntelligence.json'
import receivablesEn from './locales/en/receivables.json'
import supplierIntelligenceEn from './locales/en/supplierIntelligence.json'
import expensesEn from './locales/en/expenses.json'
import reportsEn from './locales/en/reports.json'
import employeesEn from './locales/en/employees.json'
import branchesEn from './locales/en/branches.json'
import zatcaEn from './locales/en/zatca.json'
import operationsEn from './locales/en/operations.json'
import onboardingEn from './locales/en/onboarding.json'
import adminEn from './locales/en/admin.json'
import publicEn from './locales/en/public.json'
import legalEn from './locales/en/legal.json'
import commonAr from './locales/ar-SA/common.json'
import navigationAr from './locales/ar-SA/navigation.json'
import authAr from './locales/ar-SA/auth.json'
import settingsAr from './locales/ar-SA/settings.json'
import validationAr from './locales/ar-SA/validation.json'
import dialogsAr from './locales/ar-SA/dialogs.json'
import posAr from './locales/ar-SA/pos.json'
import paymentsAr from './locales/ar-SA/payments.json'
import registerAr from './locales/ar-SA/register.json'
import invoicesAr from './locales/ar-SA/invoices.json'
import creditNotesAr from './locales/ar-SA/creditNotes.json'
import refundsAr from './locales/ar-SA/refunds.json'
import receiptsAr from './locales/ar-SA/receipts.json'
import printingAr from './locales/ar-SA/printing.json'
import documentsAr from './locales/ar-SA/documents.json'
import dashboardAr from './locales/ar-SA/dashboard.json'
import productsAr from './locales/ar-SA/products.json'
import inventoryAr from './locales/ar-SA/inventory.json'
import purchasesAr from './locales/ar-SA/purchases.json'
import suppliersAr from './locales/ar-SA/suppliers.json'
import customersAr from './locales/ar-SA/customers.json'
import customerIntelligenceAr from './locales/ar-SA/customerIntelligence.json'
import receivablesAr from './locales/ar-SA/receivables.json'
import supplierIntelligenceAr from './locales/ar-SA/supplierIntelligence.json'
import expensesAr from './locales/ar-SA/expenses.json'
import reportsAr from './locales/ar-SA/reports.json'
import employeesAr from './locales/ar-SA/employees.json'
import branchesAr from './locales/ar-SA/branches.json'
import zatcaAr from './locales/ar-SA/zatca.json'
import operationsAr from './locales/ar-SA/operations.json'
import onboardingAr from './locales/ar-SA/onboarding.json'
import adminAr from './locales/ar-SA/admin.json'
import publicAr from './locales/ar-SA/public.json'
import legalAr from './locales/ar-SA/legal.json'
import { applyDocumentLocale, detectInitialLocale, normalizeLocale } from './locale'
import type { UiLocale } from './types'

const initialLocale = detectInitialLocale()

void i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: commonEn, navigation: navigationEn, auth: authEn, settings: settingsEn, validation: validationEn, dialogs: dialogsEn, pos: posEn, payments: paymentsEn, register: registerEn, invoices: invoicesEn, creditNotes: creditNotesEn, refunds: refundsEn, receipts: receiptsEn, printing: printingEn, documents: documentsEn, dashboard: dashboardEn, products: productsEn, inventory: inventoryEn, purchases: purchasesEn, suppliers: suppliersEn, customers: customersEn, customerIntelligence: customerIntelligenceEn, receivables: receivablesEn, supplierIntelligence: supplierIntelligenceEn, expenses: expensesEn, reports: reportsEn, employees: employeesEn, branches: branchesEn, zatca: zatcaEn, operations: operationsEn, onboarding: onboardingEn, admin: adminEn, public: publicEn, legal: legalEn },
      'ar-SA': { common: commonAr, navigation: navigationAr, auth: authAr, settings: settingsAr, validation: validationAr, dialogs: dialogsAr, pos: posAr, payments: paymentsAr, register: registerAr, invoices: invoicesAr, creditNotes: creditNotesAr, refunds: refundsAr, receipts: receiptsAr, printing: printingAr, documents: documentsAr, dashboard: dashboardAr, products: productsAr, inventory: inventoryAr, purchases: purchasesAr, suppliers: suppliersAr, customers: customersAr, customerIntelligence: customerIntelligenceAr, receivables: receivablesAr, supplierIntelligence: supplierIntelligenceAr, expenses: expensesAr, reports: reportsAr, employees: employeesAr, branches: branchesAr, zatca: zatcaAr, operations: operationsAr, onboarding: onboardingAr, admin: adminAr, public: publicAr, legal: legalAr },
    },
    lng: initialLocale,
    supportedLngs: ['en', 'ar-SA'],
    nonExplicitSupportedLngs: false,
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'navigation', 'auth', 'settings', 'validation', 'dialogs', 'pos', 'payments', 'register', 'invoices', 'creditNotes', 'refunds', 'receipts', 'printing', 'documents', 'dashboard', 'products', 'inventory', 'purchases', 'suppliers', 'customers', 'customerIntelligence', 'receivables', 'supplierIntelligence', 'expenses', 'reports', 'employees', 'branches', 'zatca', 'operations', 'onboarding', 'admin', 'public', 'legal'],
    returnEmptyString: false,
    initImmediate: false,
    react: { useSuspense: false },
    interpolation: { escapeValue: false },
    saveMissing: import.meta.env.DEV,
    missingKeyHandler: (_languages, namespace, key) => {
      if (import.meta.env.DEV) console.warn(`[i18n] Missing translation: ${namespace}.${key}`)
    },
  })
  .catch(error => {
    applyDocumentLocale('en')
    if (import.meta.env.DEV) console.error('[i18n] Initialization failed; using English document defaults.', error)
  })

applyDocumentLocale(initialLocale)

i18n.on('languageChanged', language => {
  applyDocumentLocale(normalizeLocale(language) ?? 'en')
})

export function currentUiLocale(): UiLocale {
  return normalizeLocale(i18n.resolvedLanguage ?? i18n.language) ?? 'en'
}

export default i18n
