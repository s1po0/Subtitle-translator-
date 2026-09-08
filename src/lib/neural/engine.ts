/**
 * The embedded neural translation engine.
 *
 * This runs entirely on the user's device: weights are downloaded once from the
 * Hugging Face Hub, cached by the browser, and inference happens locally. There
 * is no API key, no server, and subtitle text is never sent anywhere.
 *
 * Two properties are load-bearing and worth stating plainly:
 *
 * 1. **It is opt-in and off by default.** Nothing is imported or downloaded
 *    unless the user enables it, so an untouched install makes no network
 *    requests at all — the guarantee the rest of the app documents.
 * 2. **The runtime is dynamically imported.** `@huggingface/transformers` and
 *    its ONNX runtime are heavy, so they live in a separate chunk that is only
 *    fetched when the engine is enabled.
 *
 * The model loader is injectable, which is what lets the state machine and
 * error handling be unit-tested without downloading 242 MB of weights.
 */

import { NLLB_TARGET, toNllbSource } from "./languages";
import { stripAllMarkup } from "../sanitize";

export const MODEL_ID = "Xenova/nllb-200-distilled-600M";
/** Approximate download size of the quantised model, for UI copy. */
export const MODEL_DOWNLOAD_LABEL = "≈ 242 MB";

export type EngineState = "disabled" | "idle" | "loading" | "ready" | "error";

export interface EngineProgress {
  /** transformers.js progress status, e.g. "download", "progress", "done". */
  status: string;
  file?: string;
  loaded?: number;
  total?: number;
}

export interface TranslationModel {
  (
    text: string,
    options: { src_lang: string; tgt_lang: string; max_new_tokens?: number },
  ): Promise<Array<{ translation_text: string }>>;
}

export type ModelLoader = (
  onProgress: (progress: EngineProgress) => void,
) => Promise<TranslationModel>;

export class EngineError extends Error {
  constructor(
    message: string,
    readonly kind: "not-ready" | "unsupported-language" | "load-failed" | "inference-failed",
  ) {
    super(message);
    this.name = "EngineError";
  }
}

/**
 * Default loader: pulls in the runtime on demand and builds a translation
 * pipeline. Kept as a standalone function so it is only evaluated when called.
 */
export const defaultModelLoader: ModelLoader = async (onProgress) => {
  const transformers = await import("@huggingface/transformers");

  // Never look for models on disk, and report download progress upward.
  transformers.env.allowLocalModels = false;
  const wasm = transformers.env.backends?.onnx?.wasm;
  if (wasm) {
    // One thread is the safe default: several browsers still mishandle
    // SharedArrayBuffer in workers, and subtitles are short enough that the
    // extra threads do not pay for the setup cost.
    wasm.numThreads = 1;
    wasm.proxy = false;
  }

  const pipeline = await transformers.pipeline("translation", MODEL_ID, {
    dtype: "q8",
    progress_callback: (raw: unknown) => {
      const p = (raw ?? {}) as Record<string, unknown>;
      onProgress({
        status: String(p.status ?? "unknown"),
        file: typeof p.file === "string" ? p.file : undefined,
        loaded: typeof p.loaded === "number" ? p.loaded : undefined,
        total: typeof p.total === "number" ? p.total : undefined,
      });
    },
  });

  return pipeline as unknown as TranslationModel;
};

export interface NeuralEngineOptions {
  loader?: ModelLoader;
  /** Emitted on every state change so React can re-render. */
  onChange?: (state: EngineState, error: string | null) => void;
}

export class NeuralEngine {
  #model: TranslationModel | null = null;
  #state: EngineState = "disabled";
  #error: string | null = null;
  #loader: ModelLoader;
  #onChange: NeuralEngineOptions["onChange"];
  #loading: Promise<void> | null = null;

  constructor(options: NeuralEngineOptions = {}) {
    this.#loader = options.loader ?? defaultModelLoader;
    this.#onChange = options.onChange;
  }

