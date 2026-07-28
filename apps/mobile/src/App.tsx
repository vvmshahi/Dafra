import { useEffect, useMemo, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import {
  Activity, ArrowLeft, BarChart3, Boxes, Building2, Camera, ChevronRight,
  CircleUserRound, FileText, Globe2, Home, LogOut, Menu, Minus, PackagePlus,
  Plus, ReceiptText, ScanLine, Search, Settings, Share2, ShieldCheck,
  ShoppingBag, ShoppingCart, Store, TriangleAlert, UserPlus, Users, WifiOff,
} from 'lucide-react'
import type {
  BranchTab, CartLine, ConnectionState, Customer, Locale, MobileRole, OwnerTab, Product,
} from './domain'
import { calculatePreview, canCheckout, matchesCustomer } from './domain'
import { customers, ownerMetrics, products } from './fixtures'
import { cartStorage } from './platform/cartStorage'
import { getConnectionState, observeConnection } from './platform/network'
import { scanSingleBarcode } from './platform/scanner'
import { shareReceiptPreview } from './platform/share'
import { SystemPrintAdapter } from './platform/printer'

type Screen = 'splash' | 'signin' | 'role' | 'app' | 'expired'
type Receipt = ReturnType<typeof calculatePreview> & { invoiceNumber: string }

const text = {
  en: {
    demo: 'Local fixture demo', owner: 'Owner', branch: 'Branch', signIn: 'Continue to role demo',
    welcome: 'Run the day from your pocket.', sub: 'A safe mobile proof of concept. No production checkout is connected.',
    online: 'Online', offline: 'No connection · billing is blocked', preview: 'Preview checkout',
  },
  ar: {
    demo: 'عرض ببيانات محلية', owner: 'المالك', branch: 'الفرع', signIn: 'متابعة إلى عرض الأدوار',
    welcome: 'أدر يومك من هاتفك.', sub: 'نموذج آمن للهاتف. لا يوجد اتصال بالفوترة الإنتاجية.',
    online: 'متصل', offline: 'لا يوجد اتصال · الفوترة متوقفة', preview: 'معاينة الفاتورة',
  },
}

function money(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-SA', {
    style: 'currency', currency: 'SAR', maximumFractionDigits: 2,
  }).format(value)
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('splash')
  const [role, setRole] = useState<MobileRole | null>(null)
  const [locale, setLocale] = useState<Locale>('en')
  const [connection, setConnection] = useState<ConnectionState>('online')
  const [cart, setCart] = useState<CartLine[]>([])
  const [reconciling, setReconciling] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setScreen('signin'), 850)
    void getConnectionState().then(setConnection)
    void cartStorage.restore().then(setCart)
    let remove: (() => Promise<void>) | undefined
    void observeConnection(state => {
      setConnection(state)
      if (state === 'online') {
        setReconciling(true)
        window.setTimeout(() => setReconciling(false), 900)
      }
    }).then(handle => { remove = () => handle.remove() })
    return () => {
      window.clearTimeout(timer)
      void remove?.()
    }
  }, [])

  useEffect(() => { void cartStorage.save(cart) }, [cart])
  useEffect(() => {
    document.documentElement.lang = locale === 'ar' ? 'ar-SA' : 'en'
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr'
  }, [locale])

  if (screen === 'splash') return <Splash />
  if (screen === 'signin') return <SignIn locale={locale} setLocale={setLocale} onContinue={() => setScreen('role')} />
  if (screen === 'role') return (
    <RoleDemo locale={locale} onSelect={selected => { setRole(selected); setScreen('app') }} />
  )
  if (screen === 'expired') return <SessionExpired onRecover={() => setScreen('signin')} />

  return (
    <MobileShell
      role={role!}
      locale={locale}
      setLocale={setLocale}
      connection={connection}
      reconciling={reconciling}
      cart={cart}
      setCart={setCart}
      onSignOut={() => { setRole(null); setScreen('signin') }}
    />
  )
}

function Splash() {
  return (
    <main className="splash">
      <div className="brand-mark" aria-label="Kubri">ك</div>
      <div><strong>Kubri</strong><span>Mobile operations</span></div>
    </main>
  )
}

