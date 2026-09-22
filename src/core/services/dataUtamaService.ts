import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Service untuk tabel `data_lengkap_utama` (sheet 'Agen CUM').
 * Client-agnostic: terima SupabaseClient browser maupun server.
 */

// ---------------------------------------------------------------------------
// Tipe baris
// ---------------------------------------------------------------------------

export interface DataUtamaRow {
  id: string;
  no: number | null;
  status_syarat: string | null;
  pengajuan_survey: string | null;
  pengajuan_pos: string | null;
  pendaftaran_kurlog: string | null;
  kelengkapan_perangkat: string | null;
  aktivasi_kurlog: string | null;
  aktivasi_sicepat: string | null;
  training: string | null;
  transaksi: string | null;
  catatan: string | null;
  kurlog_pos_ppob: boolean | null;
  kurlog_pos_only: boolean | null;
  kurlog_sicepat: boolean | null;
  ppid: string | null;
  nama_loket_onpays: string | null;
  nama_loket_kurlog: string | null;
  nama_pemilik: string | null;
  alamat_pemilik_ktp: string | null;
  alamat_lengkap_loket: string | null;
  rt_rw: string | null;
  kel_desa: string | null;
  kec: string | null;
  kab_kot: string | null;
  propinsi: string | null;
  kode_pos: string | null;
  no_ktp: string | null;
  no_npwp: string | null;
  electric_area: string | null;
  rekomendasi: string | null;
  no_hp_pemilik: string | null;
  no_hp_loket: string | null;
  email: string | null;
  no_dirian: string | null;
  location_id: string | null;
  user_mile: string | null;
  password_mile: string | null;
  regional: string | null;
  kcu_kc: string | null;
  nib: string | null;
  no_kbli: string | null;
  nomor_rekening: string | null;
  nama_bank: string | null;
  nama_pemilik_rekening: string | null;
  latitude: string | null;
  longitude: string | null;
  kelengkapan_admin_formulir: string | null;
  form_ajuan_pos: string | null;
  pks: string | null;
  doc_ktp: string | null;
  doc_npwp: string | null;
  doc_nib: string | null;
  doc_kbli: string | null;
  foto_tampak_depan_loket: string | null;
  perangkat_komputer_laptop: string | null;
  perangkat_hp_android: string | null;
  perangkat_printer_sticker: string | null;
  perangkat_timbangan_digital: string | null;
  perangkat_kertas_sticker: string | null;
  perangkat_atk_dari_pos: string | null;
  pola_dana: string | null;
  pengganti_nama: string | null;
  pengganti_alamat: string | null;
  pengganti_no_ktp: string | null;
  pengganti_tgl_lahir: string | null;
  pengganti_npwp: string | null;
  pengganti_telp: string | null;
  pengganti_email: string | null;
  pengganti_status: string | null;
  pengganti_catatan: string | null;
  jenis_usaha_kategori: string | null;
  courier_pos: string | null;
  courier_spx: string | null;
  courier_lion_parcel: string | null;
  courier_wahana: string | null;
  courier_jnt_cargo: string | null;
  courier_jnt_express: string | null;
  courier_sicepat: string | null;
  courier_jne: string | null;
  courier_tiki: string | null;
  courier_sap: string | null;
  courier_id_express: string | null;
  courier_anteraja: string | null;
  courier_lex_id: string | null;
  created_at: string | null;
}

export type DataUtamaFieldKey = keyof DataUtamaRow;

// ---------------------------------------------------------------------------
// Metadata kolom untuk drawer detail (dikelompokkan)
// ---------------------------------------------------------------------------

export interface FieldMeta {
  key: DataUtamaFieldKey;
  label: string;
}

export interface FieldGroup {
  title: string;
  fields: FieldMeta[];
}