  get state(): EngineState {
    return this.#state;
  }

  get error(): string | null {
    return this.#error;
  }

  get isReady(): boolean {
    return this.#state === "ready";
  }

  #transition(state: EngineState, error: string | null = null): void {
    this.#state = state;
    this.#error = error;
    this.#onChange?.(state, error);
  }

  /** Enable the engine and load weights. Safe to call repeatedly. */
  async load(onProgress?: (p: EngineProgress) => void): Promise<void> {
    if (this.#state === "ready") return;
    if (this.#loading) return this.#loading;

    this.#transition("loading");
    this.#loading = (async () => {
      try {
        this.#model = await this.#loader(onProgress ?? (() => {}));
        this.#transition("ready");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "The model could not be loaded.";
        this.#model = null;
        this.#transition("error", message);
        throw new EngineError(message, "load-failed");
      } finally {
        this.#loading = null;
      }
    })();

    return this.#loading;
  }

  /** Free the model. Weights stay in the browser cache for next time. */
  unload(): void {
    this.#model = null;
    this.#loading = null;
    this.#transition("disabled");
  }

  /**
   * Translate one string.
   *
   * Markup is stripped first: bold/italic tags in a machine draft are
   * unreliable, and an ASS override block would be translated as prose. The
   * original entry keeps its markup; only the draft is plain text.
   */
  async translate(
    text: string,
    sourceCode: string,
    options: { maxNewTokens?: number } = {},
  ): Promise<string> {
    if (this.#state !== "ready" || this.#model === null) {
      throw new EngineError(
        "The neural engine is not loaded. Enable it in Settings first.",
        "not-ready",
      );
    }

    const src = toNllbSource(sourceCode);
    if (src === null) {
      throw new EngineError(
        `Cannot translate from source language "${sourceCode}". Choose a specific source language.`,
        "unsupported-language",
      );
    }

    const plain = stripAllMarkup(text).trim();
    if (plain === "") return "";

    try {
      const result = await this.#model(plain, {
        src_lang: src,
        tgt_lang: NLLB_TARGET,
        max_new_tokens: options.maxNewTokens ?? 128,
      });
      return (result[0]?.translation_text ?? "").trim();
    } catch (err) {
      throw new EngineError(
        err instanceof Error ? err.message : "Translation failed.",
        "inference-failed",
      );
    }
  }

  /**
   * Translate many strings sequentially.
   *
   * Deliberately not concurrent: inference is CPU/GPU-bound, so parallel calls
   * contend for the same worker and only add memory pressure. Progress is
   * reported so the UI can show a real percentage on long files.
   */
  async translateMany(
    texts: string[],
    sourceCode: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < texts.length; i += 1) {
      out.push(await this.translate(texts[i] ?? "", sourceCode));
      onProgress?.(i + 1, texts.length);
    }
    return out;
  }
}

/**
 * Delete cached weights from the Cache API.
 *
 * transformers.js stores model files in Cache Storage under names derived from
 * the model id, so this removes only our own entries.
 */
export async function clearModelCache(): Promise<number> {
  if (typeof caches === "undefined") return 0;
  const keys = await caches.keys();
  const doomed = keys.filter((key) => key.includes("nllb-200-distilled-600M"));
  await Promise.all(doomed.map((key) => caches.delete(key)));
  return doomed.length;
}

/** Whether the browser can run the engine at all. */
export function runtimeSupport(): { supported: boolean; detail: string } {
  if (typeof window === "undefined") {
    return { supported: false, detail: "Server-side rendering has no runtime." };
  }
  // The WASM backend works without WebGPU; WebGPU only makes it faster.
  const webgpu = typeof navigator !== "undefined" && "gpu" in navigator;
  return {
    supported: typeof WebAssembly !== "undefined",
    detail: webgpu
      ? "WebGPU available — the engine can use your GPU."
      : "No WebGPU; the engine will run on the CPU via WebAssembly (slower, but functional).",
  };
}
