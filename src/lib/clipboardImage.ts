/**
 * Utilitas "Salin Gambar" — merender elemen DOM menjadi PNG lalu
 * menyalinnya ke clipboard sebagai `image/png`.
 *
 * Catatan kompatibilitas (dasar: MDN Clipboard API + WebKit bug #244812):
 * - `navigator.clipboard.write()` hanya boleh dipanggil di dalam user
 *   gesture. WebKit (Safari) membatalkan aktivasi begitu ada `await` di
 *   tengah handler, sehingga pola "render dulu → await → tulis" SELALU
 *   gagal di Safari dengan `NotAllowedError`.
 * - Solusinya: teruskan `Promise<Blob>` ke `ClipboardItem` dan biarkan
 *   browser yang me-resolve-nya. Panggilan `clipboard.write()` sendiri
 *   tetap dilakukan SINKRON di dalam handler klik.
 * - Chromium & Firefox menerima `Blob` yang sudah ter-resolve, sehingga
 *   jalur blob dipakai sebagai fallback bila konstruktor `ClipboardItem`
 *   atau `write()` menolaknya.
 */

/** Alasan kenapa "Salin Gambar" tidak bisa dilakukan di browser ini. */
export type ClipboardImageBlock =
  | "insecure-context"
  | "no-clipboard-api"
  | "no-clipboard-item"
  | "no-image-png"
  | "hidden-document";

/** Error terstruktur agar UI bisa memetakan ke pesan yang actionable. */
export class ClipboardImageError extends Error {
  readonly block: ClipboardImageBlock | "failed";

  constructor(message: string, block: ClipboardImageBlock | "failed" = "failed") {
    super(message);
    this.name = "ClipboardImageError";
    this.block = block;
  }
}

/** Class elemen berisi tabel yang harus dibentangkan saat dirender. */
export const EXPANDABLE_SCROLL_CLASS = "rincian-scroll";

/**
 * Deteksi kemampuan menyalin gambar. Mengembalikan `null` bila aman
 * mencoba. Sengaja TIDAK mengecek `document.hasFocus()`: nilainya `false`
 * saat DevTools fokus sehingga mem-block salin secara keliru.
 */
export function detectClipboardImageBlock(): ClipboardImageBlock | null {
  if (typeof window === "undefined") return "no-clipboard-api";
  if (typeof window.isSecureContext === "boolean" && !window.isSecureContext) {
    return "insecure-context";
  }
  const clipboard = navigator.clipboard;
  if (!clipboard || typeof clipboard.write !== "function") {
    return "no-clipboard-api";
  }
  const ItemCtor = window.ClipboardItem;
  if (!ItemCtor) return "no-clipboard-item";
  if (typeof ItemCtor.supports === "function" && !ItemCtor.supports("image/png")) {
    return "no-image-png";
  }
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return "hidden-document";
  }
  return null;
}

/** Pesan ramah + saran alternatif (Download PNG) untuk tiap blokir. */
export function clipboardImageBlockMessage(block: ClipboardImageBlock): string {
  switch (block) {
    case "insecure-context":
      return "Salin gambar butuh koneksi HTTPS (bukan http://). Gunakan “Download PNG”.";
    case "no-clipboard-api":
      return "Clipboard tidak tersedia di browser ini. Gunakan “Download PNG”.";
    case "no-clipboard-item":
      return "Browser ini tidak mendukung ClipboardItem. Gunakan “Download PNG”.";
    case "no-image-png":
      return "Browser ini tidak mendukung clipboard image/png. Gunakan “Download PNG”.";
    case "hidden-document":
      return "Tab ini sedang tersembunyi. Kembali ke halaman lalu ulangi, atau gunakan “Download PNG”.";
  }
}

/**
 * Bentangkan kontainer scroll internal (class `.rincian-scroll`) agar
 * seluruh isi ikut ter-render — tanpa ini, gambar hanya berisi 480px
 * pertama karena `html-to-image` mengukur tinggi node lewat `clientHeight`.
 * Mengembalikan fungsi untuk mengembalikan gaya asli (persis).
 */
export function expandScrollableRegions(
  node: HTMLElement,
  selector: string = `.${EXPANDABLE_SCROLL_CLASS}`
): () => void {
  const scrollers = Array.from(node.querySelectorAll<HTMLElement>(selector));
  const saved = scrollers.map((el) => ({
    el,
    maxHeight: el.style.maxHeight,
    height: el.style.height,
    overflow: el.style.overflow,
  }));
  for (const el of scrollers) {
    // Inline menimpa class Tailwind `max-h-[480px]` + `overflow-auto`.
    el.style.maxHeight = "none";
    el.style.height = "auto";
    el.style.overflow = "visible";
  }
  // Paksa layout dihitung ulang agar `clientHeight` terbaca sesuai.
  void node.getBoundingClientRect();
  return () => {
    for (const s of saved) {
      s.el.style.maxHeight = s.maxHeight;
      s.el.style.height = s.height;
      s.el.style.overflow = s.overflow;
    }
  };
}

