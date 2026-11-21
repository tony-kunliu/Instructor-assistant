const OCR_ASSETS = "/licence-ocr-v7";
const MAX_SIDE = 1800;
const OCR_TIMEOUT_MS = 30_000;

async function preparePhoto(file: File, signal: AbortSignal) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    signal.throwIfAborted();
    const scale = Math.min(MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight), 1);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext("2d");
    if (!context || !canvas.width || !canvas.height) throw new Error("Unreadable photo");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Runs entirely in the browser using same-origin, versioned static OCR assets. */
export async function readLearnerLicencePhoto(file: File, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  if (file.size > 20 * 1024 * 1024) throw new Error("Photo is too large");
  const canvas = await preparePhoto(file, signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: (() => void) | undefined;
  let closed = false;
  const recognise = async () => {
    const { createWorker, PSM } = await import("tesseract.js");
    if (closed) return "";
    const worker = await createWorker("eng", 1, {
      workerPath: `${OCR_ASSETS}/worker.min.js`,
      corePath: OCR_ASSETS,
      langPath: OCR_ASSETS,
      workerBlobURL: false,
      cacheMethod: "none",
      errorHandler: () => {}, // Never forward worker errors or recognised text to app logs.
    });
    try {
      if (closed) return "";
      stop = () => { void worker.terminate(); };
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      if (closed) return "";
      const { data } = await worker.recognize(canvas);
      return data.confidence >= 40 ? data.text : "";
    } finally {
      stop = undefined;
      await worker.terminate();
    }
  };
  let rejectAbort: (error: unknown) => void = () => {};
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const cancel = () => rejectAbort(signal.reason);
  signal.addEventListener("abort", cancel, { once: true });
  try {
    return await Promise.race([
      recognise(),
      aborted,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Scan timed out")), OCR_TIMEOUT_MS);
      }),
    ]);
  } finally {
    closed = true;
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
    stop?.();
    canvas.width = 0;
    canvas.height = 0;
  }
}
