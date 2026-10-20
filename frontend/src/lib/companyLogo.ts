import type { jsPDF } from 'jspdf';

/**
 * The company logo: printed at the top of receipts / tax invoices and drawn
 * in the header of quotation and purchase order PDFs. Kept in settings as
 * `company_logo`, an image data URL shrunk on upload so every till's copy of
 * the settings stays small.
 */

// Sharp on an A4 header and on a receipt, small enough to ship with settings.
const MAX_SIDE = 480;
const MAX_LENGTH = 250_000;

// Only a data URL this file made (or one just like it) ever reaches a
// receipt's HTML or a printer — never arbitrary text from settings.
const DATA_URL = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/;

/** The saved logo, or undefined when there's none (or it isn't an image data URL). */
export function companyLogo(settings: Record<string, any> | null | undefined): string | undefined {
  const logo = settings?.company_logo;
  return typeof logo === 'string' && DATA_URL.test(logo) ? logo : undefined;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image'));
    img.src = src;
  });
}

/** The picture fitted inside `maxWidth` × `maxHeight` (never enlarged), on white — transparent areas print as paper, not black. */
export function drawOnWhite(img: HTMLImageElement, maxWidth: number, maxHeight: number): HTMLCanvasElement {
  const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** An uploaded image file as a logo data URL: PNG keeps a logo's edges crisp; a photo too big for that goes as JPEG, smaller if need be. */
export async function logoFileToDataUrl(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    for (let side = MAX_SIDE; ; side = Math.round(side * 0.75)) {
      const canvas = drawOnWhite(img, side, side);
      const png = canvas.toDataURL('image/png');
      if (png.length <= MAX_LENGTH) return png;
      const jpeg = canvas.toDataURL('image/jpeg', 0.85);
      if (jpeg.length <= MAX_LENGTH || side < 120) return jpeg;
    }
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Draws the logo on a white tile in a PDF's header, fitted inside
 * `maxWidth` × `maxHeight` points and centred on that box's height. Returns
 * the width it took, 0 with no logo — the header's text starts after it.
 */
export function drawPdfLogo(doc: jsPDF, logo: string | undefined, x: number, y: number, maxWidth: number, maxHeight: number): number {
  if (!logo) return 0;
  try {
    const { width, height } = doc.getImageProperties(logo);
    const pad = 4;
    const scale = Math.min((maxWidth - pad * 2) / width, (maxHeight - pad * 2) / height);
    const w = width * scale;
    const h = height * scale;
    const top = y + (maxHeight - h) / 2;
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, top - pad, w + pad * 2, h + pad * 2, 3, 3, 'F');
    doc.addImage(logo, logo.startsWith('data:image/png') ? 'PNG' : 'JPEG', x + pad, top, w, h, 'company-logo');
    return w + pad * 2;
  } catch {
    return 0; // a logo jsPDF can't read never stops the PDF
  }
}
