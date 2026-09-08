import { describe, expect, it, vi } from "vitest";

import {
  canNeuralTranslate,
  NLLB_TARGET,
  sourceLanguageProblem,
  supportedSourceCodes,
  toNllbSource,
} from "../src/lib/neural/languages";
import {
  clearModelCache,
  EngineError,
  NeuralEngine,
  runtimeSupport,
  type EngineState,
  type TranslationModel,
} from "../src/lib/neural/engine";

/** A fake model that records every call so we can assert on the request. */
function fakeModel(reply = "سڵاو"): {
  model: TranslationModel;
  calls: Array<{ text: string; src: string; tgt: string }>;
} {
  const calls: Array<{ text: string; src: string; tgt: string }> = [];
  const model: TranslationModel = async (text, options) => {
    calls.push({ text, src: options.src_lang, tgt: options.tgt_lang });
    return [{ translation_text: reply }];
  };
  return { model, calls };
}

describe("language mapping", () => {
  it("maps app codes onto NLLB identifiers", () => {
    expect(toNllbSource("en")).toBe("eng_Latn");
    expect(toNllbSource("ar")).toBe("arb_Arab");
    expect(toNllbSource("ru")).toBe("rus_Cyrl");
    expect(toNllbSource("zh")).toBe("zho_Hans");
  });

  it("is case and whitespace tolerant", () => {
    expect(toNllbSource(" EN ")).toBe("eng_Latn");
  });

  it("maps Kurdish Kurmanji to Latin script, distinct from the Sorani target", () => {
    expect(toNllbSource("ku")).toBe("kmr_Latn");
    expect(NLLB_TARGET).toBe("ckb_Arab");
    expect(toNllbSource("ku")).not.toBe(NLLB_TARGET);
  });

  it("refuses auto-detection, which NLLB cannot do", () => {
    expect(toNllbSource("auto")).toBeNull();
    expect(toNllbSource("")).toBeNull();
    expect(toNllbSource(undefined)).toBeNull();
    expect(toNllbSource(null)).toBeNull();
  });

  it("refuses unmapped codes rather than guessing", () => {
    expect(toNllbSource("klingon")).toBeNull();
  });

  it("reports capability and explains the blocker", () => {
    expect(canNeuralTranslate("en")).toBe(true);
    expect(canNeuralTranslate("auto")).toBe(false);
    expect(sourceLanguageProblem("en")).toBeNull();
    expect(sourceLanguageProblem("auto")).toMatch(/cannot detect the source language/i);
    expect(sourceLanguageProblem("klingon")).toMatch(/not supported/i);
  });

  it("exposes the supported source list", () => {
    const codes = supportedSourceCodes();
    expect(codes).toContain("en");
    expect(codes).not.toContain("auto");
  });
});

describe("NeuralEngine lifecycle", () => {
  it("starts disabled and refuses to translate", async () => {
    const engine = new NeuralEngine({ loader: async () => fakeModel().model });
    expect(engine.state).toBe("disabled");
    expect(engine.isReady).toBe(false);

    await expect(engine.translate("Hello", "en")).rejects.toMatchObject({
      kind: "not-ready",
    });
  });

  it("loads and reports the state transition", async () => {
    const states: EngineState[] = [];
    const engine = new NeuralEngine({
      loader: async () => fakeModel().model,
      onChange: (s) => states.push(s),
    });

    await engine.load();
    expect(engine.state).toBe("ready");
    expect(states).toEqual(["loading", "ready"]);
  });

  it("records a readable error when loading fails", async () => {
    const engine = new NeuralEngine({
      loader: async () => {
        throw new Error("network unreachable");
      },
    });

    await expect(engine.load()).rejects.toBeInstanceOf(EngineError);
    expect(engine.state).toBe("error");
    expect(engine.error).toBe("network unreachable");
  });

  it("loads only once when called concurrently", async () => {
    const loader = vi.fn(async () => fakeModel().model);
    const engine = new NeuralEngine({ loader });

    await Promise.all([engine.load(), engine.load(), engine.load()]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("returns immediately if already ready", async () => {
    const loader = vi.fn(async () => fakeModel().model);
    const engine = new NeuralEngine({ loader });
    await engine.load();
    await engine.load();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("unloads back to disabled", async () => {
    const engine = new NeuralEngine({ loader: async () => fakeModel().model });
    await engine.load();
    engine.unload();
    expect(engine.state).toBe("disabled");
    await expect(engine.translate("Hello", "en")).rejects.toMatchObject({
      kind: "not-ready",
    });
  });
});

describe("NeuralEngine translation", () => {
  it("sends the NLLB source and always the Sorani target", async () => {
    const { model, calls } = fakeModel("سڵاو");
    const engine = new NeuralEngine({ loader: async () => model });
    await engine.load();

    const out = await engine.translate("Hello", "en");
    expect(out).toBe("سڵاو");
    expect(calls[0]).toEqual({ text: "Hello", src: "eng_Latn", tgt: "ckb_Arab" });
  });

  it("rejects an unsupported source with a specific error kind", async () => {
    const engine = new NeuralEngine({ loader: async () => fakeModel().model });
    await engine.load();
    await expect(engine.translate("Hello", "auto")).rejects.toMatchObject({
      kind: "unsupported-language",
    });
  });

  it("strips markup so tags are not translated as prose", async () => {
    const { model, calls } = fakeModel();
    const engine = new NeuralEngine({ loader: async () => model });
    await engine.load();

    await engine.translate("{\\an8}<i>Hello</i> there", "en");
    expect(calls[0]?.text).toBe("Hello there");
  });

  it("does not call the model for empty or markup-only input", async () => {
    const { model, calls } = fakeModel();
    const engine = new NeuralEngine({ loader: async () => model });
    await engine.load();

    expect(await engine.translate("   ", "en")).toBe("");
    expect(await engine.translate("{\\an8}", "en")).toBe("");
    expect(calls).toHaveLength(0);
  });

  it("trims the model's reply", async () => {
    const engine = new NeuralEngine({
      loader: async () => fakeModel("  سڵاو  ").model,
    });
    await engine.load();
    expect(await engine.translate("Hello", "en")).toBe("سڵاو");
  });

  it("wraps inference failures", async () => {
    const engine = new NeuralEngine({
      loader: async () => async () => {
        throw new Error("out of memory");
      },
    });
    await engine.load();
    await expect(engine.translate("Hello", "en")).rejects.toMatchObject({
      kind: "inference-failed",
      message: "out of memory",
    });
  });

  it("translates a batch sequentially and reports progress", async () => {
    const order: string[] = [];
    const model: TranslationModel = async (text) => {
      order.push(text);
      return [{ translation_text: `→${text}` }];
    };
    const engine = new NeuralEngine({ loader: async () => model });
    await engine.load();

    const seen: number[] = [];
    const out = await engine.translateMany(["a", "b", "c"], "en", (done) =>
      seen.push(done),
    );

    expect(order).toEqual(["a", "b", "c"]);
    expect(out).toEqual(["→a", "→b", "→c"]);
    expect(seen).toEqual([1, 2, 3]);
  });

  it("handles an empty batch", async () => {
    const engine = new NeuralEngine({ loader: async () => fakeModel().model });
    await engine.load();
    await expect(engine.translateMany([], "en")).resolves.toEqual([]);
  });
});

describe("environment helpers", () => {
  it("reports no cache API in a non-browser environment", async () => {
    await expect(clearModelCache()).resolves.toBe(0);
  });

  it("reports no runtime when there is no window", () => {
    expect(runtimeSupport().supported).toBe(false);
  });
});
