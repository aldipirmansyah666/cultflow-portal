/**
 * Generator pesan bagging — 100% identik dengan redaksi otentik
 * `kurlog-operations-portal` (lib/baggingMessage.ts):
 *
 *   {Salam} pak, {maaf}, kami sampaikan ada paket di agen bapak
 *   {namaLoket} pada Tanggal {tanggalTrans} yang belum dibagging ya pak?
 *   {Himbauan}.
 *
 *   Berikut informasi resinya :
 *   {daftarResiLineByLine}
 *
 *   Silahkan abaikan pesan ini apabila sudah melakukan bagging dan apabila
 *   terdapat Pertanyaan / kendala silahkan hubungi nomor
 *   +62 822-1756-9689 / +62 819-1066-6926.
 *   Demi keamanan dan kenyamanan, mohon simpan nomor ini sebagai KONTAK
 *   di HP Anda.
 *
 *   ---
 *   _Ref: BGG-{kodeRef} | {HH:mm} WIB_
 *
 * Salam/maaf/himbauan dipilih acak (anti-spam); kode referensi 6 karakter
 * alfanumerik kapital; waktu footer = jam eksekusi (WIB).
 */

export const SALAM_OPTIONS = [
  "Selamat pagi",
  "Selamat siang",
  "Halo",
  "Semangat pagi",
] as const;

export const MAAF_OPTIONS = [
  "mohon maaf mengganggu waktunya pak",
  "maaf mengganggu waktunya sebentar pak",
  "izin mengganggu waktunya pak",
  "mohon maaf mengganggu aktivitasnya pak",
] as const;

export const HIMBAUAN_OPTIONS = [
  "Mohon dibantu untuk segera dibagging",
  "Boleh dibantu untuk segera diproses bagging ya pak",
  "Mohon bantuannya untuk diproses bagging hari ini",
] as const;

export type SalamOption = (typeof SALAM_OPTIONS)[number];
export type MaafOption = (typeof MAAF_OPTIONS)[number];
export type HimbauanOption = (typeof HIMBAUAN_OPTIONS)[number];

export interface BaggingResiItem {
  resi: string;
  layanan?: string;
}

export interface BuildBaggingMessageParams {
  agenName: string;
  tanggal: string;
  /** Nomor resi (string) atau objek resi (diambil resinya saja). */
  resiList: (string | BaggingResiItem)[];
  salam?: SalamOption;
  maaf?: MaafOption;
  himbauan?: HimbauanOption;
  kodeUnik?: string;
  timeWIB?: string;
  /** Sumber acak (default Math.random). Untuk test deterministik. */
  random?: () => number;
}

/** Alias kompatibilitas dengan pemanggil lama. */
export type BaggingMessageParams = BuildBaggingMessageParams;

type RandomFn = () => number;

/** Ambil satu elemen acak dari array (type-safe). */
export function pickRandom<T>(arr: readonly T[], random: RandomFn = Math.random): T {
  const idx = Math.floor(random() * arr.length);
  return arr[Math.min(idx, arr.length - 1)] as T;
}

const KODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/**
 * Kode unik 6 karakter alfanumerik kapital (cth: 9E5QT3).
 * crypto.getRandomValues bila tersedia (browser), fallback Math.random.
 */
export function generateKodeUnik(length = 6, random: RandomFn = Math.random): string {
  const cryptoObj =
    typeof globalThis !== "undefined" &&
    (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    const values = new Uint32Array(length);
    cryptoObj.getRandomValues(values);
    let out = "";
    for (let i = 0; i < length; i++) {
      out += KODE_ALPHABET[(values[i] as number) % KODE_ALPHABET.length];
    }
    return out;
  }
  let out = "";
  for (let i = 0; i < length; i++) {
    out += KODE_ALPHABET[Math.floor(random() * KODE_ALPHABET.length)];
  }
  return out;
}

