import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import publicAr from '@/localization/locales/ar-SA/public.json'
import publicEn from '@/localization/locales/en/public.json'
import { useLocale } from '@/localization/useLocale'

const SITE_URL = 'https://www.kubri.shop'
const SOCIAL_IMAGE = `${SITE_URL}/brand/kubri-app-icon.png`

type FaqGroup = { items: Array<{ q: string; a: string }> }

type RouteMetadata = {
  title: string
  description: string
  breadcrumb: string
}

const ROUTE_METADATA: Record<string, { en: RouteMetadata; ar: RouteMetadata }> = {
  '/': {
    en: {
      title: 'Kubri POS | ZATCA-Ready POS and Invoicing for Saudi Businesses',
      description: 'Kubri is a bilingual POS, invoicing, inventory, customer credit, and business management platform built for Saudi businesses and ZATCA workflows.',
      breadcrumb: 'Home',
    },
    ar: {
      title: 'Kubri | نقاط البيع والفوترة الجاهزة لمسارات ZATCA',
      description: 'Kubri منصة بسيطة لنقاط البيع والفوترة الجاهزة لمسارات ZATCA للمنشآت السعودية.',
      breadcrumb: 'الرئيسية',
    },
  },
  '/pricing': {
    en: {
      title: 'Kubri POS Pricing | Simple Plans for Saudi Businesses',
      description: 'Explore simple Kubri pricing for Saudi businesses, with clear plans per active branch.',
      breadcrumb: 'Pricing',
    },
    ar: {
      title: 'أسعار Kubri | خطط بسيطة حسب الفروع',
      description: 'تعرّف على أسعار Kubri البسيطة للمنشآت السعودية بخطط واضحة لكل فرع نشط.',
      breadcrumb: 'الأسعار',
    },
  },
  '/faq': {
    en: {
      title: 'Kubri POS FAQ | POS, Invoicing, ZATCA and Desktop Support',
      description: 'Find answers about Kubri POS, invoicing, ZATCA Phase 2 workflows, desktop apps, pricing, and support.',
      breadcrumb: 'FAQ',
    },
    ar: {
      title: 'الأسئلة الشائعة حول Kubri | نقاط البيع والفوترة وZATCA',
      description: 'إجابات حول نقاط البيع والفوترة ومسارات ZATCA وتطبيقات سطح المكتب والأسعار والدعم في Kubri.',
      breadcrumb: 'الأسئلة الشائعة',
    },
  },
  '/terms': {
    en: {
      title: 'Kubri Terms of Service',
      description: 'Read the Kubri terms and conditions for the pilot launch and ongoing business operations.',
      breadcrumb: 'Terms',
    },
    ar: {
      title: 'شروط وأحكام Kubri',
      description: 'اقرأ شروط وأحكام Kubri للإطلاق التجريبي وعمليات الأعمال المستمرة.',
      breadcrumb: 'الشروط',
    },
  },
  '/privacy': {
    en: {
      title: 'Kubri Privacy Policy',
      description: 'Read how Kubri handles business, account, and operational data.',
      breadcrumb: 'Privacy',
    },
    ar: {
      title: 'سياسة خصوصية Kubri',
      description: 'اقرأ عن كيفية تعامل Kubri مع بيانات المنشأة والحساب والعمليات.',
      breadcrumb: 'الخصوصية',
    },
  },
  '/login': {
    en: { title: 'Sign in to Kubri', description: 'Sign in to your Kubri account.', breadcrumb: 'Sign in' },
    ar: { title: 'تسجيل الدخول إلى Kubri', description: 'سجّل الدخول إلى حساب Kubri الخاص بك.', breadcrumb: 'تسجيل الدخول' },
  },
  '/signup': {
    en: { title: 'Create your Kubri account', description: 'Create an account to get started with Kubri.', breadcrumb: 'Sign up' },
    ar: { title: 'أنشئ حساب Kubri', description: 'أنشئ حسابًا للبدء باستخدام Kubri.', breadcrumb: 'إنشاء حساب' },
  },
  '/forgot-password': {
    en: { title: 'Reset your Kubri password', description: 'Request a password reset for your Kubri account.', breadcrumb: 'Password reset' },
    ar: { title: 'إعادة تعيين كلمة مرور Kubri', description: 'اطلب إعادة تعيين كلمة مرور حساب Kubri.', breadcrumb: 'إعادة تعيين كلمة المرور' },
  },
  '/reset-password': {
    en: { title: 'Set a new Kubri password', description: 'Set a new password for your Kubri account.', breadcrumb: 'New password' },
    ar: { title: 'تعيين كلمة مرور جديدة لـ Kubri', description: 'عيّن كلمة مرور جديدة لحساب Kubri.', breadcrumb: 'كلمة مرور جديدة' },
  },
}