/** Tunggu satu frame agar layout final ter-flush sebelum dirender. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 16);
    }
  });
}

export interface RenderPngOptions {
  pixelRatio?: number;
  backgroundColor?: string;
  /**
   * Margin putih (px) di sekeliling konten pada hasil gambar — supaya
   * slip rapi saat ditempel ke WhatsApp/Telegram/Excel.
   *
   * CATATAN TEKNIS: `html-to-image` menyalin *content-box* width/height
   * dari node asli ke klon. Menambahkan padding langsung ke klon akan
   * memampatkan area konten (teks bisa terpotong di bawah). Karena itu
   * dimensi viewport SVG dinaikkan sebesar 2×padding dan klon dipaksa
   * `box-sizing: border-box` — hasilnya: konten tetap berukuran asli,
   * dikelilingi margin putih yang rata.
   */
  padding?: number;
  /**
   * Gaya tambahan yang disalin ke node hasil render (mis. warna latar).
   */
  style?: Record<string, string>;
}

/**
 * Render elemen DOM menjadi Blob PNG (client-side, tanpa jaringan).
 * Type blob dijamin `image/png` agar cocok dengan kunci ClipboardItem.
 */
export async function renderNodeToPngBlob(
  node: HTMLElement,
  options: RenderPngOptions = {}
): Promise<Blob> {
  const { toBlob } = await import("html-to-image");
  await nextFrame();

  const padding = Math.max(0, options.padding ?? 0);
  const style: Record<string, string> = { ...(options.style ?? {}) };
  let width: number | undefined;
  let height: number | undefined;
  if (padding > 0) {
    width = node.clientWidth + padding * 2;
    height = node.clientHeight + padding * 2;
    style.padding = `${padding}px`;
    style.boxSizing = "border-box";
  }

  const blob = await toBlob(node, {
    cacheBust: true,
    pixelRatio: options.pixelRatio ?? 2,
    backgroundColor: options.backgroundColor ?? "#ffffff",
    ...(width !== undefined && height !== undefined ? { width, height } : {}),
    ...(Object.keys(style).length > 0
      ? { style: style as Partial<CSSStyleDeclaration> }
      : {}),
  });
  if (!blob) {
    throw new ClipboardImageError("Render slip menghasilkan gambar kosong.", "failed");
  }
  if (blob.type === "image/png") return blob;
  return new Blob([blob], { type: "image/png" });
}

/**
 * Tulis PNG ke clipboard.
 *
 * PENTING: `navigator.clipboard.write()` dipanggil SYNCHRON di dalam
 * fungsi ini (tanpa `await` sebelumnya) agar user activation WebKit
 * belum kedaluwarsa. `blobPromise` sudah dimulai oleh pemanggil.
 */
export async function copyPngToClipboard(blobPromise: Promise<Blob>): Promise<void> {
  const clipboard = navigator.clipboard;
  if (!clipboard || typeof clipboard.write !== "function") {
    throw new ClipboardImageError("Clipboard tidak tersedia di browser ini.", "no-clipboard-api");
  }
  const ItemCtor = typeof window !== "undefined" ? window.ClipboardItem : undefined;
  if (!ItemCtor) {
    throw new ClipboardImageError("ClipboardItem tidak didukung browser ini.", "no-clipboard-item");
  }
  if (typeof ItemCtor.supports === "function" && !ItemCtor.supports("image/png")) {
    throw new ClipboardImageError(
      "Clipboard image/png tidak didukung browser ini.",
      "no-image-png"
    );
  }

  // Jalur utama: Promise<Blob> di dalam ClipboardItem — satu-satunya
  // cara yang lolos di Safari/WebKit.
  let item: ClipboardItem;
  try {
    item = new ItemCtor({ "image/png": blobPromise });
  } catch {
    // Engine yang tidak menerima ClipboardItem berbasis Promise.
    item = new ItemCtor({ "image/png": await blobPromise });
  }

  try {
    await clipboard.write([item]);
  } catch (err) {
    // Sebagian engine menolak item berbasis Promise saat `write()`;
    // coba lagi dengan Blob final (hanya andal di Chromium/Firefox).
    if (!(err instanceof TypeError)) throw err;
    const blob = await blobPromise;
    await clipboard.write([new ItemCtor({ "image/png": blob })]);
  }
}

/**
 * Ubah error apa pun menjadi pesan yang bisa ditindaklanjuti user.
 */
export function describeClipboardImageError(err: unknown): string {
  if (err instanceof ClipboardImageError) return err.message;
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (name === "NotAllowedError") {
    return "Browser menolak akses clipboard (izin ditolak atau halaman tidak fokus). Klik lagi pada halaman lalu ulangi, atau gunakan “Download PNG”.";
  }
  if (name === "TypeError") {
    return "Format gambar tidak bisa ditulis ke clipboard. Gunakan “Download PNG”.";
  }
  return `Gagal menyalin gambar: ${message || "terjadi kesalahan"}. Gunakan “Download PNG”.`;
}
