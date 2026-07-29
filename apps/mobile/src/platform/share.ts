import { Share } from '@capacitor/share'

export async function shareReceiptPreview(invoiceNumber: string, total: number) {
  return Share.share({
    title: `Kubri receipt ${invoiceNumber}`,
    text: `Simulated receipt ${invoiceNumber} · SAR ${total.toFixed(2)} · No production invoice was issued.`,
    dialogTitle: 'Share receipt preview',
  })
}
