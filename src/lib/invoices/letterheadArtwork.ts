import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

export const LETTERHEAD_MAX_SOURCE_BYTES = 12 * 1024 * 1024
export const LETTERHEAD_MAX_DERIVATIVE_BYTES = 8 * 1024 * 1024
export const LETTERHEAD_ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf'

export type LetterheadSourceKind = 'image' | 'pdf'
export type LetterheadValidationCode =
  | 'type'
  | 'size'
  | 'signature'
  | 'decode'
  | 'dimensions'
  | 'pdf_pages'
  | 'pdf_encrypted'

export class LetterheadValidationError extends Error {
  readonly code: LetterheadValidationCode

  constructor(code: LetterheadValidationCode, message: string) {
    super(message)
    this.name = 'LetterheadValidationError'
    this.code = code
  }
}

export interface LetterheadSource {
  readonly fileName: string
  readonly fileSize: number
  readonly kind: LetterheadSourceKind
  readonly width: number
  readonly height: number
  readonly previewUrl: string
  readonly qualityWarning: 'low_resolution' | 'none'
  readonly release: () => void
}

export interface LetterheadCrop {
  readonly top: number
  readonly height: number
}

export interface ArtworkDerivative {
  readonly blob: Blob
  readonly extension: 'webp' | 'png'
  readonly width: number
  readonly height: number
}

const bytesToText = (bytes: Uint8Array) => String.fromCharCode(...bytes)
const isPng = (bytes: Uint8Array) => bytes.length >= 8 && bytes[0] === 0x89 && bytesToText(bytes.slice(1, 4)) === 'PNG'
const isJpeg = (bytes: Uint8Array) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
const isWebp = (bytes: Uint8Array) => bytes.length >= 12 && bytesToText(bytes.slice(0, 4)) === 'RIFF' && bytesToText(bytes.slice(8, 12)) === 'WEBP'
const isPdf = (bytes: Uint8Array) => bytes.length >= 5 && bytesToText(bytes.slice(0, 5)) === '%PDF-'

export function formatArtworkBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export async function inspectLetterheadFile(file: File): Promise<{
  readonly kind: LetterheadSourceKind
  readonly mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf'
}> {
  if (file.size > LETTERHEAD_MAX_SOURCE_BYTES) {
    throw new LetterheadValidationError('size', `The selected file is ${formatArtworkBytes(file.size)}; the maximum source size is ${formatArtworkBytes(LETTERHEAD_MAX_SOURCE_BYTES)}.`)
  }
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const detected = isPng(bytes) ? 'image/png'
    : isJpeg(bytes) ? 'image/jpeg'
      : isWebp(bytes) ? 'image/webp'
        : isPdf(bytes) ? 'application/pdf'
          : null
  if (!detected) {
    throw new LetterheadValidationError('signature', 'The file signature is not a supported PNG, JPEG, WebP, or PDF.')
  }
  if (file.type && file.type !== detected && !(file.type === 'image/jpg' && detected === 'image/jpeg')) {
    throw new LetterheadValidationError('type', `The file content is ${detected}, but the browser reported ${file.type}.`)
  }
  return { kind: detected === 'application/pdf' ? 'pdf' : 'image', mime: detected }
}

function canvasBlob(canvas: HTMLCanvasElement, type: 'image/webp' | 'image/png', quality?: number) {
  return new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality))
}

async function imageSource(file: File): Promise<LetterheadSource> {
  const previewUrl = URL.createObjectURL(file)
  const image = new Image()
  image.decoding = 'async'
  image.src = previewUrl
  try {
    await image.decode()
  } catch {
    URL.revokeObjectURL(previewUrl)
    throw new LetterheadValidationError('decode', 'The image could not be decoded.')
  }
  if (image.naturalWidth < 480 || image.naturalHeight < 80) {
    URL.revokeObjectURL(previewUrl)
    throw new LetterheadValidationError('dimensions', `The image is only ${image.naturalWidth} × ${image.naturalHeight} px and is too small for safe print artwork.`)
  }
  return {
    fileName: file.name,
    fileSize: file.size,
    kind: 'image',
    width: image.naturalWidth,
    height: image.naturalHeight,
    previewUrl,
    qualityWarning: image.naturalWidth < 1200 ? 'low_resolution' : 'none',
    release: () => URL.revokeObjectURL(previewUrl),
  }
}

