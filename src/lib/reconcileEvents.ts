import type { StoredPrefixSuggestion } from "@/core/services/prefixSuggestionService";

export const PREFIX_SUGGESTIONS_CHANGED_EVENT =
  "reconcile:prefix-suggestions-changed";

export interface PrefixSuggestionsChangedDetail {
  /** Baris yang baru diputuskan; kosong berarti hanya jumlah badge berubah. */
  suggestion?: StoredPrefixSuggestion;
}

/** Sinkronkan badge notifikasi dan kartu usulan di halaman Reconcile. */
export function emitPrefixSuggestionsChanged(
  suggestion?: StoredPrefixSuggestion
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<PrefixSuggestionsChangedDetail>(
      PREFIX_SUGGESTIONS_CHANGED_EVENT,
      { detail: { suggestion } }
    )
  );
}