function SignIn({ locale, setLocale, onContinue }: {
  locale: Locale; setLocale: (locale: Locale) => void; onContinue: () => void
}) {
  const t = text[locale]
  return (
    <main className="auth-screen">
      <header className="auth-top">
        <div className="mini-brand"><span>ك</span>Kubri</div>
        <button className="icon-button language" onClick={() => setLocale(locale === 'en' ? 'ar' : 'en')} aria-label="Change language">
          <Globe2 /> {locale === 'en' ? 'ع' : 'EN'}
        </button>
      </header>
      <section className="auth-card">
        <p className="eyebrow">{t.demo}</p>
        <h1>{t.welcome}</h1>
        <p>{t.sub}</p>
        <label>Email or branch username<input value="owner@kubri.demo" readOnly /></label>
        <label>Password<input value="••••••••••" type="password" readOnly /></label>
        <button className="primary-action" onClick={onContinue}>{t.signIn}<ChevronRight /></button>
        <div className="safety-note"><ShieldCheck /><span>Fixture mode keeps production data and checkout unreachable.</span></div>
      </section>
    </main>
  )
}

function RoleDemo({ locale, onSelect }: { locale: Locale; onSelect: (role: MobileRole) => void }) {
  return (
    <main className="choice-screen">
      <p className="eyebrow">Choose a workspace</p>
      <h1>One app, two focused desks.</h1>
      <button className="role-card" onClick={() => onSelect('owner')}>
        <span className="role-icon"><Building2 /></span><span><strong>{text[locale].owner} / Admin</strong><small>Branches, reports and operational health</small></span><ChevronRight />
      </button>
      <button className="role-card" onClick={() => onSelect('branch')}>
        <span className="role-icon gold"><Store /></span><span><strong>{text[locale].branch}</strong><small>Quick billing, products and customers</small></span><ChevronRight />
      </button>
      <p className="excluded">Super Admin and ZATCA onboarding are not included.</p>
    </main>
  )
}

function SessionExpired({ onRecover }: { onRecover: () => void }) {
  return <main className="state-screen"><CircleUserRound /><h1>Session expired</h1><p>Sign in again to refresh your role and branch scope.</p><button className="primary-action" onClick={onRecover}>Return to sign in</button></main>
}

function MobileShell(props: {
  role: MobileRole; locale: Locale; setLocale: (locale: Locale) => void
  connection: ConnectionState; reconciling: boolean; cart: CartLine[]
  setCart: (cart: CartLine[]) => void; onSignOut: () => void
}) {
  const [ownerTab, setOwnerTab] = useState<OwnerTab>('home')
  const [branchTab, setBranchTab] = useState<BranchTab>('pos')
  const [detail, setDetail] = useState<string | null>(null)
  const tab = props.role === 'owner' ? ownerTab : branchTab

  useEffect(() => {
    const listeners = [
      CapacitorApp.addListener('backButton', () => {
        if (detail) return setDetail(null)
        if (props.role === 'owner' && ownerTab !== 'home') return setOwnerTab('home')
        if (props.role === 'branch' && branchTab !== 'pos') return setBranchTab('pos')
        void CapacitorApp.minimizeApp()
      }),
      CapacitorApp.addListener('appUrlOpen', event => {
        // Reserved for approved Kubri links. Unknown links deliberately do not navigate.
        if (!event.url.startsWith('kubri://')) return
      }),
    ]
    return () => { void Promise.all(listeners).then(handles => handles.forEach(handle => void handle.remove())) }
  }, [branchTab, detail, ownerTab, props.role])

  return (
    <div className="app-shell">
      <header className="app-bar">
        <button className="icon-button" aria-label="Menu"><Menu /></button>
        <div><small>{props.role === 'owner' ? 'Owner workspace' : 'Olaya branch'}</small><strong>{labelFor(tab)}</strong></div>
        <button className="avatar" aria-label="Account">MK</button>
      </header>
      {(props.connection === 'offline' || props.reconciling) && (
        <div className={`network-banner ${props.reconciling ? 'reconnecting' : ''}`} role="status">
          <WifiOff />
          <span>{props.reconciling ? 'Back online · revalidating product, stock, customer and register' : text[props.locale].offline}</span>
        </div>
      )}
      <div className="fixture-ribbon"><span />Local fixture data · no production writes</div>
      <main className="screen-body">
        {detail ? <DetailScreen
          type={detail}
          onBack={() => setDetail(null)}
          cart={props.cart}
          setCart={props.setCart}
          connection={props.connection}
          reconciling={props.reconciling}
          locale={props.locale}
        /> : props.role === 'owner'
          ? <OwnerScreen tab={ownerTab} locale={props.locale} openDetail={setDetail} />
          : <BranchScreen {...props} tab={branchTab} openDetail={setDetail} />}
      </main>
      <BottomNav role={props.role} active={tab} onSelect={value => {
        setDetail(null)
        props.role === 'owner' ? setOwnerTab(value as OwnerTab) : setBranchTab(value as BranchTab)
      }} />
    </div>
  )
}

