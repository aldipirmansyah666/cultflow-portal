/**
 * Validasi berkas upload — port dari `kurlog-operations-portal`
 * (lib/fileValidation.ts).
 */

export const MAX_EXCEL_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export function validateFileSize(
  file: File,
  maxBytes = MAX_EXCEL_SIZE_BYTES
): string | null {
  if (file.size > maxBytes) {
    return `File "${file.name}" terlalu besar (${(file.size / 1024 / 1024).toFixed(2)} MB). Maksimal ${(maxBytes / 1024 / 1024).toFixed(0)} MB.`;
  }
  if (file.size === 0) return `File "${file.name}" kosong.`;
  return null;
}

export function validateExcelMagicBytes(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer.slice(0, 8));

  // 1. XLSX (ZIP: PK..)
  const isXlsx = bytes[0] === 0x50 && bytes[1] === 0x4b;
  // 2. XLS biner (OLE2)
  const isXlsBinary = bytes[0] === 0xd0 && bytes[1] === 0xcf;

  if (isXlsx || isXlsBinary) return true;

  // 3. Fallback ketat: export HTML/XML table atau CSV-like yang bermakna
  try {
    if (buffer.byteLength < 50) return false;
    const textPreview = new TextDecoder("utf-8")
      .decode(buffer.slice(0, 1024))
      .toLowerCase();
    const isHtmlExport =
      textPreview.includes("<html") ||
      textPreview.includes("<?xml") ||
      textPreview.includes("<table");
    if (isHtmlExport) return true;
    const hasDelimiter =
      textPreview.includes(",") || textPreview.includes("\t");
    const hasNewline = textPreview.includes("\n");
    const looksLikeCsv =
      hasDelimiter &&
      hasNewline &&
      /[a-z]/i.test(textPreview) &&
      textPreview.split("\n").filter((l) => l.trim()).length >= 2;
    return looksLikeCsv;
  } catch {
    return false;
  }
}

/** Kompatibilitas: null = valid, string = pesan error. */
export function validateExcelMagicBytesLegacy(
  buffer: ArrayBuffer
): string | null {
  return validateExcelMagicBytes(buffer)
    ? null
    : "Format file tidak valid. Harap upload file Excel (.xlsx/.xls) yang sah.";
}

/** Alias boolean check. */
export function isValidExcelMagicBytes(buffer: ArrayBuffer): boolean {
  return validateExcelMagicBytes(buffer);
}