export const DATA_UTAMA_FIELD_GROUPS: FieldGroup[] = [
  {
    title: "Status & Progres",
    fields: [
      { key: "status_syarat", label: "Status Syarat" },
      { key: "pengajuan_survey", label: "Pengajuan Survey" },
      { key: "pengajuan_pos", label: "Pengajuan POS" },
      { key: "pendaftaran_kurlog", label: "Pendaftaran Kurlog" },
      { key: "kelengkapan_perangkat", label: "Kelengkapan Perangkat" },
      { key: "aktivasi_kurlog", label: "Aktivasi Kurlog" },
      { key: "aktivasi_sicepat", label: "Aktivasi SiCepat" },
      { key: "training", label: "Training" },
      { key: "transaksi", label: "Transaksi" },
      { key: "catatan", label: "Catatan" },
      { key: "kurlog_pos_ppob", label: "Kurlog POS + PPOB" },
      { key: "kurlog_pos_only", label: "Kurlog POS Only" },
      { key: "kurlog_sicepat", label: "Kurlog SiCepat" },
    ],
  },
  {
    title: "Identitas Loket",
    fields: [
      { key: "no", label: "No" },
      { key: "ppid", label: "PPID" },
      { key: "nama_loket_onpays", label: "Nama Loket OnPays" },
      { key: "nama_loket_kurlog", label: "Nama Loket Kurlog" },
      { key: "nama_pemilik", label: "Nama Pemilik" },
      { key: "jenis_usaha_kategori", label: "Jenis Usaha / Kategori" },
      { key: "regional", label: "Regional" },
      { key: "kcu_kc", label: "KCU / KC" },
      { key: "rekomendasi", label: "Rekomendasi" },
      { key: "electric_area", label: "Electric Area" },
    ],
  },
  {
    title: "Alamat & Lokasi",
    fields: [
      { key: "alamat_pemilik_ktp", label: "Alamat Pemilik (KTP)" },
      { key: "alamat_lengkap_loket", label: "Alamat Lengkap Loket" },
      { key: "rt_rw", label: "RT / RW" },
      { key: "kel_desa", label: "Kel / Desa" },
      { key: "kec", label: "Kecamatan" },
      { key: "kab_kot", label: "Kab / Kota" },
      { key: "propinsi", label: "Propinsi" },
      { key: "kode_pos", label: "Kode Pos" },
      { key: "latitude", label: "Latitude" },
      { key: "longitude", label: "Longitude" },
    ],
  },
  {
    title: "Dokumen & Legalitas",
    fields: [
      { key: "no_ktp", label: "No KTP" },
      { key: "no_npwp", label: "No NPWP" },
      { key: "nib", label: "NIB" },
      { key: "no_kbli", label: "No KBLI" },
      { key: "kelengkapan_admin_formulir", label: "Kelengkapan Admin Formulir" },
      { key: "form_ajuan_pos", label: "Form Ajuan POS" },
      { key: "pks", label: "PKS" },
      { key: "doc_ktp", label: "Doc KTP" },
      { key: "doc_npwp", label: "Doc NPWP" },
      { key: "doc_nib", label: "Doc NIB" },
      { key: "doc_kbli", label: "Doc KBLI" },
      { key: "foto_tampak_depan_loket", label: "Foto Tampak Depan Loket" },
    ],
  },
  {
    title: "Kontak",
    fields: [
      { key: "no_hp_pemilik", label: "No HP Pemilik" },
      { key: "no_hp_loket", label: "No HP Loket" },
      { key: "email", label: "Email" },
    ],
  },
  {
    title: "Akun & Sistem",
    fields: [
      { key: "no_dirian", label: "No Dirian" },
      { key: "location_id", label: "Location ID" },
      { key: "user_mile", label: "User Mile" },
      { key: "password_mile", label: "Password Mile" },
    ],
  },
  {
    title: "Rekening & Dana",
    fields: [
      { key: "nomor_rekening", label: "Nomor Rekening" },
      { key: "nama_bank", label: "Nama Bank" },
      { key: "nama_pemilik_rekening", label: "Nama Pemilik Rekening" },
      { key: "pola_dana", label: "Pola Dana" },
    ],
  },
  {
    title: "Perangkat",
    fields: [
      { key: "perangkat_komputer_laptop", label: "Komputer / Laptop" },
      { key: "perangkat_hp_android", label: "HP Android" },
      { key: "perangkat_printer_sticker", label: "Printer Sticker" },
      { key: "perangkat_timbangan_digital", label: "Timbangan Digital" },
      { key: "perangkat_kertas_sticker", label: "Kertas Sticker" },
      { key: "perangkat_atk_dari_pos", label: "ATK dari POS" },
    ],
  },
  {
    title: "Data Pengganti",
    fields: [
      { key: "pengganti_nama", label: "Nama Pengganti" },
      { key: "pengganti_alamat", label: "Alamat Pengganti" },
      { key: "pengganti_no_ktp", label: "No KTP Pengganti" },
      { key: "pengganti_tgl_lahir", label: "Tgl Lahir Pengganti" },
      { key: "pengganti_npwp", label: "NPWP Pengganti" },
      { key: "pengganti_telp", label: "Telp Pengganti" },
      { key: "pengganti_email", label: "Email Pengganti" },
      { key: "pengganti_status", label: "Status Pengganti" },
      { key: "pengganti_catatan", label: "Catatan Pengganti" },
    ],
  },
  {
    title: "Kurir Aktif",
    fields: [
      { key: "courier_pos", label: "POS" },
      { key: "courier_spx", label: "SPX" },
      { key: "courier_lion_parcel", label: "Lion Parcel" },
      { key: "courier_wahana", label: "Wahana" },
      { key: "courier_jnt_cargo", label: "JNT Cargo" },
      { key: "courier_jnt_express", label: "J&T Express" },
      { key: "courier_sicepat", label: "SiCepat" },
      { key: "courier_jne", label: "JNE" },
      { key: "courier_tiki", label: "TIKI" },
      { key: "courier_sap", label: "SAP" },
      { key: "courier_id_express", label: "ID Express" },
      { key: "courier_anteraja", label: "AnterAja" },
      { key: "courier_lex_id", label: "LEX ID" },
    ],
  },
  {
    title: "Meta",
    fields: [
      { key: "id", label: "ID" },
      { key: "created_at", label: "Dibuat Pada" },
    ],
  },
];