function labelFor(tab: OwnerTab | BranchTab) {
  return ({ home: 'Today', branches: 'Branches', reports: 'Reports', activity: 'Activity', more: 'More',
    pos: 'Quick billing', sales: 'Sales', products: 'Products', customers: 'Customers' } as Record<string, string>)[tab]
}

function BottomNav({ role, active, onSelect }: { role: MobileRole; active: string; onSelect: (tab: string) => void }) {
  const owner = [
    ['home', Home, 'Home'], ['branches', Building2, 'Branches'], ['reports', BarChart3, 'Reports'],
    ['activity', Activity, 'Activity'], ['more', Menu, 'More'],
  ] as const
  const branch = [
    ['pos', ShoppingBag, 'POS'], ['sales', ReceiptText, 'Sales'], ['products', Boxes, 'Products'],
    ['customers', Users, 'Customers'], ['more', Menu, 'More'],
  ] as const
  return <nav className="bottom-nav" aria-label={`${role} navigation`}>{(role === 'owner' ? owner : branch).map(([id, Icon, label]) => (
    <button key={id} className={active === id ? 'active' : ''} onClick={() => onSelect(id)} aria-current={active === id ? 'page' : undefined}>
      <Icon /><span>{label}</span>
    </button>
  ))}</nav>
}

function OwnerScreen({ tab, locale, openDetail }: { tab: OwnerTab; locale: Locale; openDetail: (detail: string) => void }) {
  if (tab === 'home') return <OwnerHome locale={locale} openDetail={openDetail} />
  if (tab === 'branches') return <Branches openDetail={openDetail} />
  if (tab === 'reports') return <Reports locale={locale} />
  if (tab === 'activity') return <ActivityList />
  return <More role="owner" locale={locale} />
}

function OwnerHome({ locale, openDetail }: { locale: Locale; openDetail: (detail: string) => void }) {
  return (
    <>
      <section className="hero-ledger">
        <div><p>Today’s sales</p><h1>{money(ownerMetrics.sales, locale)}</h1><span>Across 4 active branches</span></div>
        <div className="hero-spark" aria-label="Sales trending upward"><i/><i/><i/><i/><i/><i/><i/></div>
      </section>
      <div className="filter-row"><button>Today <ChevronRight /></button><button>All branches <ChevronRight /></button></div>
      <section className="metric-grid">
        <Metric label="Invoices" value="146" note="+12 since 2 PM" />
        <Metric label="Expected cash" value={money(ownerMetrics.expectedCash, locale)} note="3 registers open" />
        <Metric label="Cash / Card" value="35% / 65%" note="Card leads today" />
        <Metric label="Reporting" value="145 / 146" note="1 pending" tone="attention" />
      </section>
      <SectionTitle title="Registers now" action="See branches" onClick={() => openDetail('branch-list')} />
      <div className="session-stack">
        <Session branch="Olaya" since="8:12 AM" sales="SAR 7,240" cash="SAR 2,210" status="Open" />
        <Session branch="Al Malqa" since="9:03 AM" sales="SAR 5,180" cash="SAR 1,940" status="Open · 9h" attention />
      </div>
      <SectionTitle title="Needs attention" />
      <button className="attention-card" onClick={() => openDetail('zatca')}><TriangleAlert /><span><strong>Al Malqa reporting delayed</strong><small>1 invoice pending · last update 6 min ago</small></span><ChevronRight /></button>
      <SectionTitle title="Recent transactions" />
      <Transactions />
    </>
  )
}

function Metric({ label, value, note, tone }: { label: string; value: string; note: string; tone?: string }) {
  return <article className={`metric ${tone ?? ''}`}><p>{label}</p><strong>{value}</strong><small>{note}</small></article>
}

