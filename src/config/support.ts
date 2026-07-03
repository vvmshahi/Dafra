const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || 'support@kubri.shop'
const SUPPORT_WHATSAPP_NUMBER = import.meta.env.VITE_SUPPORT_WHATSAPP_NUMBER || '+971561373210'

export const supportConfig = {
  email: SUPPORT_EMAIL,
  emailLink: `mailto:${SUPPORT_EMAIL}`,
  whatsappNumber: SUPPORT_WHATSAPP_NUMBER,
  whatsappLink: SUPPORT_WHATSAPP_NUMBER
    ? `https://wa.me/${SUPPORT_WHATSAPP_NUMBER.replace(/[^0-9]/g, '')}`
    : '#',
}
