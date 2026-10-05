"use client";

/**
 * Rekapitulasi Fee Loket/Agen — Monitoring (gaya slip "Cari Data") + Upload.
 *
 * 100% STAND-ALONE dari `fee_loket`: pencarian PPID + kartu profil +
 * rincian fee semuanya diambil dari data fee Excel/DB yang sedang aktif.
 * TIDAK ada panggilan ke master `data_lengkap_utama` (lookup-agen tetap
 * menjadi satu-satunya halaman yang memakai master). Selama PPID ada di
 * data fee, profil selalu "found" — tidak ada status master
 * "Belum terdaftar sebagai AgenPos" di sini.
 * Data fee & riwayat dibaca/disimpan via /api/fee-rekap (service_role).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  Download,
  FileSpreadsheet,
  FileUp,
  History,
  Image as ImageIcon,
  Inbox,
  Loader2,
  Printer,
  RotateCcw,
  Search,
  SearchX,
  ShieldAlert,
  Store,
  Trash2,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import {
  buildCariSlipText,
  buildFeeAgentProfile,
  buildFeeAgentSlipText,
  buildFeeCsv,
  buildFeeSlipText,
  buildFullModuleBreakdown,
  buildPeriode,
  deleteFeeRows,
  detectFeeHeader,
  displayNamaLoket,
  dropAllFeeData,
  fetchFeeList,
  fetchLoketLookup,
  fetchUploadLogs,
  filterFeeRows,
  fillMergedCells,
  formatNumber,
  formatPeriode,
  formatRupiah,
  getSelectedLoketData,
  paginateRows,
  parseFeeRowsFromAOA,
  parseLoketBsbFull,
  parseLoketBsbRows,
  saveFeeImport,
  selectFeeSheet,
  slipImageFilename,
  statusLabelCari,
  type FeeParseAudit,
  type FeeSheetTarget,
  type FeeAgentProfile,
  type FeeRekapRow,
  type LoketLookupProfile,
  type TransactionBreakdown,
  type UploadLog,
} from "@/core/services/feeRekapService";
import {
  MAX_FEE_EXCEL_SIZE_BYTES,
  validateExcelMagicBytes,
  validateFileSize,
} from "@/lib/fileValidation";
import { cn, copyTextToClipboard, downloadBlob } from "@/lib/utils";

type TabKey = "monitoring" | "upload";

const PAGE_SIZE = 6;
const PREVIEW_LIMIT = 8;
const SEARCH_DEBOUNCE_MS = 350;

const BULAN_LIST = [
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
];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** Satu baris slip "Label : Nilai" ala sheet Cari (kolom C:D:E). */
function SlipRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[150px_12px_1fr] items-baseline gap-1 py-1 sm:grid-cols-[210px_12px_1fr]">
      <dt className="text-[13px] font-medium text-slate-600">{label}</dt>
      <dd aria-hidden className="text-[13px] text-slate-400">:</dd>
      <dd
        className={cn(
          "min-w-0 text-[13px] font-semibold break-words text-slate-900",
          mono && "font-mono"
        )}
      >
        {value === "" ? <span className="font-normal text-slate-300">—</span> : value}
      </dd>
    </div>
  );
}

/**
 * Grid slip 2 kolom persis lembar `Cari` — dipakai ulang di kartu hasil
 * Monitoring DAN modal Detail (satu sumber tampilan, tanpa drift).
 * Kiri: 20 baris slip keuangan + kotak hijau Fee Siap Transfer.
 * Kanan: tabel RINCIAN TRANSAKSI (MODUL | LEMBAR | FEE/LEMBAR | TOTAL FEE).
 */
