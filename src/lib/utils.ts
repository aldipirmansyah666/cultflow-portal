import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Salin teks ke clipboard: Clipboard API dulu, fallback textarea +
 * execCommand untuk insecure context / browser lama. Resolve `true`
 * bila salah satu berhasil, `false` bila semua gagal.
 * TIDAK PERNAH melempar — aman dipanggil dari handler via `void`.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* lanjut ke fallback textarea */
  }
  let ta: HTMLTextAreaElement | null = null;
  try {
    ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    ta?.remove();
  }
}

/**
 * Picu unduhan Blob lintas browser: anchor WAJIB masuk DOM (Safari
 * mengabaikan klik anchor unduhan di luar DOM) dan revoke URL ditunda
 * agar browser sempat mulai mengunduh. TIDAK PERNAH melempar untuk
 * kegagalan DOM; error Blob dibiarkan ke pemanggil bila perlu.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  try {
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
  } finally {
    a.remove();
    // Tunda revoke: revoke sinkron kadang membatalkan unduhan di Safari.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
