# Dafra — Project Brief

## What We Are Building
Dafra is a cloud + desktop SaaS platform for Saudi SMEs (1-10 branches).
It includes POS, invoicing, inventory, and employee management.
Full ZATCA Phase 1 and Phase 2 compliance required.

## Software Name
Dafra (دفرة)

## Tech Stack
- Frontend: React + TypeScript + Vite + TailwindCSS
- Backend: Supabase (PostgreSQL + Auth + Edge Functions + Storage)
- Deployment: Vercel (frontend)
- Desktop POS: Electron (later phase)
- Payments: Moyasar (later phase)

## Environment Variables
SUPABASE_URL=your_value_here
SUPABASE_ANON_KEY=your_value_here
SUPABASE_SERVICE_ROLE_KEY=your_value_here
ZATCA_SANDBOX_BASE_URL=https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal

## ZATCA Requirements
Phase 1:
- QR code generation (TLV Base64, 5 fields)

Phase 2:
- XML invoice (UBL 2.1 format)
- ECDSA P-256 digital signature
- Reporting API (B2C invoices, within 24 hours)
- Clearance API (B2B invoices, before delivery)
- CSID registration per branch

## Architecture
- Multi-tenant (each business = one tenant)
- Row Level Security on all tables
- Each branch has its own ZATCA certificate
- Web app for admin, reports, inventory
- Electron POS for invoice generation (later)

## Database Tables Needed
- tenants (businesses/clients)
- branches (per tenant)
- users (with roles: owner, manager, cashier, accountant)
- products (inventory items)
- categories (product categories)
- customers
- invoices (with ZATCA fields: UUID, XML, signature, QR, status)
- invoice_items
- payments
- employees
- zatca_certificates (per branch)
- subscription_plans
- tenant_subscriptions
- sync_queue (for offline invoice submission later)

## User Roles
- Super Admin (you — sees all tenants)
- Owner (sees their business only)
- Manager (sees their branch only)
- Cashier (POS access only)
- Accountant (reports and invoices, read only)

## Build Order
1. Supabase database schema (all tables + RLS policies)
2. Supabase Auth (login, signup, roles)
3. React frontend setup (Vite + TypeScript + TailwindCSS)
4. Authentication screens (login, signup, onboarding)
5. Dashboard and admin panel
6. Product and inventory management
7. Customer management
8. Invoice creation (Phase 1 first — QR code)
9. ZATCA Phase 2 (XML + signing + API submission)
10. Reports and analytics
11. Multi-branch management
12. Subscription and billing (Moyasar — later)
13. Electron POS wrapper (later)

## My Business Details (for ZATCA testing)
VAT Number: [YOUR VAT NUMBER]
Business Name Arabic: [YOUR BUSINESS NAME IN ARABIC]
Business Name English: [YOUR BUSINESS NAME IN ENGLISH]
CR Number: [YOUR CR NUMBER]
City: [YOUR CITY]

## Key Notes
- Arabic + English UI (RTL support needed)
- Thermal printer support (80mm) later with Electron
- All invoice data stored for 6 years (ZATCA requirement)
- Sandbox testing first, production later