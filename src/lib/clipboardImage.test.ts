import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  ClipboardImageError,
  clipboardImageBlockMessage,
  copyPngToClipboard,
  describeClipboardImageError,
  detectClipboardImageBlock,
  expandScrollableRegions,
  renderNodeToPngBlob,
} from "./clipboardImage";

/** Mock html-to-image (jsdom tak bisa merender SVG foreignObject). */
const toBlobMock = vi.fn(
  async (node?: unknown, options?: unknown): Promise<Blob | null> => {
    void node;
    void options;
    return new Blob([new Uint8Array(4)], { type: "image/png" });
  }
);
vi.mock("html-to-image", () => ({
  toBlob: (...args: unknown[]) => toBlobMock(...(args as [])),
}));

/**
 * Fake ClipboardItem: mencatat data yang diberikan dan meniru perilaku
 * engine yang menerima maupun menolak Promise-valued item.
 */
class FakeClipboardItem {
  static supports = vi.fn(() => true);
  readonly data: Record<string, unknown>;
  constructor(items: Record<string, unknown>) {
    // Engine yang TIDAK menerima Promise → lempar TypeError.
    if (Object.values(items).some((v) => v instanceof Promise)) {
      throw new TypeError("Promise is not a valid ClipboardItem value");
    }
    this.data = items;
  }
}

/** Engine modern: menerima Blob maupun Promise<Blob>. */
class PromiseAwareItem {
  static supports = vi.fn(() => true);
  readonly data: Record<string, unknown>;
  constructor(items: Record<string, unknown>) {
    this.data = items;
  }
}

function pngBlob(size = 4): Blob {
  return new Blob([new Uint8Array(size)], { type: "image/png" });
}

/** Clipboard sungguhan: me-resolve nilai item (Promise ikut di-resolve). */
function makeWriteMock() {
  return vi.fn(async (items: { data: Record<string, unknown> }[]) => {
    for (const item of items) {
      for (const value of Object.values(item.data)) {
        if (value instanceof Promise) await value;
      }
    }
  });
}

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", {
    value,
    configurable: true,
  });
}

function setClipboardItem(value: unknown) {
  Object.defineProperty(window, "ClipboardItem", {
    value,
    configurable: true,
    writable: true,
  });
}

describe("detectClipboardImageBlock", () => {
  const originalClipboard = navigator.clipboard;
  const originalItem = window.ClipboardItem;

  afterEach(() => {
    setClipboard(originalClipboard);
    setClipboardItem(originalItem);
  });

  it("mengembalikan null saat clipboard + ClipboardItem tersedia", () => {
    setClipboard({ write: vi.fn() });
    setClipboardItem(PromiseAwareItem);
    expect(detectClipboardImageBlock()).toBeNull();
  });

  it("menandai browser tanpa Clipboard API", () => {
    setClipboard(undefined);
    expect(detectClipboardImageBlock()).toBe("no-clipboard-api");
  });

  it("menandai browser tanpa ClipboardItem", () => {
    setClipboard({ write: vi.fn() });
    setClipboardItem(undefined);
    expect(detectClipboardImageBlock()).toBe("no-clipboard-item");
  });

  it("menandai clipboard yang tidak mendukung image/png", () => {
    setClipboard({ write: vi.fn() });
    class NoPng extends PromiseAwareItem {
      static supports = vi.fn(() => false);
    }
    setClipboardItem(NoPng);
    expect(detectClipboardImageBlock()).toBe("no-image-png");
  });

  it("setiap blokir punya pesan yang menyebut alternatif Download PNG", () => {
    for (const block of [
      "insecure-context",
      "no-clipboard-api",
      "no-clipboard-item",
      "no-image-png",
      "hidden-document",
    ] as const) {
      expect(clipboardImageBlockMessage(block)).toMatch(/Download PNG/);
    }
  });
});

describe("expandScrollableRegions", () => {
  it("membentangkan kontainer scroll lalu mengembalikannya persis", () => {
    document.body.innerHTML = `
      <div id="wrap">
        <div class="rincian-scroll" style="max-height: 480px; overflow: auto;">a</div>
      </div>`;
    const wrap = document.getElementById("wrap") as HTMLElement;
    const scroller = wrap.querySelector(".rincian-scroll") as HTMLElement;

    const restore = expandScrollableRegions(wrap);
    expect(scroller.style.maxHeight).toBe("none");
    expect(scroller.style.height).toBe("auto");
    expect(scroller.style.overflow).toBe("visible");

    restore();
    expect(scroller.style.maxHeight).toBe("480px");
    expect(scroller.style.height).toBe("");
    expect(scroller.style.overflow).toBe("auto");
  });
});