/** Jumlah bidang yang dirender drawer detail. */
export const DATA_UTAMA_FIELD_COUNT = DATA_UTAMA_FIELD_GROUPS.reduce(
  (n, g) => n + g.fields.length,
  0
);

// ---------------------------------------------------------------------------
// Error handling Supabase (RLS vs kolom hilang) + log konsol
// ---------------------------------------------------------------------------

export type SupabaseErrorKind =
  | "rls"
  | "missing-column"
  | "missing-table"
  | "other";

export interface ClassifiedSupabaseError {
  kind: SupabaseErrorKind;
  code: string;
  message: string;
  remediation: string;
}

interface SupabaseErrorLike {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
}

const REMEDIATIONS: Record<SupabaseErrorKind, string> = {
  rls: "Periksa RLS policy SELECT untuk role pemanggil (anon/authenticated) atau pakai service_role di sisi server.",
  "missing-column":
    "Terapkan migrasi penyelarasan (20260923000000_align_data_lengkap_utama_v2.sql) lalu tunggu refresh schema cache ±60 detik.",
  "missing-table":
    "Jalankan migrasi init (20260921000000_init_schema.sql) di database target.",
  other: "Lihat detail error di bawah.",
};

/**
 * Klasifikasikan error PostgREST/RLS agar UI/log tahu akar masalah:
 * RLS/permission (42501, policy, JWT) vs kolom hilang (PGRST204, 42703)
 * vs tabel hilang (42P01).
 */
export function classifySupabaseError(
  error: SupabaseErrorLike | null | undefined
): ClassifiedSupabaseError {
  const code = typeof error?.code === "string" ? error.code : "";
  const upperCode = code.toUpperCase();
  const text = [error?.message, error?.details, error?.hint]
    .filter((v): v is string => typeof v === "string")
    .join(" | ");
  const message =
    (typeof error?.message === "string" && error.message) ||
    "Supabase query gagal tanpa pesan.";

  if (
    upperCode === "42501" ||
    upperCode === "PGRST301" ||
    /permission denied|row-level security|not authorized|jwt/i.test(
      `${code} ${text}`
    )
  ) {
    return { kind: "rls", code, message, remediation: REMEDIATIONS.rls };
  }
  if (
    upperCode === "PGRST204" ||
    upperCode === "42703" ||
    /schema cache|could not find|column .* does not exist/i.test(text)
  ) {
    return {
      kind: "missing-column",
      code,
      message,
      remediation: REMEDIATIONS["missing-column"],
    };
  }
  if (
    upperCode === "42P01" ||
    /relation .* does not exist/i.test(text)
  ) {
    return {
      kind: "missing-table",
      code,
      message,
      remediation: REMEDIATIONS["missing-table"],
    };
  }
  return { kind: "other", code, message, remediation: REMEDIATIONS.other };
}

/**
 * Log konsol terstruktur untuk error Supabase (dipanggil sebelum throw
 * agar akar masalah RLS/kolom-hilang terekam) + kembalikan klasifikasinya.
 */
export function logSupabaseError(
  context: string,
  error: SupabaseErrorLike | null | undefined
): ClassifiedSupabaseError {
  const classified = classifySupabaseError(error);
  console.error(`[data-utama:${context}] Supabase error (${classified.kind})`, {
    code: classified.code || "(tanpa kode)",
    message: classified.message,
    details:
      typeof error?.details === "string" && error.details !== ""
        ? error.details
        : undefined,
    remediation: classified.remediation,
  });
  return classified;
}

