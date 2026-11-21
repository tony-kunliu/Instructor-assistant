const OCR_ASSETS = "/licence-ocr-v7";
const MAX_SIDE = 1800;
const OCR_TIMEOUT_MS = 30_000;

async function preparePhoto(file: File, signal: AbortSignal) {
  const url = URL.createObjectURL(file);
  const canvas = document.createElement("canvas");
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    signal.throwIfAborted();
    const scale = Math.min(MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight), 1);
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext("2d");
    if (!context || !canvas.width || !canvas.height) throw new Error("Unreadable photo");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const picture = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Unreadable photo")));
    });
    return picture.arrayBuffer();
  } finally {
    URL.revokeObjectURL(url);
    canvas.width = 0;
    canvas.height = 0;
  }
}

type Job = "load" | "loadLanguage" | "initialize" | "setParameters" | "recognize";

// This protocol belongs to the pinned Tesseract v7 static worker. Retaining the Worker
// handle lets us stop it even when engine bootstrap fails before the library facade is ready.
function job<T>(worker: Worker, action: Job, payload: object, signal: AbortSignal, transfer: Transferable[] = []): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const clean = () => {
      worker.removeEventListener("message", reply);
      worker.removeEventListener("error", fail);
      worker.removeEventListener("messageerror", fail);
      signal.removeEventListener("abort", cancel);
    };
    const fail = () => { clean(); reject(new Error("Licence recognition failed")); };
    const cancel = () => { clean(); reject(signal.reason); };
    const reply = ({ data }: MessageEvent<{ jobId: string; status: string; data: T }>) => {
      if (data.jobId !== action || data.status === "progress") return;
      if (data.status !== "resolve") return fail();
      clean();
      resolve(data.data);
    };
    worker.addEventListener("message", reply);
    worker.addEventListener("error", fail);
    worker.addEventListener("messageerror", fail);
    signal.addEventListener("abort", cancel, { once: true });
    try { worker.postMessage({ workerId: "licence", jobId: action, action, payload }, transfer); }
    catch { fail(); }
  });
}

/** Runs entirely in the browser using same-origin, versioned static OCR assets. */
export async function readLearnerLicencePhoto(file: File, callerSignal: AbortSignal): Promise<string> {
  callerSignal.throwIfAborted();
  if (file.size > 20 * 1024 * 1024) throw new Error("Photo is too large");
  const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(OCR_TIMEOUT_MS)]);
  const buffer = await preparePhoto(file, signal);
  signal.throwIfAborted();
  const assets = new URL(OCR_ASSETS, window.location.origin).href;
  const worker = new Worker(`${assets}/worker.min.js`);
  try {
    const langs = ["eng"];
    await job(worker, "load", { options: { lstmOnly: true, corePath: assets } }, signal);
    await job(worker, "loadLanguage", { langs, options: { langPath: assets, cacheMethod: "none", gzip: true, lstmOnly: true } }, signal);
    await job(worker, "initialize", { langs, oem: 1, config: {} }, signal);
    await job(worker, "setParameters", { params: { tessedit_pageseg_mode: "11" } }, signal);
    const result = await job<{ confidence: number; text: string }>(
      worker, "recognize", { image: new Uint8Array(buffer), options: {}, output: { text: true } }, signal, [buffer],
    );
    return result.confidence >= 40 ? result.text : "";
  } finally {
    worker.terminate();
  }
}
