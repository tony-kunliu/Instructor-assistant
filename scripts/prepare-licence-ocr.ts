import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const source = (name: string) => dirname(require.resolve(`${name}/package.json`));

/** Make every worker and engine request same-origin, even in Cloudflare builds. */
export function prepareLicenceOcr() {
  const target = fileURLToPath(new URL("../public/licence-ocr-v7/", import.meta.url));
  mkdirSync(target, { recursive: true });
  const tesseract = source("tesseract.js");
  const core = source("tesseract.js-core");
  const language = source("@tesseract.js-data/eng");
  for (const [dir, file, output = file] of [
    [tesseract, "dist/worker.min.js", "worker.min.js"],
    [core, "tesseract-core-lstm.wasm.js"],
    [core, "tesseract-core-simd-lstm.wasm.js"],
    [core, "tesseract-core-relaxedsimd-lstm.wasm.js"],
    [language, "4.0.0_best_int/eng.traineddata.gz", "eng.traineddata.gz"],
    [core, "LICENSE", "LICENSE-tesseract.txt"],
  ]) copyFileSync(join(dir, file), join(target, output));
}
