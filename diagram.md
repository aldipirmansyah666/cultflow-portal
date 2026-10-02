# Dokumentasi Diagram Arsitektur & Flowchart Fitur System (Presisi Base Code)

## DIAGRAM 1: OVERVIEW SELURUH FITUR (DFD LEVEL 1)

```mermaid
flowchart TD
    subgraph AKTOR ["Aktor"]
        MITRA["User dan Agen"]
        ADMIN["Admin"]
    end

    subgraph FE ["Frontend Next.js App Router"]
        P_LOGIN["app login page"]
        P_DASH["app page Dashboard"]
        P_RESI["app monitoring-resi page"]
        P_UTAMA["app data-utama page"]
        P_LOOKUP["app lookup-agen page"]
        P_BAG["app bagging page"]
        P_BAIL["app bailout page"]
        P_REC["app reconcile page"]
        P_USER["app user-management page"]
    end

    subgraph BE ["Backend API Routes"]
        A_LOGIN["api auth login route"]
        A_ME["api auth me route"]
        A_LOGOUT["api auth logout route"]
        A_RESI["api resi route"]
        A_USERS["api users route"]
        A_IMPORT["api data-utama import route"]
    end

    subgraph LIB ["Lib dan Service"]
        PROXY["proxy.ts guard session dan role"]
        SESS["lib session.ts JWT cookie"]
        SVC_USER["core services userService"]
        SVC_RESI["core services resiService"]
        SVC_UTAMA["core services dataUtamaService"]
        SVC_DASH["core services dashboardService"]
    end

    subgraph DB ["Supabase Postgres"]
        T_USERS["public.users"]
        T_RESI["public.resi"]
        T_UTAMA["public.data_lengkap_utama"]
        T_BAIL["public.bailout"]
    end

    MITRA --> P_LOGIN
    MITRA --> P_DASH
    MITRA --> P_RESI
    MITRA --> P_BAG
    MITRA --> P_BAIL
    MITRA --> P_REC
    ADMIN --> P_USER
    ADMIN --> P_UTAMA

    P_LOGIN --> A_LOGIN
    P_DASH --> SVC_DASH
    P_RESI --> A_RESI
    P_USER --> A_USERS
    P_UTAMA --> A_IMPORT

    PROXY --> SESS
    A_LOGIN --> SVC_USER
    A_ME --> SESS
    A_RESI --> SVC_RESI
    A_USERS --> SVC_USER
    A_IMPORT --> SVC_UTAMA

    SVC_USER --> T_USERS
    SVC_RESI --> T_RESI
    SVC_UTAMA --> T_UTAMA
    SVC_DASH --> T_UTAMA
    SVC_DASH --> T_RESI
    SVC_DASH --> T_BAIL
```

---

## DIAGRAM 2: FLOWCHART MODUL RESI (Monitoring dan Follow-Up)

```mermaid
graph TD
    R0["Mulai - Session via getSession"] --> R1["GET api resi - status q page pageSize startDate endDate"]
    R1 --> R2["Validasi 401 bila tanpa sesi"]
    R2 --> R3["purgeExpiredResi fire-and-forget lebih dari 2 hari"]
    R3 --> R4["getResiList - filter belum sudah selesai plus search no_resi agen"]
    R4 --> R5["Render monitoring-resi page - badge pengiriman dan follow-up"]
    R5 --> R6["Aksi - Import Copas atau Update Status atau Follow-up atau Hapus"]
    R6 --> R7["POST api resi - parseResiCopasText dan sanitizeNomorResi"]
    R7 --> R8["importResiBatch check-merge - lindungi SUDAH_FOLLOWUP"]
    R6 --> R9["PATCH api resi - updateFollowUpStatus atau updateResiStatus"]
    R9 --> R10["Cek autoClose deliv delivered retur - SELESAI wajib catatan"]
    R10 --> R11["appendHistoryLog entri baru di atas plus closed_at bila tutup"]
    R6 --> R12["DELETE api resi - deleteResiBatch chunk 500"]
    R8 --> R13["Selesai"]
    R11 --> R13
    R12 --> R13
```

