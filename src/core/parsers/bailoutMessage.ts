/**
 * Template pesan bailout Sunda-formal — port dari `kurlog-operations-portal`
 * (app/bailout/page.tsx: buildMessage + formatIDCurrency + formatIDDate +
 * AGENT_DISPLAY_NAMES + WEEKEND_EXCLUDED_AGENTS).
 *
 * Aturan tanggal: input TANGGAL REDAKSI hanya menentukan template
 * Weekday/Weekend (getDay dari input), sedangkan tanggal cetak di teks
 * redaksi WAJIB H-1 dari input (minusDate).
 */

export const INDONESIAN_MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
] as const;

export function formatIDDate(date: Date): string {
  return `${date.getDate()} ${INDONESIAN_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatIDCurrency(value: number): string {
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString("id-ID");
  return value < 0 ? `Rp - ${formatted}` : `Rp ${formatted}`;
}

/** Agen yang tetap memakai template weekday meski tanggal redaksi weekend. */
export const WEEKEND_EXCLUDED_AGENTS = ["TRINERGI UTAMA JAYA"];

/** Sapaan personal per agen (fallback: nama asli). */
export const AGENT_DISPLAY_NAMES: Record<string, string> = {
  "CV. MITRA PERDANA INDONESIA (MPI)": "Kang Diwa & Mas Endi",
  "CV. ANEKA JASA": "PT.ANEKA JASA",
  "CV. DRAGO MULTIMEDIA JASALINDO - DRAGO": "Kang Deni",
  "PT. TRINERGI UTAMA JAYA - TUJ": "Pak Doni & Bu Faradina",
  "HAFSAH & BROTHERS": "Team HAFSAH & BROTHERS",
  DIKASA: "Pak Erwin",
  "MAJU BERSAMA SUMBAWA (MBS)": "MAJU BERSAMA SUMBAWA (MBS)",
  HAIFA: "Bang Hairul",
  "LOMBOQ TATAS": "Team LOMBOQ TATAS",
  "REJEKI UNTUK ANAK (RUA)": "Pak Eko & Bu Nita",
  AGUSONO: "Pak Agusono",
  "BMAX CPY": "Pak Arif",
  "TEGAR MANDIRI": "Team Tegar Mandiri",
  "PT. TRINERGI UTAMA JAYA - TUJ MBI": "Mitra MBI",
  "BERKAH JAYA ELEKTRIK (BJE)": "Pak Arie dan Bu Puji",
  GUNUNGRAYA: "Mitra Pak Wiroyo",
  FAYAZA: "Bang Mawardi",
  "ABDUL AJI": "Pak Abdul Aji",
  "KANZUL HAKIKI": "Mitra Kanzul Hakiki",
  BSL: "Pak Maksum",
  "BERKAH SOFIE": "Pak Ciptadi",
};

export function getBailoutDisplayName(nama: string): string {
  return AGENT_DISPLAY_NAMES[nama] ?? nama;
}

/** Tanggal redaksi default: kemarin (H-1) dalam ISO YYYY-MM-DD. */
export function defaultRedaksiDateISO(now: Date = new Date()): string {
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const y = yesterday.getFullYear();
  const m = String(yesterday.getMonth() + 1).padStart(2, "0");
  const d = String(yesterday.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Susun pesan bailout untuk satu agen.
 * @param nama nama agen (kunci sapaan personal)
 * @param amount nominal minus (negatif = minus)
 * @param redaksiDateISO tanggal redaksi ISO YYYY-MM-DD (default H-1 hari ini)
 */
export function buildBailoutMessage(
  nama: string,
  amount: number,
  redaksiDateISO: string = defaultRedaksiDateISO()
): string {
  const displayName = getBailoutDisplayName(nama);
  const selectedDate = new Date(`${redaksiDateISO}T00:00:00`);
  const isValidSelected = !isNaN(selectedDate.getTime());
  const isWeekend =
    isValidSelected &&
    (selectedDate.getDay() === 0 || selectedDate.getDay() === 6);
  const minusDate = isValidSelected ? new Date(selectedDate) : new Date();
  minusDate.setDate(minusDate.getDate() - 1);
  const dateStr = formatIDDate(minusDate);

  const header =
    "Assalamu'alaikum Warahmatullahi Wabarakatuh,\n" +
    `Dear ${displayName}\n\n` +
    `Berikut kami sampaikan minus pada tanggal ${dateStr} sebesar ${formatIDCurrency(amount)}`;

  const isExcluded = WEEKEND_EXCLUDED_AGENTS.some((agent) =>
    nama.toUpperCase().includes(agent.toUpperCase())
  );

  if (isWeekend && !isExcluded) {
    return (
      `${header}\n\n` +
      "Mohon bantuan pelimpahannya (setor ke bank jika memungkinkan atau via internet banking) untuk menghindari penumpukan di hari Senin.\n\n" +
      "Hatur Nuhun \u{1F64F}\n" +
      "Semoga kita semua selalu di berikan kesehatan & selalu dalam lindunganNya..\n" +
      "Aamiin"
    );
  }

  return (
    `${header}\n\n` +
    "Mohon bantuan pelimpahannya sebelum pukul 09.00 WIB.\n\n" +
    "Hatur Nuhun \u{1F64F}\n" +
    "Semoga kita semua selalu di berikan kesehatan & selalu dalam lindunganNya.\n" +
    "Aamiin"
  );
}
