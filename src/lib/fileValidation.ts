/**
 * Validasi berkas upload — port dari `kurlog-operations-portal`
 * (lib/fileValidation.ts).
 */

export const MAX_EXCEL_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Batas khusus Rekap Fee Loket: 15 MB (rekap bulanan ±9 MB + headroom).
 * Scope terbatas fee-rekap saja — fitur lain (bagging/bailout/data-utama)
 * tetap 5 MB. Aman untuk server karena impor fee dikirim chunked
 * 500 baris/request (lihat saveFeeImport), bukan 1 payload raksasa.
 */
export const MAX_FEE_EXCEL_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * Batas khusus Reconcile Validator: 15 MB (berkas rekon ±20.000 baris
 * ≈ 2–4 MB, jadi headroom 15 MB lega).
 *
 * Wajib: modul reconcile membaca berkas sepenuhnya ke memori
 * (`file.arrayBuffer()` + matriks exceljs). Tanpa batas, satu file
 * ratusan MB bisa menghabiskan heap browser → tab crash (Aw, Snap)
 * tanpa pesan error yang bisa dibaca user.
 */
export const MAX_RECONCILE_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * Ambang peringatan dini Reconcile: berkas < 1.000 KB (1 MB desimal) sering
 * berarti ekspor belum lengkap. Ini hanya warning, bukan penolakan upload.
 */
export const RECONCILE_SMALL_FILE_WARNING_BYTES = 1000 * 1024;

/**
 * Peringatan non-blocking untuk berkas Reconcile yang terlalu kecil.
 * Null bila ukuran sudah memadai atau file kosong (file kosong ditangani
 * sebagai error oleh validateFileSize).
 */
export function getReconcileFileSizeWarning(
  file: Pick<File, "name" | "size">
): string | null {
  if (
    file.size <= 0 ||
    file.size >= RECONCILE_SMALL_FILE_WARNING_BYTES
  ) {
    return null;
  }

  const sizeKb = Math.max(1, Math.floor(file.size / 1024));
  return `Peringatan: Ukuran berkas "${file.name}" kurang dari 1.000 KB (${sizeKb} KB, di bawah 1 MB). Harap periksa kembali berkas Anda, jumlah resi mungkin belum sesuai atau belum lengkap.`;
}

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

  // 1. XLSX/XLSM/XLSB (kontainer ZIP/OPC: PK.. — .xlsb BIFF12 juga ZIP)
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