---

## DIAGRAM 3: FLOWCHART MODUL DATA-UTAMA IMPORT

```mermaid
graph TD
    D0["Mulai - Admin login"] --> D1["Buka app data-utama page"]
    D1 --> D2["Upload Excel Agen CUM - cek magic-bytes dan size"]
    D2 --> D3["POST api data-utama import - matrix - khusus ADMIN 403 bila USER"]
    D3 --> D4["Cek IMPORT_MAX_ROWS dan IMPORT_MAX_COLS"]
    D4 --> D5["findHeaderRowIndex - deteksi baris header"]
    D5 --> D6["mapAgenCumRowByIndex per baris"]
    D6 --> D7["dedupeByPpid - PPID menang terakhir"]
    D7 --> D8["fetchRemoteColumns plus resolveAllowedColumns"]
    D8 --> D9["sanitizeRowForDb - buang kolom tak dikenal"]
    D9 --> D10["Upsert service_role onConflict ppid ke data_lengkap_utama"]
    D10 --> D11["Kembalikan summary inserted updated skipped"]
    D11 --> D12["Dashboard update agenTotal via getDashboardStats"]
```

---

## DIAGRAM 4: FLOWCHART MODUL KEAGENAN (Bagging, Bailout, Reconcile & Lookup)

```mermaid
graph TD
    K0["Mulai - app bagging atau bailout atau reconcile atau lookup-agen"] --> K1["Pilih modul keagenan"]
    K1 -- Bagging --> K2["Upload multi Excel - parseBaggingRowsFromAOA"]
    K2 --> K3["findBaggingColumnIndices via alias Tanggal Resi Agen Layanan Status"]
    K3 --> K4["groupBaggingByAgen"]
    K4 --> K5["lookupAgenByPpid ke data_lengkap_utama"]
    K5 --> K6["buildBaggingMessage plus buildBaggingWaUrl - kirim WA"]
    K1 -- Bailout --> K7["Input Excel atau Paste - parseBailoutRowsFromAOA"]
    K7 --> K8["normalizeKodeLoket plus cleanBailoutValue Rp - skip TOTAL"]
    K8 --> K9["buildBailoutMessage Sunda-formal H-1 - export CSV"]
    K1 -- Reconcile --> K10["Upload Excel produk plus nomor_resi"]
    K10 --> K11["validateReconcileRows - EC3 SHPE P260 - PKH P260 TTSPOS 26MNG"]
    K11 --> K12["Cek coverage file PKH wajib P260 dan TTSPOS"]
    K1 -- Lookup --> K13["Cari PPID atau nama loket di data_lengkap_utama"]
    K6 --> KZ["Selesai - tanpa insert resi otomatis"]
    K9 --> KZ
    K12 --> KZ
    K13 --> KZ
```

---

## DIAGRAM 5: FLOWCHART MODUL ADMIN BACKOFFICE & AUTH

```mermaid
graph TD
    M0["Mulai - POST api auth login"] --> M1["Rate-limit 5 per menit per IP"]
    M1 --> M2["authenticateUser di public.users via service_role"]
    M2 --> M3["verifyPassword bcrypt atau SHA-256 legacy"]
    M3 --> M4["Auto-rehash legacy ke bcrypt bila needsRehash"]
    M4 --> M5["createSessionToken HS256 plus setSessionCookie cultflow_session"]
    M5 --> M6["proxy.ts - isPublicPath dan ADMIN_PREFIXES"]
    M6 --> M7{"Role ADMIN?"}
    M7 -- Bukan --> M8["Redirect ke home - tolak api users dan import 403"]
    M7 -- Ya --> M9["app user-management page"]
    M9 --> M10["GET POST PATCH DELETE api users - toSafeUser - larang hapus diri"]
    M7 -- Ya --> M11["POST api data-utama import - upsert ppid"]
    M7 -- Ya --> M12["app monitoring-resi page - hapus batch dan purge"]
    M10 --> M13["Selesai - audit via logSupabaseError"]
    M11 --> M13
    M12 --> M13
```