describe("copyPngToClipboard", () => {
  const originalClipboard = navigator.clipboard;
  const originalItem = window.ClipboardItem;

  beforeEach(() => {
    FakeClipboardItem.supports = vi.fn(() => true);
    PromiseAwareItem.supports = vi.fn(() => true);
  });

  afterEach(() => {
    setClipboard(originalClipboard);
    setClipboardItem(originalItem);
  });

  it("menulis PNG lewat ClipboardItem berbasis Promise (jalur Safari)", async () => {
    const write = makeWriteMock();
    setClipboard({ write });
    setClipboardItem(PromiseAwareItem);

    await copyPngToClipboard(Promise.resolve(pngBlob()));

    expect(write).toHaveBeenCalledTimes(1);
    const items = write.mock.calls[0][0] as { data: Record<string, unknown> }[];
    expect(items[0].data["image/png"]).toBeInstanceOf(Promise);
  });

  it("memanggil clipboard.write secara sinkron (user activation utuh)", () => {
    const write = vi.fn(() => new Promise<void>(() => {}));
    setClipboard({ write });
    setClipboardItem(PromiseAwareItem);

    // Tidak di-await: bila `write` terpanggil sinkron, meansinya user
    // activation WebKit belum kedaluwarsa (bug #244812).
    void copyPngToClipboard(Promise.resolve(pngBlob()));
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("fallback ke Blob final bila engine menolak Promise-valued item", async () => {
    const write = makeWriteMock();
    setClipboard({ write });
    setClipboardItem(FakeClipboardItem);

    await copyPngToClipboard(Promise.resolve(pngBlob()));

    expect(write).toHaveBeenCalledTimes(1);
    const items = write.mock.calls[0][0] as { data: Record<string, unknown> }[];
    expect(items[0].data["image/png"]).toBeInstanceOf(Blob);
  });

  it("melempar error terstruktur bila clipboard tidak tersedia", async () => {
    setClipboard(undefined);
    await expect(copyPngToClipboard(Promise.resolve(pngBlob()))).rejects.toThrow(
      ClipboardImageError
    );
  });

  it("meneruskan kegagalan render (promise ditolak) ke pemanggil", async () => {
    setClipboard({ write: makeWriteMock() });
    setClipboardItem(PromiseAwareItem);

    await expect(
      copyPngToClipboard(Promise.reject(new Error("render gagal")))
    ).rejects.toThrow("render gagal");
  });
});

describe("describeClipboardImageError", () => {
  it("memetakan NotAllowedError ke pesan yang actionable", () => {
    const err = new Error("Write permission denied");
    err.name = "NotAllowedError";
    expect(describeClipboardImageError(err)).toMatch(/Download PNG/);
  });

  it("memakai pesan ClipboardImageError apa adanya", () => {
    expect(
      describeClipboardImageError(
        new ClipboardImageError("Render slip kosong.", "failed")
      )
    ).toBe("Render slip kosong.");
  });

  it("menyertakan pesan asli untuk error lain", () => {
    expect(describeClipboardImageError(new Error("boom"))).toContain("boom");
  });
});

describe("renderNodeToPngBlob", () => {
  beforeEach(() => {
    toBlobMock.mockClear();
    toBlobMock.mockResolvedValue(new Blob([new Uint8Array(4)], { type: "image/png" }));
  });

  it("menghasilkan Blob bertipe image/png", async () => {
    const node = document.createElement("div");
    node.textContent = "slip";
    document.body.appendChild(node);

    const blob = await renderNodeToPngBlob(node, { pixelRatio: 2 });
    expect(blob.type).toBe("image/png");
    expect(toBlobMock).toHaveBeenCalledTimes(1);
    const [renderedNode, options] = toBlobMock.mock.calls[0] as [
      HTMLElement,
      { pixelRatio: number; backgroundColor: string },
    ];
    expect(renderedNode).toBe(node);    expect(options.pixelRatio).toBe(2);
    node.remove();
  });

  it("menormalisasi tipe blob yang bukan PNG", async () => {
    toBlobMock.mockResolvedValue(new Blob(["x"], { type: "text/plain" }));
    const node = document.createElement("div");
    const blob = await renderNodeToPngBlob(node);
    expect(blob.type).toBe("image/png");
  });

  it("melempar ClipboardImageError saat render kosong", async () => {
    toBlobMock.mockResolvedValue(null);
    const node = document.createElement("div");
    await expect(renderNodeToPngBlob(node)).rejects.toThrow(ClipboardImageError);
  });

  it("tanpa padding: viewport mengikuti ukuran node asli", async () => {
    const node = document.createElement("div");
    Object.defineProperty(node, "clientWidth", { value: 480 });
    Object.defineProperty(node, "clientHeight", { value: 900 });

    await renderNodeToPngBlob(node);

    const options = toBlobMock.mock.calls[0][1] as Record<string, unknown>;
    expect(options.width).toBeUndefined();
    expect(options.height).toBeUndefined();
    expect(options.style).toBeUndefined();
  });

  it("dengan padding: viewport dilebarkan 2x padding + border-box", async () => {
    const node = document.createElement("div");
    Object.defineProperty(node, "clientWidth", { value: 480 });
    Object.defineProperty(node, "clientHeight", { value: 900 });

    await renderNodeToPngBlob(node, { padding: 16 });

    const options = toBlobMock.mock.calls[0][1] as {
      width: number;
      height: number;
      style: Record<string, string>;
    };
    // Viewport SVG harus selebar konten asli + 2x margin, supaya
    // konten tidak terpotong oleh padding klon.
    expect(options.width).toBe(512);
    expect(options.height).toBe(932);
    expect(options.style.padding).toBe("16px");
    expect(options.style.boxSizing).toBe("border-box");
  });

  it("gaya manual digabung dengan style bawaan padding", async () => {
    const node = document.createElement("div");
    Object.defineProperty(node, "clientWidth", { value: 300 });
    Object.defineProperty(node, "clientHeight", { value: 400 });

    await renderNodeToPngBlob(node, { padding: 8, style: { color: "red" } });

    const options = toBlobMock.mock.calls[0][1] as {
      style: Record<string, string>;
    };
    expect(options.style.color).toBe("red");
    expect(options.style.padding).toBe("8px");
  });
});