async function pdfSource(file: File): Promise<LetterheadSource> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
    useSystemFonts: true,
  })
  let passwordRejected = false
  loadingTask.onPassword = () => {
    passwordRejected = true
    void loadingTask.destroy()
  }
  let pdfDocument
  try {
    pdfDocument = await loadingTask.promise
  } catch {
    throw new LetterheadValidationError(passwordRejected ? 'pdf_encrypted' : 'decode', passwordRejected ? 'Password-protected or encrypted PDFs are not supported.' : 'The PDF could not be safely decoded.')
  }
  if (pdfDocument.numPages !== 1) {
    const pageCount = pdfDocument.numPages
    await pdfDocument.destroy()
    throw new LetterheadValidationError('pdf_pages', `This first version accepts a single-page PDF; the selected PDF has ${pageCount} pages.`)
  }
  const page = await pdfDocument.getPage(1)
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(3, 1800 / base.width)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(viewport.width))
  canvas.height = Math.max(1, Math.round(viewport.height))
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) {
    await pdfDocument.destroy()
    throw new LetterheadValidationError('decode', 'A secure PDF preview canvas could not be created.')
  }
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: context, viewport }).promise
  const blob = await canvasBlob(canvas, 'image/png')
  await pdfDocument.destroy()
  if (!blob) throw new LetterheadValidationError('decode', 'The PDF page could not be converted into a safe image preview.')
  const previewUrl = URL.createObjectURL(blob)
  return {
    fileName: file.name,
    fileSize: file.size,
    kind: 'pdf',
    width: canvas.width,
    height: canvas.height,
    previewUrl,
    qualityWarning: 'none',
    release: () => URL.revokeObjectURL(previewUrl),
  }
}

export async function loadLetterheadSource(file: File): Promise<LetterheadSource> {
  const inspection = await inspectLetterheadFile(file)
  return inspection.kind === 'pdf' ? pdfSource(file) : imageSource(file)
}

export function defaultLetterheadCrops(source: Pick<LetterheadSource, 'width' | 'height'>): {
  readonly header: LetterheadCrop
  readonly footer: LetterheadCrop
} {
  const pageLike = source.height / source.width > .7
  return pageLike
    ? { header: { top: 0, height: 18 }, footer: { top: 92, height: 8 } }
    : { header: { top: 0, height: 100 }, footer: { top: 92, height: 8 } }
}

export async function cropLetterheadRegion(source: LetterheadSource, crop: LetterheadCrop): Promise<ArtworkDerivative> {
  const top = Math.max(0, Math.min(99, crop.top))
  const height = Math.max(1, Math.min(100 - top, crop.height))
  const image = new Image()
  image.decoding = 'async'
  image.src = source.previewUrl
  try {
    await image.decode()
  } catch {
    throw new LetterheadValidationError('decode', 'The selected crop could not be decoded.')
  }
  const sourceY = Math.round(source.height * top / 100)
  const sourceHeight = Math.max(1, Math.round(source.height * height / 100))
  const scale = Math.min(1, 2400 / source.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(source.width * scale))
  canvas.height = Math.max(1, Math.round(sourceHeight * scale))
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new LetterheadValidationError('decode', 'A crop canvas could not be created.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, sourceY, source.width, sourceHeight, 0, 0, canvas.width, canvas.height)
  const webp = await canvasBlob(canvas, 'image/webp', .94)
  const blob = webp ?? await canvasBlob(canvas, 'image/png')
  if (!blob) throw new LetterheadValidationError('decode', 'The crop could not be converted into safe artwork.')
  if (blob.size > LETTERHEAD_MAX_DERIVATIVE_BYTES) {
    throw new LetterheadValidationError('size', `The extracted artwork is ${formatArtworkBytes(blob.size)}; reduce the crop before uploading.`)
  }
  return { blob, extension: webp ? 'webp' : 'png', width: canvas.width, height: canvas.height }
}
