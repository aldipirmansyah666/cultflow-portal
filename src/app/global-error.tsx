"use client";

/**
 * Error boundary terakhir: tampil bila RootLayout sendiri gagal
 * (mis. LayoutShell crash), sehingga `error.tsx` tidak bisa dipakai.
 * WAJIB merender <html>/<body> sendiri — tidak boleh mengimpor
 * globals.css atau layout agar tidak ikut crash.
 */

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app:global-error]", error);
  }, [error]);

  return (
    <html lang="id">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f8fafc",
          fontFamily: "system-ui, sans-serif",
          padding: 16,
        }}
      >
        <div
          role="alert"
          style={{
            maxWidth: 480,
            width: "100%",
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 16,
            padding: 24,
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>
            Aplikasi gagal dimuat
          </h1>
          <p style={{ fontSize: 14, color: "#64748b" }}>
            Terjadi kesalahan fatal pada kerangka aplikasi.
            {error.digest ? ` (digest: ${error.digest})` : ""}
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                flex: 1,
                border: 0,
                borderRadius: 8,
                padding: "10px 16px",
                fontSize: 14,
                fontWeight: 600,
                color: "#fff",
                background: "linear-gradient(to right, #1d4ed8, #0891b2)",
                cursor: "pointer",
              }}
            >
              Coba Lagi
            </button>
            {/* next/link sengaja tidak dipakai: global-error berjalan saat
                root layout/router crash sehingga konteks router tak tersedia. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                flex: 1,
                borderRadius: 8,
                padding: "10px 16px",
                fontSize: 14,
                fontWeight: 600,
                color: "#334155",
                border: "1px solid #e2e8f0",
                textDecoration: "none",
                textAlign: "center",
              }}
            >
              Kembali ke Dashboard
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