const INDEXABLE_ROUTES = new Set(['/', '/pricing', '/faq', '/terms', '/privacy'])

function setMeta(attribute: 'name' | 'property', key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`)
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(attribute, key)
    document.head.appendChild(element)
  }
  element.content = content
}

function setCanonical(pathname: string) {
  let element = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!element) {
    element = document.createElement('link')
    element.rel = 'canonical'
    document.head.appendChild(element)
  }
  element.href = `${SITE_URL}${pathname === '/' ? '/' : pathname}`
}

function faqStructuredData(groups: FaqGroup[]) {
  return groups.flatMap(group => group.items).map(item => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: { '@type': 'Answer', text: item.a },
  }))
}

function structuredData(pathname: string, metadata: RouteMetadata, isArabic: boolean) {
  const organization = {
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: 'Kubri',
    url: SITE_URL,
    logo: SOCIAL_IMAGE,
    contactPoint: [{
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: 'support@kubri.shop',
      availableLanguage: ['English', 'Arabic'],
    }],
  }
  const website = {
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    name: 'Kubri',
    url: SITE_URL,
    publisher: { '@id': `${SITE_URL}/#organization` },
  }
  const graph: Record<string, unknown>[] = [organization, website]

  if (pathname === '/') {
    graph.push({
      '@type': 'SoftwareApplication',
      name: 'Kubri POS',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web, Windows, macOS',
      softwareVersion: '1.0.5',
      description: 'A bilingual POS, invoicing, inventory, customer credit, and business management platform built for Saudi businesses and ZATCA workflows.',
      url: SITE_URL,
      image: SOCIAL_IMAGE,
      publisher: { '@id': `${SITE_URL}/#organization` },
    })
  }

  if (pathname === '/faq') {
    const groups = isArabic ? publicAr.faq.groups : publicEn.faq.groups
    graph.push({ '@type': 'FAQPage', mainEntity: faqStructuredData(groups) })
  }

  if (pathname !== '/') {
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: isArabic ? 'الرئيسية' : 'Home', item: `${SITE_URL}/` },
        { '@type': 'ListItem', position: 2, name: metadata.breadcrumb, item: `${SITE_URL}${pathname}` },
      ],
    })
  }

  return { '@context': 'https://schema.org', '@graph': graph }
}

export default function SeoHead() {
  const { pathname } = useLocation()
  const { locale } = useLocale()
  const isArabic = locale === 'ar-SA'

  useEffect(() => {
    const route = ROUTE_METADATA[pathname]
    const metadata = route?.[isArabic ? 'ar' : 'en'] ?? {
      title: 'Kubri',
      description: 'Kubri business management platform for Saudi businesses.',
      breadcrumb: 'Page',
    }
    const isIndexable = INDEXABLE_ROUTES.has(pathname)
    const localeValue = isArabic ? 'ar_SA' : 'en_US'
    const canonicalPath = ROUTE_METADATA[pathname] ? pathname : '/'

    document.title = metadata.title
    document.documentElement.lang = isArabic ? 'ar' : 'en'
    document.documentElement.dir = isArabic ? 'rtl' : 'ltr'
    setCanonical(canonicalPath)
    setMeta('name', 'description', metadata.description)
    setMeta('name', 'robots', isIndexable ? 'index, follow' : 'noindex, nofollow')
    setMeta('property', 'og:type', 'website')
    setMeta('property', 'og:title', metadata.title)
    setMeta('property', 'og:description', metadata.description)
    setMeta('property', 'og:url', `${SITE_URL}${canonicalPath}`)
    setMeta('property', 'og:site_name', 'Kubri')
    setMeta('property', 'og:locale', localeValue)
    setMeta('property', 'og:image', SOCIAL_IMAGE)
    setMeta('name', 'twitter:card', 'summary')
    setMeta('name', 'twitter:title', metadata.title)
    setMeta('name', 'twitter:description', metadata.description)
    setMeta('name', 'twitter:image', SOCIAL_IMAGE)

    const existing = document.head.querySelector<HTMLScriptElement>('#kubri-structured-data')
    if (existing) existing.remove()
    if (isIndexable) {
      const script = document.createElement('script')
      script.id = 'kubri-structured-data'
      script.type = 'application/ld+json'
      script.textContent = JSON.stringify(structuredData(pathname, metadata, isArabic))
      document.head.appendChild(script)
    }
  }, [isArabic, pathname])

  return null
}
