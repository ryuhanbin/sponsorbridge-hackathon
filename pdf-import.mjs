import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { AppError } from './store.mjs';

export const PDF_BYTE_LIMIT = 5 * 1024 * 1024;
export const PDF_PAGE_LIMIT = 30;
export const PROPOSAL_TEXT_LIMIT = 20000;

export async function extractProposalText(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8 || bytes.length > PDF_BYTE_LIMIT) {
    throw new AppError(413, 'Choose a PDF smaller than 5 MB.');
  }
  if (!Buffer.from(bytes.subarray(0, Math.min(1024, bytes.length))).includes('%PDF-')) {
    throw new AppError(400, 'This file does not appear to be a PDF.');
  }
  let task;
  try {
    task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
    const document = await task.promise;
    if (document.numPages > PDF_PAGE_LIMIT) throw new AppError(413, 'This PDF has more than 30 pages. Upload a shorter proposal or paste the relevant text.');
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items.map((item) => `${item.str ?? ''}${item.hasEOL ? '\n' : ' '}`).join('')
        .replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').trim();
      if (pageText) pages.push(pageText);
      page.cleanup();
      if (pages.join('\n\n').length > PROPOSAL_TEXT_LIMIT) {
        throw new AppError(413, 'The PDF contains over 20,000 characters of text. Use a shorter proposal or paste the relevant sections.');
      }
    }
    const text = pages.join('\n\n').trim();
    if (!text) throw new AppError(422, 'No selectable text was found. If this is a scanned PDF, use OCR first or paste the proposal text.');
    return { text, pages: document.numPages };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(422, 'Could not read this PDF. Try another PDF or paste the proposal text.');
  } finally {
    if (task) await task.destroy();
  }
}