function Session({ branch, since, sales, cash, status, attention }: { branch: string; since: string; sales: string; cash: string; status: string; attention?: boolean }) {
  return <article className="session-card"><div className="session-head"><span className={`status-dot ${attention ? 'amber' : ''}`} /><strong>{branch}</strong><small>{status}</small></div><div><span>Sales<strong>{sales}</strong></span><span>Expected cash<strong>{cash}</strong></span><span>Open since<strong>{since}</strong></span></div></article>
}

function SectionTitle({ title, action, onClick }: { title: string; action?: string; onClick?: () => void }) {
  return <div className="section-title"><h2>{title}</h2>{action && <button onClick={onClick}>{action}<ChevronRight /></button>}</div>
}

function Branches({ openDetail }: { openDetail: (detail: string) => void }) {
  return <><div className="search-field"><Search /><input aria-label="Search branches" placeholder="Search branches" /></div><div className="branch-list">
    {[
      ['Olaya', 'Open', 'SAR 7,240', 'Connected', false],
      ['Al Malqa', 'Open · 9h', 'SAR 5,180', '1 pending', true],
      ['Al Rawdah', 'Closed', 'SAR 3,120', 'Connected', false],
      ['King Fahd', 'Open', 'SAR 2,880', 'Connected', false],
    ].map(([name, state, sales, status, warning]) => <button className="branch-row" key={String(name)} onClick={() => openDetail('branch')}>
      <span className="branch-monogram">{String(name).slice(0, 2).toUpperCase()}</span><span><strong>{name}</strong><small>{state} · {status}</small></span><span><strong>{sales}</strong><ChevronRight className={warning ? 'warn' : ''}/></span>
    </button>)}
  </div></>
}

function Reports({ locale }: { locale: Locale }) {
  return <>
    <div className="filter-row"><button>This week <ChevronRight /></button><button>All branches <ChevronRight /></button></div>
    <section className="report-total"><p>Net sales</p><h1>{money(78420, locale)}</h1><span>↑ 8.4% vs previous period</span></section>
    <section className="chart-card"><div className="chart-head"><strong>Sales trend</strong><small>SAR</small></div><div className="bars">{[38,52,47,68,82,74,94].map((v,i)=><span key={i} style={{height:`${v}%`}}><i>{['S','M','T','W','T','F','S'][i]}</i></span>)}</div></section>
    <section className="metric-grid"><Metric label="Invoices" value="614" note="Avg SAR 127.72"/><Metric label="VAT" value={money(10228.7,locale)} note="Included in sales"/></section>
    <SectionTitle title="Branch comparison"/><div className="ranking">{['Olaya · SAR 29,840','Al Malqa · SAR 21,610','Al Rawdah · SAR 15,420','King Fahd · SAR 11,550'].map((x,i)=><div key={x}><b>{i+1}</b><span>{x}</span></div>)}</div>
    <SectionTitle title="Top products"/><Transactions productsOnly/>
  </>
}

function ActivityList() {
  return <><div className="segmented"><button className="active">All</button><button>Sales</button><button>Registers</button><button>ZATCA</button></div><div className="timeline">
    {[
      ['Receipt issued','INV-1046 · Olaya','2 min'],
      ['Register opened','King Fahd · by Saleh','28 min'],
      ['Reporting accepted','INV-1045 · Al Malqa','41 min'],
      ['Register warning','Al Malqa has been open 9 hours','1 hr'],
      ['Receipt issued','INV-1044 · Al Rawdah','1 hr'],
    ].map(([title,detail,time])=><article key={title+time}><span/><div><strong>{title}</strong><small>{detail}</small></div><time>{time}</time></article>)}
  </div></>
}

function Transactions({ productsOnly }: { productsOnly?: boolean }) {
  const rows = productsOnly ? [['Sidr honey','64 sold','SAR 3,680'],['Arabic coffee','81 sold','SAR 2,794'],['Ajwa dates','72 sold','SAR 2,070']] : [['INV-1046','Olaya · Cash','SAR 57.50'],['INV-1045','Al Malqa · Card','SAR 126.50'],['INV-1044','Al Rawdah · Cash','SAR 34.50']]
  return <div className="transaction-list">{rows.map(([a,b,c])=><button key={a}><span className="receipt-icon"><ReceiptText /></span><span><strong>{a}</strong><small>{b}</small></span><strong>{c}</strong></button>)}</div>
}