function CariSlipGrid({
  profile,
  details,
  legacy,
}: {
  profile: LoketLookupProfile;
  details: TransactionBreakdown[];
  legacy: boolean;
}) {
  // Daftar penuh 79 modul katalog (urutan parser `Cari`): DB hanya
  // menyimpan modul beraktivitas, sisanya diisi nol di sini agar tabel
  // kanan selalu lengkap. Data legacy tidak punya rincian sama sekali.
  const [showZero, setShowZero] = useState(true);
  const fullDetails = legacy ? [] : buildFullModuleBreakdown(details);
  const visibleDetails = showZero
    ? fullDetails
    : fullDetails.filter((d) => d.lembar !== 0 || d.total !== 0);
  const activeCount = fullDetails.filter(
    (d) => d.lembar !== 0 || d.total !== 0
  ).length;
  return (
    <div className="grid gap-0 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      {/* KIRI — Slip Keuangan & Profil Agen (C6:E27). */}
      <div className="border-b border-dashed border-slate-300 lg:border-r lg:border-b-0">
        <dl className="px-4 py-3 sm:px-6">
          <SlipRow label="PPID" value={profile.ppid} mono />
          <SlipRow label="Nama Loket" value={profile.namaLoket} />
          <SlipRow label="Nomor Rekening" value={profile.noRekening} mono />
          <SlipRow label="Rekening BANK" value={profile.bank} />
          <SlipRow label="Pemilik Rekening" value={profile.namaPemilik} />
          <SlipRow label="Fee Bulan Ini" value={formatRupiah(profile.feeBulanIni)} />
          <SlipRow label="Fee Bulan Sebelumnya" value={formatRupiah(profile.feeBulanSebelumnya)} />
          <SlipRow label="Subsidi Antar Loket" value={formatRupiah(profile.subsidiAntarLoket)} />
          <SlipRow label="Total Fee" value={formatRupiah(profile.totalFee)} />
          <SlipRow label="Minus Loket" value={formatRupiah(profile.minus)} />
          <SlipRow label="Fee di Tahan" value={formatRupiah(profile.hold)} />
          <SlipRow label="Potongan Lainnya" value={formatRupiah(profile.potonganLainnya)} />
          <SlipRow label="Potongan Ongkir" value={formatRupiah(profile.potonganOngkir)} />
          <SlipRow label="Total Fee di Transfer" value={formatRupiah(profile.totalFeeTransfer)} />
          <SlipRow label="Status Fee" value={statusLabelCari(profile.statusPembayaran)} />
          <SlipRow label="Fee ke Deposit" value={formatRupiah(profile.feeKeDeposit)} />
          <SlipRow label="Fee di Transfer ke Rek" value={formatRupiah(profile.feeTransferRekening)} />
          <SlipRow label="Sisa Fee" value={formatRupiah(profile.sisaFee)} />
          <SlipRow label="Keterangan" value={profile.keterangan} />
          <SlipRow label="Tanggal Transfer" value={profile.tanggalTransfer} />
        </dl>
        {/* Kotak total Fee Siap Transfer di bagian bawah slip. */}
        <div className="px-4 pb-4 sm:px-6">
          <div className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3 text-white shadow-md shadow-emerald-600/20">
            <p className="text-[11px] font-bold tracking-widest uppercase opacity-90">
              Fee Siap Transfer
            </p>
            <p className="mt-0.5 truncate text-2xl font-extrabold tracking-tight">
              {formatRupiah(profile.feeSiapTransfer)}
            </p>
          </div>
        </div>
      </div>
      {/* KANAN — Tabel Rincian Transaksi per Modul (K-N). */}
      <div className="bg-slate-50/60 px-4 py-3 sm:px-6">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <p className="text-[11px] font-bold tracking-widest text-slate-500 uppercase">
            Rincian Transaksi
            {legacy && " · (data legacy — tanpa rincian modul)"}
          </p>
          {!legacy && fullDetails.length > 0 && (
            <button
              type="button"
              onClick={() => setShowZero((v) => !v)}
              aria-pressed={showZero}
              className="ml-auto rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
            >
              {showZero ? "Sembunyikan modul nol" : "Tampilkan semua modul"}
            </button>
          )}
        </div>
        {legacy || visibleDetails.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-500">
            {legacy
              ? "Profil ini berasal dari data lama (sebelum perombakan Master). Impor ulang file Excel Loket BSB untuk mengisi rincian modul."
              : "Belum ada transaksi modul pada periode ini (seluruh modul nol)."}
          </p>
        ) : (
          <div className="max-h-[480px] overflow-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="sticky top-0">
                <tr className="bg-slate-900 text-[11px] tracking-wider text-slate-200 uppercase">
                  <th scope="col" className="px-3 py-2 font-semibold">Modul</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Lembar</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Fee / Lembar</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Total Fee</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleDetails.map((d) => {
                  const inactive = d.lembar === 0 && d.total === 0;
                  return (
                    <tr key={d.modul} className={inactive ? "bg-slate-50/50" : undefined}>
                      <td className="px-3 py-1.5 font-semibold text-slate-800">{d.modul}</td>
                      <td className="px-3 py-1.5 text-right text-slate-600">
                        {inactive ? <span className="text-slate-300">0</span> : formatNumber(d.lembar)}
                      </td>
                      <td className="px-3 py-1.5 text-right text-slate-600">
                        {/* FEE/LEMBAR selalu ditampilkan apa adanya (termasuk
                            Rp 0) agar selaras format master Excel — tidak
                            pernah strip/dikosongkan. */}
                        {inactive ? (
                          <span className="text-slate-400">{formatRupiah(d.feePerLembar)}</span>
                        ) : (
                          formatRupiah(d.feePerLembar)
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right font-bold text-emerald-700">
                        {inactive ? <span className="font-medium text-slate-300">Rp 0</span> : formatRupiah(d.total)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="sticky bottom-0">
                <tr className="border-t-2 border-slate-200 bg-slate-50">
                  <td className="px-3 py-2 text-xs font-extrabold text-slate-900 uppercase">Total</td>
                  <td className="px-3 py-2 text-right text-xs font-bold text-slate-700">
                    {formatNumber(visibleDetails.reduce((s, d) => s + d.lembar, 0))}
                  </td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right text-xs font-extrabold text-emerald-700">
                    {formatRupiah(visibleDetails.reduce((s, d) => s + d.total, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="mt-1.5 text-[11px] text-slate-400">
          {legacy
            ? "Rincian modul hanya tersedia untuk data Master (Loket BSB)."
            : `${fullDetails.length} modul katalog · ${activeCount} modul aktif`}
        </p>
      </div>
    </div>
  );
}

function StatCard({  title,
  value,
  subtitle,
  icon,
  accent,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
  accent: "slate" | "emerald" | "blue";
}) {
  const accents = {
    slate: "border-slate-200 bg-white",
    emerald: "border-emerald-200 bg-gradient-to-b from-emerald-50 to-white",
    blue: "border-blue-200 bg-gradient-to-b from-blue-50 to-white",
  } as const;
  return (
    <div className={cn("cf-card border p-5", accents[accent])}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold tracking-widest text-slate-500 uppercase">
          {title}
        </p>
        {icon}
      </div>
      <p className="mt-2 truncate text-2xl font-extrabold tracking-tight text-slate-900">
        {value}
      </p>
      <p className="mt-1 truncate text-xs text-slate-500">{subtitle}</p>
    </div>
  );
}

export default function FeeRekapPage() {
  const [tab, setTab] = useState<TabKey>("monitoring");
  const [role, setRole] = useState<string | null>(null);

  // --- Data riil dari API (bukan mock) ---
  const [dataset, setDataset] = useState<FeeRekapRow[]>([]);
  const [periods, setPeriods] = useState<string[]>([]);
  const [summary, setSummary] = useState({ totalLoket: 0, totalTerbayarAktif: 0, latestPeriode: "" });
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [logs, setLogs] = useState<UploadLog[]>([]);
  const [logsError, setLogsError] = useState<string | null>(null);
  // Batas halaman server: true bila DB menyimpan baris di luar 2000 yang
  // dimuat (peringatan anti-pemotongan-diam, lihat `truncated` API).
  const [listTruncated, setListTruncated] = useState(false);
  const [listTotal, setListTotal] = useState(0);

  // --- Pencarian ala Cari (satu box menggerakkan slip + tabel) ---
  const [search, setSearch] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [periode, setPeriode] = useState("SEMUA");
  // --- Lookup profil Master ala sheet `Cari` (slip + rincian modul) ---
  // Diambil dari /api/fee-rekap/lookup (loket_profiles + details);
  // fallback ke profil virtual fee bila lookup 404/kosong (data legacy).
  const [lookupProfile, setLookupProfile] = useState<LoketLookupProfile | null>(null);
  const [lookupDetails, setLookupDetails] = useState<TransactionBreakdown[]>([]);
  const [lookupLegacy, setLookupLegacy] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<FeeRekapRow | null>(null);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // --- Upload state ---
  const [dragOver, setDragOver] = useState(false);
  const [fileMeta, setFileMeta] = useState<{
    name: string;
    size: number;
    sheet?: string;
    headerRow?: number;
  } | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [preview, setPreview] = useState<FeeRekapRow[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [detectedCols, setDetectedCols] = useState<{
    ppid: string;
    nama: string;
    fee: string;
    status: string;
    periode: string;
    potongan: string[];
  } | null>(null);
  const [parseAudit, setParseAudit] = useState<FeeParseAudit | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FeeRekapRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Reset total database (Drop All Data) — khusus ADMIN + dialog konfirmasi.
  const [dropOpen, setDropOpen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  // Lookup Master untuk modal Detail (slip 2 kolom ala `Cari`).
  const [modalProfile, setModalProfile] = useState<LoketLookupProfile | null>(null);
  const [modalDetails, setModalDetails] = useState<TransactionBreakdown[]>([]);
  const [modalLegacy, setModalLegacy] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  // Ekspor slip modal sebagai gambar (html-to-image, client-side).
  const modalSlipRef = useRef<HTMLDivElement>(null);
  const [imgBusy, setImgBusy] = useState<"png" | "copy" | null>(null);
  const [imgError, setImgError] = useState<string | null>(null);
  const [bulan, setBulan] = useState(9);
  const [tahun, setTahun] = useState(2026);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);
  const [saveProgress, setSaveProgress] = useState<{ done: number; total: number } | null>(null);
  const [verifyInfo, setVerifyInfo] = useState<{
    periode: string;
    rows: number;
    total: number;
    sum: number;
    zeros: number;
    truncated: boolean;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Role sesi untuk mengunci tombol Simpan (khusus ADMIN).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) return;
        const body = (await res.json()) as { user?: { role?: string } };
        if (!cancelled && typeof body.user?.role === "string") {
          setRole(body.user.role.trim().toUpperCase());
        }
      } catch {
        // abaikan: simpan tetap terkunci
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadAll = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const [list, logList] = await Promise.all([
        fetchFeeList({ pageSize: 2000 }),
        fetchUploadLogs().catch(() => {
          setLogsError("Riwayat tak termuat.");
          return [] as UploadLog[];
        }),
      ]);
      setDataset(list.data);
      setPeriods(list.periods);
      setSummary(list.summary);
      setListTruncated(list.truncated);
      setListTotal(list.total);
      setLogs(logList);
      setLogsError(null);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Gagal memuat fee.");
      setDataset([]);
      setListTruncated(false);
      setListTotal(0);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    // Pengambilan awal saat mount — kasus kanonis efek sinkronisasi data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Debounce pencarian ala VLOOKUP instan sheet Cari. Profil di-derive
  // sinkron dari dataset fee lokal (tanpa fetch master), jadi efek ini
  // hanya memapan query + reset halaman (setState di callback = aman).
  // Lookup Master ikut dimulai di sini (loading di callback, bukan efek).
  useEffect(() => {
    if (search.trim() === "") return;
    const timer = setTimeout(() => {
      setCommittedQuery(search.trim());
      setPage(1);
      startLookup();
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  function handleSearchChange(value: string) {
    setSearch(value);
    if (value.trim() === "") {
      setCommittedQuery("");
      setPage(1);
      clearLookup();
    }
  }

  /** Reset state lookup Master (dipanggil sinkron dari handler, bukan efek). */
  function clearLookup() {
    setLookupProfile(null);
    setLookupDetails([]);
    setLookupLegacy(false);
    setLookupError(null);
    setLookupLoading(false);
  }

  /**
   * Mulai lookup Master: bersihkan hasil lama + nyalakan loading.
   * Dipanggil dari handler/commit (event/timeout callback = aman), bukan
   * dari badan efek — agar lolos `react-hooks/set-state-in-effect`.
   */
  function startLookup() {
    setLookupProfile(null);
    setLookupDetails([]);
    setLookupLegacy(false);
    setLookupError(null);
    setLookupLoading(true);
  }

  /** Reset state lookup modal Detail (dipanggil dari handler, bukan efek). */
  function clearModalLookup() {
    setModalProfile(null);
    setModalDetails([]);
    setModalLegacy(false);
    setModalError(null);
    setModalLoading(false);
    setImgBusy(null);
    setImgError(null);
  }

  /**
   * Buka modal Detail sekaligus mulai lookup Master-nya (loading di
   * handler = aman untuk lint; fetch berjalan di efek selectedKey).
   */
  function openDetail(row: FeeRekapRow) {
    setSelected(row);
    setCopied(false);
    setModalProfile(null);
    setModalDetails([]);
    setModalLegacy(false);
    setModalError(null);
    setModalLoading(true);
    setImgBusy(null);
    setImgError(null);
  }

  // Lookup Master per query ter-commit: slip keuangan + rincian modul
  // persis sheet `Cari`. 404 = data legacy/belum impor — UI memakai profil
  // virtual fee (tanpa error keras). Efek ini hanya fetch async; loading
  // dimulai di titik commit (debounce/click/Enter) via startLookup().
  useEffect(() => {
    const q = committedQuery.trim();
    if (q === "") return;
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchLoketLookup(q, periode);
        if (cancelled) return;
        setLookupProfile(result.profile);
        setLookupDetails(result.details);
        setLookupLegacy(result.legacy);
      } catch (err) {
        if (cancelled) return;
        setLookupProfile(null);
        setLookupDetails([]);
        setLookupLegacy(false);
        setLookupError(err instanceof Error ? err.message : "Lookup gagal.");
      } finally {
        if (!cancelled) setLookupLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [committedQuery, periode]);

  // --- Derived ---
  const filtered = useMemo(
    () => filterFeeRows(dataset, committedQuery, periode),
    [dataset, committedQuery, periode]
  );
  const { pageRows, totalPages, safePage } = useMemo(
    () => paginateRows(filtered, page, PAGE_SIZE),
    [filtered, page]
  );

  /**
   * Fee milik agen pada slip — strict match langsung dari data fee
   * (String(ppid).trim().toUpperCase() via getSelectedLoketData()).
   * Tidak ada ketergantungan master: query dicocokkan ke dataset fee.
   */
  const agentFees = useMemo(() => {
    if (committedQuery.trim() === "") return [];
    return getSelectedLoketData(dataset, committedQuery, periode);
  }, [dataset, committedQuery, periode]);

  /**
   * Profil virtual 100% dari data fee: PPID ada di fee = terdaftar.
   * Tidak pernah memicu status master "Belum terdaftar sebagai AgenPos".
   */
  const agentProfile: FeeAgentProfile | null = useMemo(() => {
    if (committedQuery.trim() === "") return null;
    return buildFeeAgentProfile(
      getSelectedLoketData(dataset, committedQuery, "SEMUA"),
      periode
    );
  }, [dataset, committedQuery, periode]);

  /**
   * Modal selalu me-resolve ulang dari dataset segar (anti snapshot basi
   * 0/kosong): cocok PPID + periode via getSelectedLoketData, fallback ke
   * snapshot bila baris sudah tidak ada (mis. habis dihapus).
   */
  const liveSelected = useMemo(() => {
    if (!selected) return null;
    return (
      getSelectedLoketData(dataset, selected.ppid, selected.periode)[0] ??
      selected
    );
  }, [dataset, selected]);

  // Kunci fetch lookup modal (PPID + periode baris terpilih).
  const modalKey = selected ? `${selected.ppid}||${selected.periode}` : "";

  // Lookup Master untuk modal Detail: slip 2 kolom + rincian modul dari
  // `loket_transaction_details`. 404/error = fallback tampilan generik
  // dari liveSelected (tanpa error keras). Efek hanya fetch async.
  useEffect(() => {
    if (!selected || modalKey === "") return;
    const { ppid, periode } = selected;
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchLoketLookup(ppid, periode);
        if (cancelled) return;
        setModalProfile(result.profile);
        setModalDetails(result.details);
        setModalLegacy(result.legacy);
      } catch (err) {
        if (cancelled) return;
        setModalProfile(null);
        setModalDetails([]);
        setModalLegacy(false);
        setModalError(err instanceof Error ? err.message : "Lookup gagal.");
      } finally {
        if (!cancelled) setModalLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, modalKey]);

  function resetFilter() {
    setSearch("");
    setCommittedQuery("");
    setPeriode("SEMUA");
    setPage(1);
    clearLookup();
  }

  function pageNumbers(): number[] {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const window: number[] = [1, safePage - 1, safePage, safePage + 1, totalPages];
    return [...new Set(window.filter((n) => n >= 1 && n <= totalPages))].sort(
      (a, b) => a - b
    );
  }

  async function copyText(text: string) {
    // Helper tidak pernah melempar; klaim "Tersalin" hanya bila sukses.
    const ok = await copyTextToClipboard(text);
    if (!ok) {
      setToast("Gagal menyalin. Salin manual dari layar.");
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  /**
   * Unduh slip modal sebagai PNG tajam (pixelRatio 2, latar putih).
   * html-to-image diimpor dinamis agar tidak membebani bundle awal.
   * Gagal render (mis. fungsi warna CSS tak didukung browser) dilaporkan
   * sebagai pesan ramah, bukan crash.
   */
  async function downloadSlipPng() {
    const node = modalSlipRef.current;
    if (!node || !modalProfile || imgBusy) return;
    setImgBusy("png");
    setImgError(null);
    try {
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(node, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = slipImageFilename(modalProfile.ppid, modalProfile.periode);
      a.click();
      setToast("Slip tersimpan sebagai PNG.");
    } catch (err) {
      setImgError(
        err instanceof Error
          ? `Gagal membuat PNG: ${err.message}`
          : "Gagal membuat PNG di browser ini. Coba Cetak / PDF."
      );
    } finally {
      setImgBusy(null);
    }
  }

  /**
   * Salin slip modal sebagai GAMBAR ke clipboard (image/png).
   * Butuh ClipboardItem + izin clipboard (Chrome/Edge modern).
   */
  async function copySlipImage() {
    const node = modalSlipRef.current;
    if (!node || !modalProfile || imgBusy) return;
    if (
      typeof window.ClipboardItem === "undefined" ||
      !navigator.clipboard?.write
    ) {
      setImgError(
        "Browser ini tidak mendukung salin gambar. Gunakan Download PNG."
      );
      return;
    }
    setImgBusy("copy");
    setImgError(null);
    try {
      const { toBlob } = await import("html-to-image");
      const blob = await toBlob(node, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
      });
      if (!blob) throw new Error("render kosong");
      await navigator.clipboard.write([
        new window.ClipboardItem({ "image/png": blob }),
      ]);
      setToast("Gambar slip tersalin ke clipboard.");
    } catch (err) {
      setImgError(
        err instanceof Error
          ? `Gagal menyalin gambar: ${err.message}`
          : "Gagal menyalin gambar. Gunakan Download PNG."
      );
    } finally {
      setImgBusy(null);
    }
  }

  function downloadCsv() {
    try {
      const blob = new Blob([buildFeeCsv(filtered)], {
        type: "text/csv;charset=utf-8",
      });
      downloadBlob(
        blob,
        `rekap-fee-${periode === "SEMUA" ? "semua" : periode}.csv`
      );
      setToast(`${filtered.length} baris diekspor ke CSV.`);
    } catch (err) {
      setToast(
        err instanceof Error
          ? `Gagal mengekspor CSV: ${err.message}`
          : "Gagal mengekspor CSV di browser ini."
      );
    }
  }

  async function downloadExcel() {
    try {
      const { downloadAoaAsXlsx } = await import("@/lib/excel");
      const aoa: (string | number)[][] = [
        ["No", "PPID", "Nama Loket", "Periode", "Total Fee (Rp)", "Status"],
        ...filtered.map((r, i) => [
          i + 1,
          r.ppid,
          r.namaLoket,
          formatPeriode(r.periode),
          r.totalFee,
          r.status,
        ] as (string | number)[]),
      ];
      await downloadAoaAsXlsx(
        `rekap-fee-${periode === "SEMUA" ? "semua" : periode}.xlsx`,
        "Rekap Fee",
        aoa,
        [5, 18, 28, 18, 18, 12]
      );
      setToast(`${filtered.length} baris diekspor ke Excel.`);
    } catch (err) {
      setToast(
        err instanceof Error
          ? `Gagal mengekspor Excel: ${err.message}`
          : "Gagal mengekspor Excel di browser ini."
      );
    }
  }

  // --- Upload handlers (parse lokal -> simpan via API ADMIN) ---
  async function processFile(file: File) {
    const sizeErr = validateFileSize(file, MAX_FEE_EXCEL_SIZE_BYTES);
    if (sizeErr) {
      setParseError(sizeErr);
      return;
    }
    setParsing(true);
    setParseError(null);
    setSaveResult(null);
    try {
      const {
        getMergeRanges,
        hasFormulaAt,
        loadWorkbookFromBuffer,
        validateMatrixLimits,
      } = await import("@/lib/excel");
      const buffer = await file.arrayBuffer();
      if (!validateExcelMagicBytes(buffer)) {
        setParseError(
          "Format file tidak valid. Harap unggah file Excel (.xlsx/.xls/.xlsb) yang sah."
        );
        return;
      }
      // exceljs membaca .xlsx/.xlsm (OOXML ZIP); .xls (OLE2)/.xlsb (BIFF12)
      // ditolak dengan pesan migrasi yang jelas oleh loadWorkbookFromBuffer.
      const wb = await loadWorkbookFromBuffer(buffer, { defval: "" });
      if (wb.sheetNames.length === 0) throw new Error("Berkas tidak berisi sheet.");
      // Sheet target: "Loket BSB" bila ada (layout diketahui: header
      // indeks 2, data indeks 5, PPID idx 1, Nama idx 2, fee idx
      // 189/191/196). Jika tidak ada, pindai semua sheet (maks 10) dan
      // pakai yang header fee-nya valid — hint layout hanya untuk sheet
      // target agar tidak salah petakan sheet lain.
      // Sel merge (PPID digabung ke bawah — khas .xlsb) diteruskan ke
      // bawah agar barisnya tidak terbuang sebagai "kosong".
      const selection = selectFeeSheet(wb.sheetNames);
      const scanned: { name: string; matrix: unknown[][] }[] = [];
      for (const name of wb.sheetNames.slice(0, 10)) {
        const raw = wb.matrices.get(name) ?? [];
        const ws = wb.worksheets.get(name);
        validateMatrixLimits(raw, { maxRows: 20030, maxCols: 250 });
        scanned.push({
          name,
          matrix: ws ? fillMergedCells(raw, getMergeRanges(ws)) : raw,
        });
      }
      let hit: { name: string; matrix: unknown[][] } | undefined;
      let hitTarget: FeeSheetTarget | undefined;
      if (selection) {
        const candidate = scanned.find((s) => s.name === selection.name);
        if (
          candidate &&
          detectFeeHeader(candidate.matrix, selection.target) !== null
        ) {
          hit = candidate;
          hitTarget = selection.target;
        }
      }
      hit ??= scanned.find((s) => detectFeeHeader(s.matrix) !== null);
      if (!hit) {
        const names = wb.sheetNames.slice(0, 10).join(", ");
        throw new Error(
          `Tidak ada baris fee terdeteksi di sheet mana pun (${names}). ` +
            "Pastikan salah satu sheet memuat header PPID + Nama Loket/Agen + Fee/Total."
        );
      }
      // Inspektor sel mentah untuk audit formula: sel berformula tanpa
      // nilai cache adalah akar Rp-0 massal yang khas pada .xlsb —
      // terlihat berangka di Excel, terbaca "" oleh parser. Indeks
      // matriks = alamat sheet (baris 1 -> indeks 0).
      const hitWs = wb.worksheets.get(hit.name);
      const inspectCell = (r: number, c: number) => {
        if (!hitWs) return undefined;
        return hasFormulaAt(hitWs, r, c) ? { hasFormula: true } : undefined;
      };
      const fileLabel = file.name.replace(/\.[^.]+$/, "");
      // Jalur MASTER untuk sheet Loket BSB: parser absolut penuh
      // (parseLoketBsbFull) membaca identitas (1-7) + ringkasan keuangan
      // (189-196) + rincian 79 modul per pola sheet `Cari`, sehingga
      // "Simpan ke Database" mengisi loket_profiles + details sekaligus.
      // Fallback ke parser dinamis/absolut lama bila sanity gagal.
      const isBsbTarget = hitTarget?.sheetName === hit.name;
      const full =
        isBsbTarget
          ? parseLoketBsbFull(
              hit.matrix,
              buildPeriode(bulan, tahun),
              fileLabel
            )
          : null;
      if (full && full.rows.length > 0) {
        const zeroFeeRows = full.rows.filter((x) => x.totalFee === 0).length;
        setFileMeta({
          name: file.name,
          size: file.size,
          sheet: hit.name,
          headerRow: 3,
        });
        setPreview(full.rows);
        setSkipped(full.skipped);
        setDetectedCols({
          ppid: "PPID",
          nama: "Nama Loket",
          fee: "JUMLAH FEE (191) / BULAN INI (189)",
          status: "Total Transfer (206) → TERBAYAR/PENDING",
          periode: buildPeriode(bulan, tahun),
          potongan: ["MINUS (192)", "HOLD (193)", "Potongan lainnya (194)", "Potongan Ongkir (195)"],
        });
        setParseAudit({
          totalRows: full.rows.length,
          zeroFeeRows,
          allZero: zeroFeeRows === full.rows.length,
          formulaWithoutValue: 0,
          clampedFeeRows: full.rows.filter((x) => x.auditFlag === "OVER_DEDUCTED_CLAMPED").length,
          samples: full.rows.slice(0, 5).map((r, i) => ({
            matrixRow: 5 + i,
            ppid: r.ppid,
            raw: r.totalFee,
            parsed: r.totalFee,
            hasFormula: false,
          })),
        });
        return;
      }
      // Jalur MUTLAK untuk sheet Loket BSB: indeks kolom fix
      // (PPID=1, Nama=2, fee=191/189), header indeks 2, data indeks 5.
      // Fallback ke parser dinamis bila sanity header absolut gagal
      // (return null) — plus pengaman template-drift:
      // bila hasil absolut Rp-0 massal (indeks 191/189 tak lagi memuat
      // nominal — mis. layout file berubah), coba parser dinamis pada
      // matriks yang sama dan pakai hasilnya bila menemukan fee non-nol.
      const runDynamic = () =>
        parseFeeRowsFromAOA(
          hit.matrix,
          buildPeriode(bulan, tahun),
          fileLabel,
          hitTarget
            ? {
                headerRowHint: hitTarget.headerRowHint,
                dataStartRowHint: hitTarget.dataStartRowHint,
                columnHints: hitTarget.columnHints,
                inspectCell,
              }
            : { inspectCell }
        );
      const absolute =
        hitTarget?.sheetName === hit.name
          ? parseLoketBsbRows(
              hit.matrix,
              buildPeriode(bulan, tahun),
              fileLabel,
              inspectCell
            )
          : null;
      let parsed = absolute ?? runDynamic();
      if (
        absolute &&
        absolute.rows.length > 0 &&
        absolute.audit.allZero
      ) {
        const dynamic = runDynamic();
        if (dynamic.rows.length > 0 && !dynamic.audit.allZero) {
          parsed = dynamic;
        }
      }
      if (parsed.rows.length === 0) {
        setParseError(
          "Tidak ada baris fee terdeteksi. Pastikan header memuat PPID + Nama Loket/Agen + Fee/Total."
        );
        setPreview([]);
        setDetectedCols(null);
        setParseAudit(null);
        return;
      }
      setFileMeta({
        name: file.name,
        size: file.size,
        sheet: hit.name,
        headerRow: parsed.detectedHeaderRow + 1,
      });
      setPreview(parsed.rows);
      setSkipped(parsed.skipped);
      setDetectedCols(parsed.columns);
      setParseAudit(parsed.audit);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Gagal membaca file.");
      setPreview([]);
      setParseAudit(null);
    } finally {
      setParsing(false);
    }
  }

  function pickFile(file: File | undefined) {
    if (!file) return;
    void processFile(file);
  }

  /** Periode dropdown menimpa seluruh preview (ditentukan admin). */
  function applyPeriode(nextBulan: number, nextTahun: number) {
    setBulan(nextBulan);
    setTahun(nextTahun);
    const p = buildPeriode(nextBulan, nextTahun);
    // Profil Master ikut periode yang sama agar simpan/verifikasi/log
    // konsisten (server memakai periode deklarasi sebagai otoritatif).
    setPreview((prev) =>
      prev.map((r) => ({
        ...r,
        periode: p,
        ...(r.profil ? { profil: { ...r.profil, periode: p } } : {}),
      }))
    );
  }

  async function handleSave() {
    if (preview.length === 0 || saving) return;
    setSaving(true);
    setSaveResult(null);
    // Chunked upload: 10.000+ baris dikirim per batch kecil + progress.
    setSaveProgress({ done: 0, total: Math.max(1, Math.ceil(preview.length / 500)) });
    try {
      const result = await saveFeeImport(
        {
          rows: preview,
          fileName: fileMeta?.name ?? "rekap-fee.xlsx",
          periode: buildPeriode(bulan, tahun),
        },
        (p) => setSaveProgress({ done: p.done, total: p.total })
      );
      // Tripwire mapping-loss: server menggema jumlah yang diterima vs
      // tersimpan. Preview bernominal tapi storedSum 0 = mapping rusak.
      if (result.receivedSum > 0 && result.storedSum === 0) {
        throw new Error(
          `Server menerima total ${formatRupiah(result.receivedSum)} tetapi menyimpan Rp 0 ` +
            `(${result.upserted} baris). Pemetaan kolom fee gagal — data TIDAK disimpan benar, periksa diagnostik kolom sebelum mengulang.`
        );
      }
      setSaveResult(
        `${result.upserted} baris periode ${formatPeriode(result.periode)} tersimpan ke database` +
          (result.profilesUpserted > 0
            ? ` (${result.profilesUpserted} profil + ${result.detailsUpserted} rincian modul Master)`
            : "") +
          (result.zeroRows > 0 ? ` (${result.zeroRows} baris bernilai Rp 0).` : ".")
      );
      setToast("Rekap fee tersimpan — tabel monitoring diperbarui.");
      setPreview([]);
      setFileMeta(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadAll();
      // Verifikasi silang DB: baca ulang periode yang baru disimpan agar
      // admin langsung melihat N baris / total / baris nol (cross-check
      // terhadap file master, mis. loket 53JCUM03019BGRLM).
      try {
        const verify = await fetchFeeList({ periode: result.periode, pageSize: 2000 });
        // totalFee sudah integer bulat (parseAmount + Math.round di
        // service) sehingga reduce di sini presisi.
        const sum = verify.data.reduce((s, r) => s + r.totalFee, 0);
        const zeros = verify.data.filter((r) => r.totalFee === 0).length;
        setVerifyInfo({
          periode: result.periode,
          rows: verify.data.length,
          total: verify.total,
          sum,
          zeros,
          truncated: verify.truncated,
        });
      } catch {
        setVerifyInfo(null);
      }
    } catch (err) {
      setSaveResult(null);
      setParseError(err instanceof Error ? err.message : "Gagal menyimpan.");
    } finally {
      setSaving(false);
      setSaveProgress(null);
    }
  }

  /** Hapus baris fee terkonfirmasi (ADMIN) lalu muat ulang tabel. */
  async function handleDeleteConfirm() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await deleteFeeRows([deleteTarget.id]);
      const label = `${deleteTarget.ppid} · ${formatPeriode(deleteTarget.periode)}`;
      setDeleteTarget(null);
      // Tutup modal slip bila baris yang sedang dibuka ikut terhapus.
      setSelected((prev) =>
        prev && prev.id === deleteTarget.id ? null : prev
      );
      setToast(`Fee ${label} dihapus (${result.deleted} baris).`);
      await loadAll();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Gagal menghapus fee.");
    } finally {
      setDeleting(false);
    }
  }

  /** Reset TOTAL database fee terkonfirmasi (ADMIN): details + profiles + legacy. */
  async function handleDropAllConfirm() {
    if (dropping) return;
    setDropping(true);
    setDropError(null);
    try {
      const result = await dropAllFeeData();
      setDropOpen(false);
      setPreview([]);
      setFileMeta(null);
      setSaveResult(null);
      setVerifyInfo(null);
      resetFilter();
      setSelected(null);
      clearModalLookup();
      setToast(
        `Seluruh data fee dihapus — ${result.profiles} profil, ${result.details} rincian, ${result.feeLoket} baris legacy. Siap re-import bersih.`
      );
      await loadAll();
    } catch (err) {
      setDropError(err instanceof Error ? err.message : "Gagal menghapus data.");
    } finally {
      setDropping(false);
    }
  }

  const isAdmin = role === "ADMIN";
  const previewPeriode = preview[0]?.periode ?? buildPeriode(bulan, tahun);
  const hasQuery = committedQuery.trim() !== "";

  return (
    <div className="space-y-5">
      {/* Banner */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-blue-900 to-cyan-700 p-6 text-white shadow-lg shadow-blue-900/20 sm:p-8">
        <div className="relative flex flex-wrap items-center gap-4">
          <span className="flex size-12 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <Wallet className="size-6 text-emerald-300" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">
              Rekapitulasi Fee Loket / Agen
            </h1>
            <p className="mt-1 text-sm text-blue-100">
              Pencarian model sheet &ldquo;Cari Data&rdquo; + upload rekap Excel
              admin (tersimpan di database).
            </p>
          </div>
          <div
            role="tablist"
            aria-label="Pilih tampilan"
            className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/10 p-1 backdrop-blur"
          >
            {(
              [
                { key: "monitoring", label: "Monitoring Fee" },
                { key: "upload", label: "Upload Excel" },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "cursor-pointer rounded-full px-4 py-1.5 text-xs font-semibold whitespace-nowrap transition-all",
                  tab === t.key
                    ? "bg-white text-slate-900 shadow"
                    : "text-blue-100 hover:text-white"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {tab === "monitoring" ? (
        <>
          {/* Stat cards */}
          <section className="grid gap-3 sm:grid-cols-3">
            <StatCard
              title="Total Loket Terdaftar"
              value={listLoading ? "…" : String(summary.totalLoket)}
              subtitle={`${dataset.length} baris fee di database`}
              icon={<Store className="size-5 text-slate-500" aria-hidden />}
              accent="slate"
            />
            <StatCard
              title="Total Fee Terbayar"
              value={listLoading ? "…" : formatRupiah(summary.totalTerbayarAktif)}
              subtitle={`Periode aktif: ${summary.latestPeriode === "" ? "—" : formatPeriode(summary.latestPeriode)}`}
              icon={<Banknote className="size-5 text-emerald-600" aria-hidden />}
              accent="emerald"
            />
            <StatCard
              title="Periode Data Terbaru"
              value={summary.latestPeriode === "" ? "—" : formatPeriode(summary.latestPeriode)}
              subtitle={`${periods.length} periode tersedia`}
              icon={<CalendarClock className="size-5 text-blue-700" aria-hidden />}
              accent="blue"
            />
          </section>

          {/* Baris pencarian ala Cari: "Masukan PPID ... : [input]" */}
          <section className="cf-card p-4 sm:p-5">
            <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[220px_12px_1fr_auto]">
              <p className="text-sm font-medium text-slate-700">
                Masukan PPID Lengkap / Kode PPID
              </p>
              <p aria-hidden className="hidden text-sm text-slate-400 sm:block">:</p>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
                  aria-hidden
                />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && search.trim() !== "") {
                      setCommittedQuery(search.trim());
                      startLookup();
                    }
                    if (e.key === "Escape") resetFilter();
                  }}
                  placeholder="cth: MUCSPA63640PSIND"
                  aria-label="Masukan PPID Lengkap atau Kode PPID"
                  autoComplete="off"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pr-9 pl-9 font-mono text-sm font-bold tracking-wide text-slate-900 uppercase placeholder:font-sans placeholder:font-normal placeholder:normal-case placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-200 focus:outline-none"
                />
                {search !== "" && (
                  <button
                    type="button"
                    onClick={resetFilter}
                    aria-label="Bersihkan pencarian"
                    className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCommittedQuery(search.trim());
                    startLookup();
                  }}
                  disabled={search.trim() === ""}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-700 to-cyan-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50 sm:flex-none"
                >
                  <Search className="size-4" aria-hidden />
                  Cari Data
                </button>
                <button
                  type="button"
                  onClick={resetFilter}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <RotateCcw className="size-4" aria-hidden />
                  Reset
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-dashed border-slate-200 pt-3">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                Periode
                <select
                  value={periode}
                  onChange={(e) => {
                    setPeriode(e.target.value);
                    setPage(1);
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 focus:outline-none"
                >
                  <option value="SEMUA">Semua Periode</option>
                  {periods.map((p) => (
                    <option key={p} value={p}>
                      {formatPeriode(p)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void downloadExcel()}
                  disabled={filtered.length === 0}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
                >
                  <Download className="size-3.5" aria-hidden />
                  Excel
                </button>
                <button
                  type="button"
                  onClick={downloadCsv}
                  disabled={filtered.length === 0}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  <FileSpreadsheet className="size-3.5" aria-hidden />
                  CSV
                </button>
              </div>
            </div>
          </section>

          {/* Kartu profil + fee — 100% dari data fee (tanpa master) */}
          {hasQuery && !listLoading && !listError && !agentProfile && (
            <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-white py-12 text-center">
              <SearchX className="mb-3 size-8 text-slate-300" aria-hidden />
              <p className="text-sm font-semibold text-slate-900">PPID tidak ditemukan di data fee</p>
              <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-500">
                Tidak ada baris fee dengan PPID &ldquo;{committedQuery}&rdquo;.
                Periksa kode atau impor datanya via tab Upload Excel.
              </p>
            </div>
          )}
          {agentProfile && (
            <section
              aria-label="Hasil pencarian agen"
              className="overflow-hidden rounded-2xl border-2 border-slate-800 bg-white shadow-lg shadow-slate-900/10"
            >
              <div className="flex flex-wrap items-center gap-3 border-b-2 border-slate-800 bg-slate-50 px-4 py-3 sm:px-6">
                <p className="min-w-0 text-sm text-slate-700">
                  Masukan PPID Lengkap / Kode PPID :{" "}
                  <span className="font-mono text-base font-extrabold tracking-wide text-slate-900 uppercase">
                    {committedQuery === "" ? "—" : committedQuery}
                  </span>
                </p>
                <span className="ml-auto flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      void copyText(
                        lookupProfile
                          ? buildCariSlipText(lookupProfile, lookupDetails)
                          : buildFeeAgentSlipText(agentProfile, agentFees)
                      )
                    }
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white",
                      copied ? "bg-emerald-600" : "bg-slate-900 hover:opacity-90"
                    )}
                  >
                    {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                    {copied ? "Tersalin!" : "Salin"}
                  </button>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Printer className="size-3.5" aria-hidden />
                    Cetak / PDF
                  </button>
                </span>
              </div>
              <div aria-hidden className="border-t border-dashed border-slate-400" />
              {lookupLoading ? (
                <p role="status" className="flex items-center gap-2 px-4 py-4 text-sm text-slate-500 sm:px-6">
                  <Loader2 className="size-4 animate-spin text-cyan-600" aria-hidden />
                  Memuat slip Master…
                </p>
              ) : lookupProfile ? (
                <CariSlipGrid
                  profile={lookupProfile}
                  details={lookupDetails}
                  legacy={lookupLegacy}
                />
              ) : (
                <>
                  {/* Fallback virtual dari baris fee (data legacy / lookup gagal). */}
                  {lookupError && (
                    <p role="alert" className="mx-4 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 sm:mx-6">
                      Rincian Master tak termuat ({lookupError}) — menampilkan ringkasan fee.
                    </p>
                  )}
                  <dl className="px-4 py-3 sm:px-6">
                    <SlipRow label="PPID" value={agentProfile.ppid} mono />
                    <SlipRow label="Nama Loket / Agen" value={agentProfile.namaLoket} />
                    <SlipRow
                      label="Periode"
                      value={
                        agentProfile.periods.length === 0
                          ? "—"
                          : agentProfile.periods.length === 1
                            ? formatPeriode(agentProfile.periods[0] ?? "")
                            : `Semua (${agentProfile.periods.length} periode)`
                      }
                    />
                    <SlipRow
                      label="Status Pembayaran"
                      value={agentProfile.status === "TERBAYAR" ? "Terbayar" : "Pending"}
                    />
                    <SlipRow label="Total Fee" value={formatRupiah(agentProfile.totalFee)} />
                  </dl>
                  <div aria-hidden className="border-t border-dashed border-slate-400" />
                  {/* Rincian Fee per periode untuk PPID ini */}
                  <div className="bg-slate-50/60 px-4 py-3 sm:px-6">
                    <p className="mb-2 text-[11px] font-bold tracking-widest text-slate-500 uppercase">
                      Rincian Fee {periode !== "SEMUA" && `· ${formatPeriode(periode)}`}
                    </p>
                    {agentFees.length === 0 ? (
                      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                        Belum ada data fee untuk PPID ini
                        {periode !== "SEMUA" && ` pada ${formatPeriode(periode)}`} — Admin dapat
                        mengimpor via tab Upload Excel.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {agentFees.map((f) => (
                          <li
                            key={f.id}
                            className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5"
                          >
                            <span className="text-xs font-bold text-slate-700">
                              {formatPeriode(f.periode)}
                            </span>
                            <span
                              className={cn(
                                "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                                f.status === "TERBAYAR"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-amber-200 bg-amber-50 text-amber-700"
                              )}
                            >
                              {f.status === "TERBAYAR" ? "Terbayar" : "Pending"}
                            </span>
                            <span className="ml-auto text-sm font-extrabold text-emerald-700">
                              {formatRupiah(f.totalFee)}
                            </span>
                            <button
                              type="button"
                              onClick={() => openDetail(f)}
                              className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              Detail
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
              <p className="px-4 py-2.5 font-mono text-[11px] text-slate-400 sm:px-6">
                Sumber: {lookupProfile ? "loket_profiles + rincian modul (Excel Master)" : "fee_loket (data Excel)"} · CultFlow Workspace
              </p>
            </section>
          )}

          {/* Tabel rekap */}
          <section className="cf-card overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-bold text-slate-900">Rekapitulasi Fee</h2>
              <p className="text-xs text-slate-500" aria-live="polite">
                {listLoading ? "Memuat…" : `${filtered.length} data`}
                {periode !== "SEMUA" && ` · ${formatPeriode(periode)}`}
              </p>
            </div>
            {!listLoading && !listError && listTruncated && (
              <p role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-800">
                Menampilkan {dataset.length} dari {listTotal} baris (batas muat 2000) —
                gunakan filter periode atau pencarian PPID untuk melihat sisanya.
                Ringkasan Total Loket &amp; Fee di atas tetap dihitung dari seluruh data.
              </p>
            )}
            {listLoading ? (
              <div className="space-y-2 p-4" role="status" aria-label="Memuat fee">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-9 animate-pulse rounded-lg bg-slate-100" />
                ))}
              </div>
            ) : listError ? (
              <div className="flex flex-col items-center gap-3 p-10 text-center">
                <p className="font-semibold text-slate-900">Gagal memuat fee</p>
                <p className="max-w-md text-sm text-slate-500">{listError}</p>
                <button
                  type="button"
                  onClick={() => void loadAll()}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Coba Lagi
                </button>
              </div>
            ) : dataset.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
                <span className="mb-4 flex size-14 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50">
                  <Inbox className="size-7 text-slate-300" aria-hidden />
                </span>
                <p className="text-sm font-semibold text-slate-900">Belum ada data fee</p>
                <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-500">
                  Database fee_loket masih kosong. Admin dapat mengimpor rekap
                  bulanan melalui tab Upload Excel.
                </p>
                <button
                  type="button"
                  onClick={() => setTab("upload")}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                >
                  <Upload className="size-4" aria-hidden />
                  Buka Upload Excel
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
                <span className="mb-4 flex size-14 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50">
                  <Inbox className="size-7 text-slate-300" aria-hidden />
                </span>
                <p className="text-sm font-semibold text-slate-900">Data tidak ditemukan</p>
                <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-500">
                  Tidak ada fee yang cocok untuk pencarian &ldquo;{committedQuery}&rdquo;
                  {periode !== "SEMUA" && ` pada periode ${formatPeriode(periode)}`}.
                </p>
                <button
                  type="button"
                  onClick={resetFilter}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <RotateCcw className="size-4" aria-hidden />
                  Reset Filter
                </button>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-900 text-xs tracking-wider text-slate-200 uppercase">
                        <th scope="col" className="px-4 py-3 font-semibold">No</th>
                        <th scope="col" className="px-4 py-3 font-semibold">PPID</th>
                        <th scope="col" className="px-4 py-3 font-semibold">Nama Loket / Agen</th>
                        <th scope="col" className="px-4 py-3 font-semibold">Periode</th>
                        <th scope="col" className="px-4 py-3 text-right font-semibold">Total Fee (Rp)</th>
                        <th scope="col" className="px-4 py-3 font-semibold">Status Pembayaran</th>
                        <th scope="col" className="px-4 py-3 text-right font-semibold">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((row, i) => (
                        <tr
                          key={row.id}
                          className="border-b border-slate-100 transition-colors last:border-0 hover:bg-emerald-50/50"
                        >
                          <td className="px-4 py-3 text-slate-400">
                            {(safePage - 1) * PAGE_SIZE + i + 1}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs font-bold text-blue-700">
                            {row.ppid}
                          </td>
                          <td className="px-4 py-3 font-semibold text-slate-900">
                            {displayNamaLoket(row) === "" ? "—" : displayNamaLoket(row)}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {formatPeriode(row.periode)}
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-emerald-700">
                            {formatRupiah(row.totalFee)}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={cn(
                                "inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold",
                                row.status === "TERBAYAR"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-amber-200 bg-amber-50 text-amber-700"
                              )}
                            >
                              {row.status === "TERBAYAR" ? "Terbayar" : "Pending"}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => openDetail(row)}
                                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                Detail
                              </button>
                              <button
                                type="button"
                                onClick={() => openDetail(row)}
                                title="Cetak / Export PDF ringkas"
                                aria-label={`Cetak slip ${row.ppid}`}
                                className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                              >
                                <Printer className="size-4" aria-hidden />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setDeleteTarget(row);
                                  setDeleteError(null);
                                }}
                                title={isAdmin ? "Hapus baris fee ini" : "Khusus ADMIN"}
                                aria-label={`Hapus fee ${row.ppid} ${formatPeriode(row.periode)}`}
                                disabled={!isAdmin}
                                className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:bg-transparent disabled:hover:text-slate-500"
                              >
                                <Trash2 className="size-4" aria-hidden />
                              </button>
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/60 px-4 py-3">
                  <p className="text-xs font-medium text-slate-500">
                    Hal {safePage}/{totalPages}
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={safePage <= 1}
                      aria-label="Halaman sebelumnya"
                      className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                    >
                      <ChevronLeft className="size-4" aria-hidden />
                    </button>
                    {pageNumbers().map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setPage(n)}
                        aria-current={n === safePage ? "page" : undefined}
                        className={cn(
                          "min-w-9 rounded-lg px-2.5 py-2 text-xs font-semibold",
                          n === safePage
                            ? "bg-slate-900 text-white"
                            : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                        )}
                      >
                        {n}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={safePage >= totalPages}
                      aria-label="Halaman berikutnya"
                      className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                    >
                      <ChevronRight className="size-4" aria-hidden />
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>
        </>
      ) : (
        <>
          {/* Upload zone */}
          <section className="cf-card space-y-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-900">
                Upload Rekap Excel Bulanan
              </h2>
              {!isAdmin && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                  <ShieldAlert className="size-3.5" aria-hidden />
                  Mode demo — tombol Simpan khusus ADMIN
                </span>
              )}
            </div>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                pickFile(e.dataTransfer.files?.[0]);
              }}
              className={cn(
                "relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center transition-colors",
                dragOver
                  ? "border-emerald-500 bg-emerald-50"
                  : "border-slate-200 bg-slate-50/50 hover:border-emerald-300 hover:bg-white"
              )}
            >
              <FileUp className="size-8 text-emerald-600" aria-hidden />
              <p className="text-sm font-semibold text-slate-900">
                Seret file ke sini atau klik untuk memilih
              </p>
              <p className="text-xs text-slate-500">
                .xlsx / .xls / .xlsb — maks {MAX_FEE_EXCEL_SIZE_BYTES / 1024 / 1024} MB ·
                header wajib PPID + Nama + Fee
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.xlsb"
                onChange={(e) => {
                  pickFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
                aria-label="Pilih file Excel"
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </div>
            {fileMeta && (
              <p className="truncate rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-700">
                {fileMeta.name}{" "}
                <span className="text-slate-400">
                  ({formatFileSize(fileMeta.size)}
                  {fileMeta.sheet ? ` · sheet: ${fileMeta.sheet}` : ""}
                  {fileMeta.headerRow ? ` · header baris ${fileMeta.headerRow}` : ""})
                </span>
              </p>
            )}
            {parsing && (
              <p role="status" className="flex items-center gap-2 text-sm font-medium text-blue-700">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Membaca file Excel…
              </p>
            )}
            {parseError && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                {parseError}
              </p>
            )}

            {preview.length > 0 && (
              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm font-bold text-slate-900">
                    Preview {Math.min(preview.length, PREVIEW_LIMIT)} dari{" "}
                    {preview.length} baris
                    {skipped > 0 && (
                      <span className="font-normal text-slate-500">
                        {" "}· {skipped} baris kosong dilewati
                      </span>
                    )}
                  </p>
                  {detectedCols && (
                    <p
                      aria-live="polite"
                      className="w-full rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-1.5 font-mono text-[11px] leading-relaxed text-cyan-800"
                    >
                      Kolom terdeteksi: PPID→{detectedCols.ppid || "—"} · Nama→
                      {detectedCols.nama || "—"} · Fee→{detectedCols.fee || "—"}
                      {detectedCols.potongan.length > 0 &&
                        ` · Potongan→${detectedCols.potongan.join(", ")}`}
                      {detectedCols.status !== "" && ` · Status→${detectedCols.status}`}
                    </p>
                  )}
                  {parseAudit && parseAudit.allZero && (
                    <div
                      role="alert"
                      className="w-full space-y-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2"
                    >
                      <p className="text-xs font-bold text-red-700">
                        Peringatan: seluruh {parseAudit.totalRows} baris terbaca Rp 0.
                      </p>
                      <p className="text-xs leading-relaxed text-red-600">
                        Kemungkinan penyebab: (1) kolom fee salah petakan — cocokkan
                        dengan baris &ldquo;Kolom terdeteksi&rdquo; di atas; (2) sel
                        fee berupa formula tanpa nilai tersimpan — buka file di
                        Excel lalu Save agar nilai terhitung, kemudian unggah
                        ulang
                        {parseAudit.formulaWithoutValue > 0 &&
                          ` (terdeteksi ${parseAudit.formulaWithoutValue} sel)`}
                        ; (3) bandingkan sampel mentah di bawah.
                      </p>
                      {parseAudit.samples.length > 0 && (
                        <details className="rounded-lg border border-red-200 bg-white p-2">
                          <summary className="cursor-pointer text-xs font-semibold text-slate-700">
                            Diagnostik: 5 baris pertama (nilai mentah vs hasil)
                          </summary>
                          <div className="mt-2 overflow-x-auto">
                            <table className="w-full min-w-[520px] text-left font-mono text-[11px]">
                              <thead>
                                <tr className="text-slate-500">
                                  <th scope="col" className="px-2 py-1">Baris Excel</th>
                                  <th scope="col" className="px-2 py-1">PPID</th>
                                  <th scope="col" className="px-2 py-1">Sel fee mentah</th>
                                  <th scope="col" className="px-2 py-1">Hasil</th>
                                  <th scope="col" className="px-2 py-1">Formula?</th>
                                </tr>
                              </thead>
                              <tbody>
                                {parseAudit.samples.map((s) => (
                                  <tr key={`${s.matrixRow}-${s.ppid}`} className="border-t border-slate-100">
                                    <td className="px-2 py-1">{s.matrixRow + 1}</td>
                                    <td className="px-2 py-1">{s.ppid === "" ? "—" : s.ppid}</td>
                                    <td className="px-2 py-1">{JSON.stringify(s.raw) ?? "—"}</td>
                                    <td className="px-2 py-1">{formatRupiah(s.parsed)}</td>
                                    <td className="px-2 py-1">{s.hasFormula ? "Ya" : "Tidak"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const dump = {
                                file: fileMeta,
                                columns: detectedCols,
                                audit: parseAudit,
                              };
                              const blob = new Blob(
                                [JSON.stringify(dump, null, 2)],
                                { type: "application/json;charset=utf-8" }
                              );
                              downloadBlob(blob, "fee-diagnostik.json");
                            }}
                            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            <Download className="size-3.5" aria-hidden />
                            Unduh JSON diagnostik
                          </button>
                        </details>
                      )}
                    </div>
                  )}
                  {parseAudit && !parseAudit.allZero && parseAudit.totalRows > 0 &&
                    (parseAudit.formulaWithoutValue > 0 ||
                      parseAudit.zeroFeeRows / parseAudit.totalRows >= 0.5) && (
                    <div
                      role="alert"
                      className="w-full space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"
                    >
                      <p className="text-xs font-bold text-amber-800">
                        Peringatan: {parseAudit.zeroFeeRows} dari {parseAudit.totalRows} baris terbaca Rp 0.
                      </p>
                      <p className="text-xs leading-relaxed text-amber-700">
                        Periksa baris Rp 0 pada preview — kemungkinan kolom fee
                        salah petakan untuk sebagian baris
                        {parseAudit.formulaWithoutValue > 0 &&
                          ` atau sel formula tanpa nilai tersimpan (terdeteksi ${parseAudit.formulaWithoutValue} sel — buka file di Excel lalu Save dan unggah ulang)`}
                        .
                      </p>
                    </div>
                  )}
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                      Periode
                      <select
                        value={bulan}
                        onChange={(e) =>
                          applyPeriode(Number(e.target.value), tahun)
                        }
                        aria-label="Bulan periode"
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 focus:border-emerald-500 focus:outline-none"
                      >
                        {BULAN_LIST.map((b, i) => (
                          <option key={b} value={i + 1}>
                            {b}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                      <span className="sr-only">Tahun periode</span>
                      <select
                        value={tahun}
                        onChange={(e) =>
                          applyPeriode(bulan, Number(e.target.value))
                        }
                        aria-label="Tahun periode"
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 focus:border-emerald-500 focus:outline-none"
                      >
                        {[2024, 2025, 2026, 2027].map((y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() => void handleSave()}
                      disabled={saving || !isAdmin}
                      title={isAdmin ? "Simpan ke database" : "Khusus ADMIN"}
                      className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-slate-900 to-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
                    >
                      {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
                      {saving
                        ? saveProgress && saveProgress.total > 1
                          ? `Batch ${saveProgress.done}/${saveProgress.total}…`
                          : "Menyimpan…"
                        : "Simpan ke Database"}
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                  <table className="w-full min-w-[640px] text-left text-xs">
                    <thead className="bg-slate-900 text-[11px] tracking-wider text-slate-200 uppercase">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-semibold">PPID</th>
                        <th scope="col" className="px-3 py-2 font-semibold">Nama Loket</th>
                        <th scope="col" className="px-3 py-2 font-semibold">Periode</th>
                        <th scope="col" className="px-3 py-2 text-right font-semibold">Total Fee</th>
                        <th scope="col" className="px-3 py-2 text-right font-semibold">Modul</th>
                        <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {preview.slice(0, PREVIEW_LIMIT).map((r) => (
                        <tr key={r.id}>
                          <td className="px-3 py-2 font-mono font-bold text-blue-700">
                            {r.ppid}
                          </td>
                          <td className="px-3 py-2 font-medium text-slate-800">
                            {r.namaLoket}
                          </td>
                          <td className="px-3 py-2 text-slate-600">
                            {formatPeriode(previewPeriode)}
                          </td>
                          <td className="px-3 py-2 text-right font-bold text-emerald-700">
                            {formatRupiah(r.totalFee)}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-500">
                            {r.profil ? `${r.profil.details.length} rincian` : "—"}
                          </td>
                          <td className="px-3 py-2 text-slate-600">{r.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {saving && saveProgress && saveProgress.total > 1 && (
                  <div role="status" aria-live="polite" className="space-y-1.5">
                    <div
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={saveProgress.total}
                      aria-valuenow={saveProgress.done}
                      aria-label="Kemajuan upload batch"
                      className="h-2 overflow-hidden rounded-full bg-slate-200"
                    >
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-700 to-emerald-600 transition-all duration-300"
                        style={{
                          width: `${Math.round((saveProgress.done / saveProgress.total) * 100)}%`,
                        }}
                      />
                    </div>
                    <p className="text-xs font-medium text-slate-600">
                      Mengirim batch {saveProgress.done}/{saveProgress.total}…
                      ({Math.round((saveProgress.done / saveProgress.total) * 100)}%)
                    </p>
                  </div>
                )}
                {saveResult && (
                  <p role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="size-4" aria-hidden />
                    {saveResult}
                  </p>
                )}
                {verifyInfo && (
                  <div
                    role="status"
                    className={cn(
                      "rounded-lg border px-3 py-2 text-xs font-medium",
                      verifyInfo.rows > 0 && verifyInfo.zeros === verifyInfo.rows
                        ? "border-red-200 bg-red-50 text-red-700"
                        : "border-blue-200 bg-blue-50 text-blue-800"
                    )}
                  >
                    Verifikasi DB — {formatPeriode(verifyInfo.periode)}:{" "}
                    {verifyInfo.rows} baris, total {formatRupiah(verifyInfo.sum)},{" "}
                    {verifyInfo.zeros} baris Rp 0.
                    {verifyInfo.truncated && (
                      <> Menampilkan {verifyInfo.rows} dari {verifyInfo.total} baris (terpotong batas muat).</>
                    )}
                    {verifyInfo.rows > 0 && verifyInfo.zeros === verifyInfo.rows && (
                      <> Periksa mapping kolom fee sebelum menyimpan ulang.</>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Riwayat upload (dari database) */}
          <section className="cf-card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
              <History className="size-4 text-slate-400" aria-hidden />
              <h2 className="text-sm font-bold text-slate-900">
                Riwayat Upload ({logs.length})
              </h2>
            </div>
            {logsError ? (
              <p role="alert" className="p-4 text-sm text-slate-500">{logsError}</p>
            ) : logs.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-500">
                Belum ada riwayat upload.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-900 text-xs tracking-wider text-slate-200 uppercase">
                      <th scope="col" className="px-4 py-3 font-semibold">Tanggal Upload</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Nama File</th>
                      <th scope="col" className="px-4 py-3 text-right font-semibold">Jumlah Baris</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Periode</th>
                      <th scope="col" className="px-4 py-3 font-semibold">Diunggah Oleh</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-4 py-3 text-slate-600">
                          {formatDateTime(log.tanggalUpload)}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-800">
                          {log.namaFile}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900">
                          {log.jumlahBaris}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {formatPeriode(log.periode)}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{log.diunggahOleh}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Zona berbahaya: reset total database fee (khusus ADMIN). */}
          <section
            aria-label="Zona berbahaya"
            className="overflow-hidden rounded-2xl border-2 border-red-200 bg-white"
          >
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
              <span className="flex size-9 items-center justify-center rounded-xl bg-red-50 ring-1 ring-red-200">
                <AlertTriangle className="size-5 text-red-600" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-extrabold tracking-tight text-slate-900">
                  Zona Berbahaya
                </h2>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                  Hapus <em>seluruh</em> data fee (profil, rincian modul,
                  dan legacy) agar bisa re-import bersih dari awal. Riwayat
                  upload dipertahankan. Tindakan ini tidak dapat dibatalkan.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDropError(null);
                  setDropOpen(true);
                }}
                disabled={!isAdmin || dropping || listLoading}
                title={isAdmin ? "Hapus seluruh data fee" : "Khusus ADMIN"}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-opacity hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 className="size-4" aria-hidden />
                Drop All Data
              </button>
            </div>
            {!isAdmin && (
              <p className="border-t border-red-100 bg-red-50/60 px-4 py-2 text-xs font-medium text-red-600 sm:px-5">
                Mode demo — tombol Drop All Data khusus ADMIN.
              </p>
            )}
          </section>
        </>
      )}

      {/* Modal konfirmasi hapus (cegah hapus tidak sengaja) */}
      <Dialog.Root
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px]" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-2xl focus:outline-none"
          >
            {deleteTarget && (
              <>
                <div className="mb-1 flex items-start justify-between gap-3">
                  <Dialog.Title className="text-lg font-extrabold tracking-tight text-slate-900">
                    Hapus Fee
                  </Dialog.Title>
                  <Dialog.Close
                    aria-label="Tutup"
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <X className="size-5" aria-hidden />
                  </Dialog.Close>
                </div>
                <p className="mb-4 text-sm text-slate-500">
                  Hapus fee{" "}
                  <span className="font-mono font-bold text-blue-700">
                    {deleteTarget.ppid}
                  </span>{" "}
                  · {displayNamaLoket(deleteTarget)} ·{" "}
                  {formatPeriode(deleteTarget.periode)} ·{" "}
                  {formatRupiah(deleteTarget.totalFee)}? Tindakan ini tidak
                  dapat dibatalkan.
                </p>
                {deleteError && (
                  <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                    {deleteError}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <Dialog.Close
                    disabled={deleting}
                    className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Batal
                  </Dialog.Close>
                  <button
                    type="button"
                    onClick={() => void handleDeleteConfirm()}
                    disabled={deleting}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:bg-red-500 disabled:opacity-60"
                  >
                    {deleting && <Loader2 className="size-4 animate-spin" aria-hidden />}
                    {deleting ? "Menghapus…" : "Ya, Hapus"}
                  </button>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Modal konfirmasi Drop All Data — "Are you sure?" */}
      <Dialog.Root
        open={dropOpen}
        onOpenChange={(open) => {
          if (!open && !dropping) {
            setDropOpen(false);
            setDropError(null);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px]" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-2xl focus:outline-none"
          >
            <div className="mb-1 flex items-start justify-between gap-3">
              <Dialog.Title className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-red-700">
                <AlertTriangle className="size-5" aria-hidden />
                Are you sure?
              </Dialog.Title>
              <Dialog.Close
                aria-label="Tutup"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="size-5" aria-hidden />
              </Dialog.Close>
            </div>
            <p className="mb-4 text-sm leading-relaxed text-slate-500">
              Seluruh data fee akan dihapus permanen dari{" "}
              <span className="font-mono font-bold text-slate-700">
                loket_profiles
              </span>
              ,{" "}
              <span className="font-mono font-bold text-slate-700">
                loket_transaction_details
              </span>{" "}
              dan{" "}
              <span className="font-mono font-bold text-slate-700">
                fee_loket
              </span>
              . Tindakan ini tidak dapat dibatalkan — gunakan untuk re-import
              bersih dari awal.
            </p>
            {dropError && (
              <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                {dropError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Dialog.Close
                disabled={dropping}
                className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Batal
              </Dialog.Close>
              <button
                type="button"
                onClick={() => void handleDropAllConfirm()}
                disabled={dropping}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-opacity hover:bg-red-500 disabled:opacity-60"
              >
                {dropping && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {dropping ? "Menghapus…" : "Ya, Hapus Semua"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Modal detail fee (slip Master 2 kolom ala `Cari`) */}
      <Dialog.Root
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
            clearModalLookup();
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-[2px]" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-6xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white shadow-2xl focus:outline-none"
          >
            {modalLoading ? (
              <p role="status" className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
                <Loader2 className="size-5 animate-spin text-cyan-600" aria-hidden />
                Memuat slip Master…
              </p>
            ) : modalProfile ? (
              <div className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-3 border-b-2 border-slate-800 bg-slate-50 px-4 py-3 sm:px-6">
                  <Dialog.Title className="min-w-0 text-sm text-slate-700">
                    Slip Fee Loket :{" "}
                    <span className="font-mono text-base font-extrabold tracking-wide text-slate-900 uppercase">
                      {modalProfile.ppid === "" ? "—" : modalProfile.ppid}
                    </span>
                    <span className="ml-2 text-xs font-semibold text-slate-500">
                      {modalProfile.periode === ""
                        ? ""
                        : `· ${formatPeriode(modalProfile.periode)}`}
                    </span>
                  </Dialog.Title>
                  <span className="ml-auto flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void copyText(buildCariSlipText(modalProfile, modalDetails))}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white",
                        copied ? "bg-emerald-600" : "bg-slate-900 hover:opacity-90"
                      )}
                    >
                      {copied ? (
                        <Check className="size-3.5" aria-hidden />
                      ) : (
                        <Copy className="size-3.5" aria-hidden />
                      )}
                      {copied ? "Tersalin!" : "Salin Slip"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void downloadSlipPng()}
                      disabled={imgBusy !== null}
                      title="Unduh slip sebagai gambar PNG"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-60"
                    >
                      {imgBusy === "png" ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Download className="size-3.5" aria-hidden />
                      )}
                      {imgBusy === "png" ? "Merender…" : "Download PNG"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void copySlipImage()}
                      disabled={imgBusy !== null}
                      title="Salin slip sebagai gambar ke clipboard"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                    >
                      {imgBusy === "copy" ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : (
                        <ImageIcon className="size-3.5" aria-hidden />
                      )}
                      {imgBusy === "copy" ? "Menyalin…" : "Salin Gambar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Printer className="size-3.5" aria-hidden />
                      Cetak / PDF
                    </button>
                    <Dialog.Close
                      aria-label="Tutup"
                      className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-700"
                    >
                      <X className="size-4" aria-hidden />
                    </Dialog.Close>
                  </span>
                </div>
                {imgError && (
                  <p role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs font-medium text-red-700 sm:px-6">
                    {imgError}
                  </p>
                )}
                <div aria-hidden className="border-t border-dashed border-slate-400" />
                {/* Area yang dirender menjadi PNG (latar putih solid). */}
                <div ref={modalSlipRef} className="bg-white">
                  <CariSlipGrid
                    profile={modalProfile}
                    details={modalDetails}
                    legacy={modalLegacy}
                  />
                </div>
                <p className="border-t border-slate-100 px-4 py-2.5 font-mono text-[11px] text-slate-400 sm:px-6">
                  Sumber: loket_profiles + rincian modul (Excel Master) · CultFlow Workspace
                </p>
              </div>
            ) : (
              liveSelected && (
                <div className="mx-auto max-w-md p-6">
                  <div className="mb-1 flex items-start justify-between gap-3">
                    <Dialog.Title className="text-lg font-extrabold tracking-tight text-slate-900">
                      Slip Fee Loket
                    </Dialog.Title>
                    <Dialog.Close
                      aria-label="Tutup"
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                      <X className="size-5" aria-hidden />
                    </Dialog.Close>
                  </div>
                  {modalError && (
                    <p role="alert" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                      Rincian Master tak termuat ({modalError}) — menampilkan ringkasan fee.
                    </p>
                  )}
                  <div className="mb-4 grid grid-cols-[130px_12px_1fr] items-baseline gap-1 text-sm">
                    <dt className="text-slate-500">PPID</dt>
                    <dd aria-hidden className="text-slate-400">:</dd>
                    <dd className="font-mono font-bold text-blue-700">{liveSelected.ppid === "" ? "—" : liveSelected.ppid}</dd>
                    <dt className="text-slate-500">Nama Loket</dt>
                    <dd aria-hidden className="text-slate-400">:</dd>
                    <dd className="font-semibold text-slate-900">{displayNamaLoket(liveSelected) === "" ? "—" : displayNamaLoket(liveSelected)}</dd>
                    <dt className="text-slate-500">Periode</dt>
                    <dd aria-hidden className="text-slate-400">:</dd>
                    <dd className="text-slate-900">{formatPeriode(liveSelected.periode)}</dd>
                    <dt className="text-slate-500">Status</dt>
                    <dd aria-hidden className="text-slate-400">:</dd>
                    <dd className="font-semibold text-slate-900">
                      {liveSelected.status === "TERBAYAR" ? "Terbayar" : "Pending"}
                    </dd>
                  </div>
                  <div aria-hidden className="border-t border-dashed border-slate-300" />
                  <dl className="space-y-1.5 py-3">
                    {liveSelected.rincian.length === 0 ? (
                      <p className="text-sm text-slate-400">Belum ada rincian fee.</p>
                    ) : (
                      liveSelected.rincian.map((d) => (
                        <div key={d.label} className="flex items-baseline justify-between gap-3 text-sm">
                          <dt className="text-slate-600">{d.label}</dt>
                          <dd className="font-semibold text-slate-900">
                            {d.nilai < 0 ? `-${formatRupiah(Math.abs(d.nilai))}` : formatRupiah(d.nilai)}
                          </dd>
                        </div>
                      ))
                    )}
                  </dl>
                  <div aria-hidden className="border-t border-dashed border-slate-300" />
                  <div className="flex items-baseline justify-between gap-3 py-3 text-sm">
                    <span className="font-bold text-slate-900">TOTAL FEE</span>
                    <span className="font-extrabold text-emerald-700">
                      {formatRupiah(liveSelected.totalFee)}
                    </span>
                  </div>
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void copyText(buildFeeSlipText({ ...liveSelected, namaLoket: displayNamaLoket(liveSelected) }))}
                      className={cn(
                        "inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white",
                        copied ? "bg-emerald-600" : "bg-slate-900 hover:opacity-90"
                      )}
                    >
                      {copied ? (
                        <Check className="size-4" aria-hidden />
                      ) : (
                        <Copy className="size-4" aria-hidden />
                      )}
                      {copied ? "Tersalin!" : "Salin Slip"}
                    </button>
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Printer className="size-4" aria-hidden />
                      Cetak / PDF
                    </button>
                  </div>
                </div>
              )
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {toast && (
        <div
          role="status"
          className="fixed right-4 bottom-4 z-[60] flex max-w-sm items-start gap-3 rounded-xl border border-emerald-200 bg-white p-4 shadow-2xl"
        >
          <CheckCircle2 className="size-5 shrink-0 text-emerald-600" aria-hidden />
          <p className="text-sm font-bold text-slate-900">{toast}</p>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Tutup notifikasi"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