// ---------------------------------------------------------------------------
// Query list: paginasi + pencarian + filter regional
// ---------------------------------------------------------------------------

export interface DataUtamaListParams {
  search?: string;
  regional?: string;
  page?: number;
  pageSize?: number;
}

export interface DataUtamaListResult {
  data: DataUtamaRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Kolom yang dicari oleh pencarian real-time. */
const SEARCH_COLUMNS = [
  "nama_loket_kurlog",
  "nama_loket_onpays",
  "ppid",
  "nama_pemilik",
] as const;

/**
 * Sanitasi kata kunci untuk pola `or/ilike` PostgREST:
 * buang koma (pemisah kondisi) dan karakter wildcard.
 */
export function sanitizeSearch(raw: string): string {
  return raw
    .replace(/[%_,()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

export async function getDataUtamaList(
  client: SupabaseClient,
  params: DataUtamaListParams = {}
): Promise<DataUtamaListResult> {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(params.pageSize ?? DEFAULT_PAGE_SIZE))
  );

  // Sengaja SELECT * (bukan daftar kolom): daftar kolom eksplisit yang
  // memuat nama kolom undefined/ganda akan membuat PostgREST 400;
  // `*` selalu valid dan mengikuti skema hasil migrasi penyelarasan.
  let query = client
    .from("data_lengkap_utama")
    .select("*", { count: "exact" });

  const search = sanitizeSearch(params.search ?? "");
  if (search !== "") {
    const pattern = `%${search}%`;
    query = query.or(
      SEARCH_COLUMNS.map((col) => `${col}.ilike.${pattern}`).join(",")
    );
  }

  const regional = (params.regional ?? "").trim();
  if (regional !== "" && regional !== "SEMUA") {
    query = query.eq("regional", regional);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    logSupabaseError("list", error);
    throw error;
  }

  // count exact dari PostgREST = total SEMUA baris cocok (abaikan range),
  // sehingga total & totalPages konsisten di semua halaman.
  const total = Math.max(0, count ?? 0);
  return {
    data: (data ?? []) as DataUtamaRow[],
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Daftar opsi regional unik (untuk dropdown filter), terurut abjad. */
export async function getRegionalOptions(
  client: SupabaseClient
): Promise<string[]> {
  const { data, error } = await client
    .from("data_lengkap_utama")
    .select("regional")
    .not("regional", "is", null)
    .limit(5000);

  if (error) {
    logSupabaseError("regional-options", error);
    throw error;
  }

  const set = new Set<string>();
  for (const row of data ?? []) {
    const value = String(
      (row as { regional: unknown }).regional ?? ""
    ).trim();
    if (value !== "") set.add(value);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "id"));
}

// ---------------------------------------------------------------------------
// Lookup profil agen (halaman /lookup-agen)
// ---------------------------------------------------------------------------

export interface AgenSuggestItem {
  ppid: string;
  nama: string;
}

export interface AgenProfile {
  ppid: string;
  nopend: string;
  idLoc: string;
  user: string;
  pass: string;
  namaAgenpos: string;
  alamatAgenpos: string;
  kelurahan: string;
  kecamatan: string;
  kotaKab: string;
  namaPemilik: string;
  noHandphone: string;
  email: string;
  nik: string;
  npwp: string;
}

const PROFILE_LOOKUP_COLUMNS = [
  "nama_loket_kurlog",
  "nama_loket_onpays",
  "ppid",
] as const;

function textOrEmpty(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== "string") return "";
  return value.trim();
}

/**
 * Petakan baris DB ke profil form PosIND.
 * user = user_mile (fallback email), nama = loket kurlog (fallback onpays).
 */
export function toAgenProfile(row: DataUtamaRow): AgenProfile {
  const namaAgenpos =
    textOrEmpty(row.nama_loket_kurlog) || textOrEmpty(row.nama_loket_onpays);
  return {
    ppid: textOrEmpty(row.ppid),
    nopend: textOrEmpty(row.no_dirian),
    idLoc: textOrEmpty(row.location_id),
    user: textOrEmpty(row.user_mile) || textOrEmpty(row.email),
    pass: textOrEmpty(row.password_mile),
    namaAgenpos,
    alamatAgenpos: textOrEmpty(row.alamat_lengkap_loket),
    kelurahan: textOrEmpty(row.kel_desa),
    kecamatan: textOrEmpty(row.kec),
    kotaKab: textOrEmpty(row.kab_kot),
    namaPemilik: textOrEmpty(row.nama_pemilik),
    noHandphone: textOrEmpty(row.no_hp_pemilik),
    email: textOrEmpty(row.email),
    nik: textOrEmpty(row.no_ktp),
    npwp: textOrEmpty(row.no_npwp),
  };
}

/**
 * Auto-suggest real-time: cocokkan PPID / nama loket (ilike),
 * maksimal `limit` baris, dedup berdasarkan ppid||nama.
 */
export async function suggestAgen(
  client: SupabaseClient,
  keyword: string,
  limit = 8
): Promise<AgenSuggestItem[]> {
  const q = sanitizeSearch(keyword);
  if (q === "") return [];
  const pattern = `%${q}%`;

  const { data, error } = await client
    .from("data_lengkap_utama")
    .select("ppid,nama_loket_kurlog,nama_loket_onpays")
    .or(
      PROFILE_LOOKUP_COLUMNS.map((col) => `${col}.ilike.${pattern}`).join(",")
    )
    .limit(Math.min(20, Math.max(1, limit)));

  if (error) {
    logSupabaseError("suggest", error);
    throw error;
  }

  const seen = new Set<string>();
  const out: AgenSuggestItem[] = [];
  for (const r of (data ?? []) as Partial<DataUtamaRow>[]) {
    const ppid = textOrEmpty(r.ppid);
    const nama =
      textOrEmpty(r.nama_loket_kurlog) || textOrEmpty(r.nama_loket_onpays);
    const key = `${ppid}||${nama}`;
    if ((ppid === "" && nama === "") || seen.has(key)) continue;
    seen.add(key);
    out.push({ ppid, nama: nama === "" ? ppid : nama });
  }
  return out;
}

/**
 * Lookup profil: PPID persis (case-insensitive) dulu, lalu fallback
 * parsial PPID/nama. Kembalikan null bila tidak ada yang cocok.
 */
export async function lookupAgenByPpid(
  client: SupabaseClient,
  ppid: string
): Promise<DataUtamaRow | null> {
  const key = sanitizeSearch(ppid);
  if (key === "") return null;

  const exact = await client
    .from("data_lengkap_utama")
    .select("*")
    .ilike("ppid", key)
    .limit(1);
  if (exact.error) {
    logSupabaseError("lookup-exact", exact.error);
    throw exact.error;
  }
  const exactRows = (exact.data ?? []) as DataUtamaRow[];
  if (exactRows.length > 0 && exactRows[0]) return exactRows[0];

  const pattern = `%${key}%`;
  const fuzzy = await client
    .from("data_lengkap_utama")
    .select("*")
    .or(
      PROFILE_LOOKUP_COLUMNS.map((col) => `${col}.ilike.${pattern}`).join(",")
    )
    .limit(1);
  if (fuzzy.error) {
    logSupabaseError("lookup-fuzzy", fuzzy.error);
    throw fuzzy.error;
  }
  const fuzzyRows = (fuzzy.data ?? []) as DataUtamaRow[];
  return fuzzyRows.length > 0 && fuzzyRows[0] ? fuzzyRows[0] : null;
}

const WA_DASH = "------------------------------";

function waVal(value: string): string {
  return value === "" ? "-" : value;
}

/**
 * Teks format WhatsApp profil agen (cermin field card PosIND).
 * Nilai kosong diganti "-".
 */
export function buildLookupWaText(profile: AgenProfile): string {
  return [
    "*PROFIL AGENPOS - PosIND*",
    WA_DASH,
    `PPID: ${waVal(profile.ppid)}`,
    `Nopend/Kode Dirian: ${waVal(profile.nopend)}`,
    `IdLoc: ${waVal(profile.idLoc)}`,
    `User: ${waVal(profile.user)}`,
    `Pass: ${waVal(profile.pass)}`,
    `Nama Agenpos: ${waVal(profile.namaAgenpos)}`,
    `Alamat Agenpos: ${waVal(profile.alamatAgenpos)}`,
    `Kelurahan: ${waVal(profile.kelurahan)}`,
    `Kecamatan: ${waVal(profile.kecamatan)}`,
    `Kota/Kab: ${waVal(profile.kotaKab)}`,
    `Nama Pemilik/Pengelola: ${waVal(profile.namaPemilik)}`,
    `No Handphone: ${waVal(profile.noHandphone)}`,
    `Email: ${waVal(profile.email)}`,
    `NIK: ${waVal(profile.nik)}`,
    `NPWP: ${waVal(profile.npwp)}`,
    WA_DASH,
  ].join("\n");
}