function BranchScreen(props: {
  tab: BranchTab; locale: Locale; connection: ConnectionState; reconciling: boolean
  cart: CartLine[]; setCart: (cart: CartLine[]) => void; openDetail: (detail: string) => void
  setLocale: (locale: Locale) => void; onSignOut: () => void; role: MobileRole
}) {
  if (props.tab === 'pos') return <Pos {...props} />
  if (props.tab === 'sales') return <><div className="filter-row"><button>Today <ChevronRight /></button><button>All payments <ChevronRight /></button></div><section className="report-total compact"><p>Today’s sales</p><h1>{money(7240,props.locale)}</h1><span>58 completed sales</span></section><Transactions /></>
  if (props.tab === 'products') return <ProductList locale={props.locale} addToCart={product => addProduct(props.cart, props.setCart, product)} />
  if (props.tab === 'customers') return <CustomerList />
  return <More role="branch" locale={props.locale} />
}

function Pos(props: {
  locale: Locale; connection: ConnectionState; reconciling: boolean; cart: CartLine[]
  setCart: (cart: CartLine[]) => void; openDetail: (detail: string) => void
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [message, setMessage] = useState('')
  const filtered = products.filter(p => (category === 'All' || p.category === category)
    && `${p.name} ${p.nameAr} ${p.barcode}`.toLowerCase().includes(query.toLowerCase()))
  const count = props.cart.reduce((sum,line)=>sum+line.quantity,0)
  const total = props.cart.reduce((sum,line)=>sum+line.quantity*line.product.price,0)

  async function scan() {
    try {
      const barcode = await scanSingleBarcode()
      if (!barcode) return
      const product = products.find(item => item.barcode === barcode)
      if (!product) return setMessage('Barcode not found')
      if (product.stock < 1) return setMessage(`${product.name} is out of stock`)
      addProduct(props.cart, props.setCart, product)
      setMessage(`${product.name} added`)
    } catch {
      setMessage('Camera unavailable or permission denied. Search by barcode instead.')
    }
  }

  return <>
    <div className="pos-search"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search products or barcode" aria-label="Search products"/><button onClick={()=>void scan()} aria-label="Scan barcode"><ScanLine/></button></div>
    {message && <div className="toast" role="status">{message}<button onClick={()=>setMessage('')}>×</button></div>}
    <div className="chips">{['All','Pantry','Drinks','Spices','Supplies'].map(item=><button className={category===item?'active':''} onClick={()=>setCategory(item)} key={item}>{item}</button>)}</div>
    <div className="product-grid">{filtered.map(product=><button key={product.id} className="product-card" disabled={product.stock < 1} onClick={()=>addProduct(props.cart,props.setCart,product)}>
      <span className="product-visual">{product.name.slice(0,1)}</span><strong>{props.locale==='ar'?product.nameAr:product.name}</strong><small>{product.stock ? `${product.stock} in stock` : 'Out of stock'}</small><b>{money(product.price,props.locale)}</b>
    </button>)}</div>
    <button className="cart-dock" onClick={()=>props.openDetail('cart')}>
      <span><ShoppingCart/><i>{count}</i></span><span><small>Current cart</small><strong>{money(total,props.locale)}</strong></span><ChevronRight/>
    </button>
  </>
}

function addProduct(cart: CartLine[], setCart: (cart: CartLine[]) => void, product: Product) {
  if (product.stock < 1) return
  const existing = cart.find(line=>line.product.id===product.id)
  if (existing) setCart(cart.map(line=>line.product.id===product.id?{...line,quantity:Math.min(line.quantity+1,product.stock)}:line))
  else setCart([...cart,{product,quantity:1}])
}

function ProductList({ locale, addToCart }: { locale: Locale; addToCart: (product: Product) => void }) {
  const [query,setQuery]=useState('')
  const filtered=products.filter(p=>`${p.name} ${p.nameAr} ${p.barcode}`.toLowerCase().includes(query.toLowerCase()))
  return <><div className="search-field"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Name, SKU or barcode"/><button aria-label="Add product"><PackagePlus/></button></div><button className="secondary-action"><Plus/>Add product <small>UI shell</small></button><div className="catalogue">{filtered.map(p=><article key={p.id}><span className="product-visual small">{p.name[0]}</span><span><strong>{locale==='ar'?p.nameAr:p.name}</strong><small>{p.barcode} · {p.stock} in stock</small></span><span><b>{money(p.price,locale)}</b><button onClick={()=>addToCart(p)} disabled={!p.stock}>Add</button></span></article>)}</div></>
}

function CustomerList() {
  const [query,setQuery]=useState('')
  const [showCreate,setShowCreate]=useState(false)
  const filtered=customers.filter(c=>matchesCustomer(c,query))
  return <><div className="search-field"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Name or exact mobile"/></div><button className="secondary-action" onClick={()=>setShowCreate(true)}><UserPlus/>Quick-create customer</button>{showCreate&&<CustomerForm onClose={()=>setShowCreate(false)}/>}<div className="customer-list">{filtered.map(c=><button key={c.id}><span className="customer-avatar">{c.name[0]}</span><span><strong>{c.name}</strong><small>{c.mobile} · {c.kind}</small></span><ChevronRight/></button>)}</div></>
}

function CustomerForm({onClose}:{onClose:()=>void}) {
  return <div className="sheet-backdrop"><section className="sheet" role="dialog" aria-modal="true" aria-label="Create customer"><div className="sheet-handle"/><div className="sheet-title"><div><small>Local UI shell</small><h2>Quick-create customer</h2></div><button onClick={onClose}>×</button></div><div className="segmented"><button className="active">Individual</button><button>Business</button></div><label>Customer name<input placeholder="Full name"/></label><label>Mobile number<input inputMode="tel" placeholder="05x xxx xxxx"/></label><p className="form-note">Business mode adds VAT and CR fields. No data is submitted in this proof of concept.</p><button className="primary-action" onClick={onClose}>Validate preview</button></section></div>
}

function More({ role, locale }: { role: MobileRole; locale: Locale }) {
  return <><section className="profile-card"><span className="avatar large">MK</span><div><strong>Mohammed Kareem</strong><small>{role === 'owner' ? 'Owner / Admin' : 'Olaya branch user'}</small></div></section><div className="settings-list">
    <button><Settings/><span>App preferences<small>Language, notifications</small></span><ChevronRight/></button>
    <button><Globe2/><span>Language<small>{locale==='en'?'English':'العربية'}</small></span><ChevronRight/></button>
    <button><ShieldCheck/><span>Security<small>Session and device</small></span><ChevronRight/></button>
    <button><WifiOff/><span>Network policy<small>Checkout requires connection</small></span><ChevronRight/></button>
    <button><LogOut/><span>Sign out</span><ChevronRight/></button>
  </div><div className="boundary-card"><strong>Mobile safety boundary</strong><p>ZATCA status is read-only. Onboarding, credentials and Super Admin are not bundled.</p></div></>
}

function DetailScreen({type,onBack,cart,setCart,connection,reconciling,locale}:{
  type:string; onBack:()=>void; cart:CartLine[]; setCart:(cart:CartLine[])=>void
  connection:ConnectionState; reconciling:boolean; locale:Locale
}) {
  if(type==='cart') return <CartSheetScreen
    onBack={onBack}
    cart={cart}
    setCart={setCart}
    connection={connection}
    reconciling={reconciling}
    locale={locale}
  />
  if(type==='zatca') return <><Back onBack={onBack}/><ZatcaOverview/></>
  return <><Back onBack={onBack}/><section className="branch-detail-hero"><span className="branch-monogram">OL</span><div><small>Branch</small><h1>Olaya</h1><p><span className="status-dot"/>Connected · Register open</p></div></section><section className="metric-grid"><Metric label="Session sales" value="SAR 7,240" note="58 invoices"/><Metric label="Expected cash" value="SAR 2,210" note="Opened 8:12 AM"/></section><ZatcaOverview/><SectionTitle title="Latest transactions"/><Transactions/></>
}

function Back({onBack}:{onBack:()=>void}) { return <button className="back-button" onClick={onBack}><ArrowLeft/>Back</button> }

function ZatcaOverview() {
  return <section className="zatca-card"><div className="zatca-head"><ShieldCheck/><span><strong>ZATCA status</strong><small>Read-only operational view</small></span><b>Connected</b></div><dl><div><dt>Capability</dt><dd>0100 · Simplified</dd></div><div><dt>Reporting</dt><dd>1 pending</dd></div><div><dt>Last update</dt><dd>2 minutes ago</dd></div></dl><p>No OTP, credentials, certificates or onboarding controls are available here.</p></section>
}

function CartSheetScreen({onBack,cart,setCart,connection,reconciling,locale}:{
  onBack:()=>void; cart:CartLine[]; setCart:(cart:CartLine[])=>void
  connection:ConnectionState; reconciling:boolean; locale:Locale
}) {
  const preview=calculatePreview(cart,'preview-20260729-001')
  const [receipt,setReceipt]=useState<Receipt|null>(null)
  const [customer,setCustomer]=useState<Customer|null>(null)
  function change(id:string,delta:number){
    setCart(cart.flatMap(line=>line.product.id!==id?[line]:line.quantity+delta<=0?[]:[{...line,quantity:Math.min(line.quantity+delta,line.product.stock)}]))
  }
  return <><Back onBack={onBack}/><p className="eyebrow">Current cart · locally preserved</p>{cart.length===0?<div className="boundary-card"><strong>Your cart is empty</strong><p>Add an in-stock product to create a safe checkout preview.</p></div>:<div className="cart-lines">{cart.map(line=><article key={line.product.id}><span className="product-visual small">{line.product.name[0]}</span><span><strong>{locale==='ar'?line.product.nameAr:line.product.name}</strong><small>{money(line.product.price,locale)} each</small></span><div className="stepper"><button aria-label="Decrease quantity" onClick={()=>change(line.product.id,-1)}><Minus/></button><b>{line.quantity}</b><button aria-label="Increase quantity" onClick={()=>change(line.product.id,1)}><Plus/></button></div></article>)}</div>}<button className="customer-select" onClick={()=>setCustomer(customers[0])}><Users/><span><small>Customer</small><strong>{customer?.name??'Walk-in customer'}</strong></span><ChevronRight/></button><section className="totals"><div><span>Subtotal</span><b>{money(preview.subtotal,locale)}</b></div><div><span>VAT</span><b>{money(preview.tax,locale)}</b></div><div className="grand"><span>Total</span><b>{money(preview.total,locale)}</b></div></section><div className="simulation-warning"><TriangleAlert/><span><strong>Simulation only</strong>No production invoice or payment will be created.</span></div><button className="primary-action checkout" disabled={!canCheckout(connection,reconciling,cart)} onClick={()=>{void cartStorage.retainRequestId(preview.requestId);setReceipt({...preview,invoiceNumber:'PREVIEW-1047'})}}>Preview checkout <strong>{money(preview.total,locale)}</strong></button>{receipt&&<ReceiptPreview receipt={receipt} onClose={()=>setReceipt(null)}/>}</>
}

function ReceiptPreview({receipt,onClose}:{receipt:Receipt;onClose:()=>void}) {
  const printer=useMemo(()=>new SystemPrintAdapter(),[])
  return <div className="sheet-backdrop"><section className="sheet receipt-sheet" role="dialog" aria-modal="true"><div className="sheet-handle"/><div className="receipt-success"><span><ShieldCheck/></span><small>SIMULATED RESULT</small><h2>Receipt preview</h2><p>No server-confirmed invoice was issued.</p></div><div className="paper"><header><strong>Kubri Market</strong><small>Olaya branch · VAT 310123456700003</small></header><div><span>{receipt.invoiceNumber}</span><span>29 Jul 2026 · 19:42</span></div><hr/><p>Sidr honey × 1 <b>SAR 57.50</b></p><p>Arabic coffee × 2 <b>SAR 69.00</b></p><hr/><p>VAT <b>SAR {receipt.tax.toFixed(2)}</b></p><p className="paper-total">Total <b>SAR {receipt.total.toFixed(2)}</b></p><div className="fake-qr">PREVIEW<br/>ONLY</div></div><div className="receipt-actions"><button onClick={()=>void shareReceiptPreview(receipt.invoiceNumber,receipt.total)}><Share2/>Share</button><button onClick={()=>void printer.printReceipt({invoiceNumber:receipt.invoiceNumber,html:'',paperWidth:'80mm'})}><FileText/>System print</button></div><button className="primary-action" onClick={onClose}>Done</button></section></div>
}