/** Jam HH:mm WIB dari timestamp (default: waktu eksekusi saat ini). */
export function formatTimeWIB(now: number = Date.now()): string {
  const wib = new Date(now + 7 * 60 * 60 * 1000);
  const hh = String(wib.getUTCHours()).padStart(2, "0");
  const mm = String(wib.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export interface BaggingMessageParts {
  salam: SalamOption;
  maaf: MaafOption;
  himbauan: HimbauanOption;
  kodeUnik: string;
  timeWIB: string;
}

/** Generate parts acak terpisah (preview/testing). */
export function generateRandomBaggingParts(
  random: RandomFn = Math.random,
  now: number = Date.now()
): BaggingMessageParts {
  return {
    salam: pickRandom(SALAM_OPTIONS, random),
    maaf: pickRandom(MAAF_OPTIONS, random),
    himbauan: pickRandom(HIMBAUAN_OPTIONS, random),
    kodeUnik: generateKodeUnik(6, random),
    timeWIB: formatTimeWIB(now),
  };
}

function normalizeResiList(resiList: (string | BaggingResiItem)[]): string[] {
  const out: string[] = [];
  for (const item of resiList) {
    if (typeof item === "string") {
      const resi = item.trim();
      if (resi !== "") out.push(resi);
    } else if (item && typeof item === "object") {
      const resi = String(item.resi ?? "").trim();
      if (resi !== "") out.push(resi);
    }
  }
  return out;
}

/**
 * Susun pesan bagging WhatsApp redaksi otentik.
 * Bagian tak diisi (salam/maaf/himbauan/kodeUnik/timeWIB) diacak/dibuat otomatis.
 * @throws bila agenName/tanggal kosong atau tak ada resi valid.
 */
export function buildBaggingMessage(params: BuildBaggingMessageParams): string {
  const agenName = params.agenName.trim();
  const tanggal = params.tanggal.trim();
  const random: RandomFn = params.random ?? Math.random;

  if (agenName === "") throw new Error("agenName tidak boleh kosong");
  if (tanggal === "") throw new Error("tanggal tidak boleh kosong");

  const daftar = normalizeResiList(params.resiList);
  if (daftar.length === 0) throw new Error("resiList tidak boleh kosong");

  const salam: SalamOption = params.salam ?? pickRandom(SALAM_OPTIONS, random);
  const maaf: MaafOption = params.maaf ?? pickRandom(MAAF_OPTIONS, random);
  const himbauan: HimbauanOption =
    params.himbauan ?? pickRandom(HIMBAUAN_OPTIONS, random);
  const kodeUnik = params.kodeUnik ?? generateKodeUnik(6, random);
  const timeWIB = params.timeWIB ?? formatTimeWIB(Date.now());

  const daftarResi = daftar.join("\n");

  return (
    `${salam} pak, ${maaf}, kami sampaikan ada paket di agen bapak ${agenName} pada Tanggal ${tanggal} yang belum dibagging ya pak?\n` +
    `${himbauan}.\n\n` +
    `Berikut informasi resinya :\n` +
    `${daftarResi}\n\n` +
    `Silahkan abaikan pesan ini apabila sudah melakukan bagging dan apabila terdapat Pertanyaan / kendala silahkan hubungi nomor +62 822-1756-9689 / +62 819-1066-6926.\n` +
    `Demi keamanan dan kenyamanan, mohon simpan nomor ini sebagai KONTAK di HP Anda.\n\n` +
    `--- \n` +
    `_Ref: BGG-${kodeUnik} | ${timeWIB} WIB_`
  );
}

/**
 * Normalisasi nomor HP Indonesia ke format wa.me (cth: 0812… -> 62812…,
 * +62… -> 62…). "" bila terlalu pendek/tak valid (pemanggil pakai fallback
 * https://wa.me/?text=…).
 */
export function normalizeWaNumber(hp: unknown): string {
  if (typeof hp === "number" && Number.isFinite(hp)) {
    return normalizeWaNumber(String(Math.trunc(hp)));
  }
  if (typeof hp !== "string") return "";
  let digits = hp.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  if (!digits.startsWith("62")) return "";
  if (digits.length < 11 || digits.length > 15) return "";
  return digits;
}

/** URL wa.me: dengan nomor HP bila valid, tanpa nomor bila tidak. */
export function buildBaggingWaUrl(message: string, noHpPemilik: string): string {
  const encoded = encodeURIComponent(message);
  return noHpPemilik === ""
    ? `https://wa.me/?text=${encoded}`
    : `https://wa.me/${noHpPemilik}?text=${encoded}`;
}
