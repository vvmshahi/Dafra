import type { jsPDF } from 'jspdf'
import { safeLatinPdfText, safeText } from './reportPdfTheme'

export const PDF_LATIN_FONT = 'helvetica'
export const PDF_ARABIC_FONT = 'NotoNaskhArabic'
export const PDF_ARABIC_FONT_FILE = 'NotoNaskhArabic-Regular.ttf'
const PDF_ASSET_BASE_URL = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`
export const PDF_ARABIC_FONT_URL = `${PDF_ASSET_BASE_URL}fonts/${PDF_ARABIC_FONT_FILE}`

export type PdfFontStyle = 'normal' | 'bold' | 'italic' | 'bolditalic'

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/
const LATIN_RE = /[A-Za-z]/

let arabicFontBase64: string | null = null
let arabicFontPromise: Promise<string | null> | null = null
let arabicFontReady = false
let warnedAboutArabicFont = false

function warnArabicFontLoadFailed(error: unknown) {
  if (warnedAboutArabicFont || !import.meta.env.DEV) return
  warnedAboutArabicFont = true
  console.warn('Kubri report PDF Arabic font could not be loaded. Falling back to Latin-safe text.', error)
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000

  for (let start = 0; start < bytes.length; start += chunkSize) {
    const chunk = bytes.subarray(start, start + chunkSize)
    let chunkText = ''
    for (let index = 0; index < chunk.length; index += 1) {
      chunkText += String.fromCharCode(chunk[index])
    }
    binary += chunkText
  }

  return btoa(binary)
}

async function loadArabicFontBase64(): Promise<string | null> {
  if (arabicFontBase64) return arabicFontBase64

  if (!arabicFontPromise) {
    arabicFontPromise = fetch(PDF_ARABIC_FONT_URL)
      .then(response => {
        if (!response.ok) throw new Error(`Unable to load ${PDF_ARABIC_FONT_URL}`)
        return response.arrayBuffer()
      })
      .then(buffer => arrayBufferToBase64(buffer))
      .catch(error => {
        warnArabicFontLoadFailed(error)
        return null
      })
  }

  arabicFontBase64 = await arabicFontPromise
  return arabicFontBase64
}

export async function registerPdfFonts(doc: jsPDF): Promise<{ arabicReady: boolean }> {
  const base64 = await loadArabicFontBase64()
  if (!base64) {
    arabicFontReady = false
    return { arabicReady: false }
  }

  try {
    doc.addFileToVFS(PDF_ARABIC_FONT_FILE, base64)
    doc.addFont(PDF_ARABIC_FONT_FILE, PDF_ARABIC_FONT, 'normal')
    arabicFontReady = true
  } catch (error) {
    arabicFontReady = false
    warnArabicFontLoadFailed(error)
  }

  doc.setFont(PDF_LATIN_FONT, 'normal')
  return { arabicReady: arabicFontReady }
}

export function isArabicFontReady(): boolean {
  return arabicFontReady
}

export function hasArabicText(value: unknown): boolean {
  return ARABIC_RE.test(safeText(value))
}

export function hasLatinText(value: unknown): boolean {
  return LATIN_RE.test(safeText(value))
}

export function pdfDrawableText(value: unknown, fallback = ''): string {
  const text = safeText(value, fallback)
  if (!text) return fallback
  return hasArabicText(text) && !arabicFontReady ? safeLatinPdfText(text, fallback) : text
}

export function setPdfFontForText(doc: jsPDF, text: unknown, style: PdfFontStyle = 'normal') {
  const value = safeText(text)
  if (hasArabicText(value) && arabicFontReady) {
    doc.setFont(PDF_ARABIC_FONT, 'normal')
    return
  }

  doc.setFont(PDF_LATIN_FONT, style)
}
