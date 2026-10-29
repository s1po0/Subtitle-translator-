/**
 * Translation providers.
 *
 * Every provider takes an array of source strings and resolves to an array of
 * translated strings of the exact same length (never throws for a single bad
 * cue – failures fall back to the source text and are reported).
 *
 * All requests happen in the browser, so the user's own API keys never leave
 * their machine apart from talking directly to the provider they chose.
 */

export const LANGUAGES = [
  ['en', 'English'],
  ['ku', 'Kurdish (Sorani)'],
  ['ckb', 'Kurdish (Sorani – ckb)'],
  ['ar', 'Arabic'],
  ['tr', 'Turkish'],
  ['fa', 'Persian'],
  ['de', 'German'],
  ['fr', 'French'],
  ['es', 'Spanish'],
  ['it', 'Italian'],
  ['ru', 'Russian'],
  ['pt', 'Portuguese'],
  ['nl', 'Dutch'],
  ['sv', 'Swedish'],
  ['pl', 'Polish'],
  ['uk', 'Ukrainian'],
  ['hi', 'Hindi'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['zh', 'Chinese'],
];

export const PROVIDERS = [
  {
    id: 'demo',
    label: 'Demo (offline preview)',
    hint: 'No network. Produces placeholder text so you can test the workflow, timings and export.',
  },
  {
    id: 'mymemory',
    label: 'MyMemory (free, no key)',
    hint: 'Free public API, ~5.000 characters per day per IP. Best for short files.',
  },
  {
    id: 'libretranslate',
    label: 'LibreTranslate (self-host or key)',
    hint: 'Point it at your own LibreTranslate instance. Kurdish is supported by many instances.',
  },
  {
    id: 'openai',
    label: 'OpenAI-compatible LLM',
    hint: 'Highest quality for context and tone. Works with OpenAI, Groq, Ollama, OpenRouter…',
  },
];

const DEMO_MAP = {
  hello: 'سڵاو',
  hi: 'سڵاو',
  'good morning': 'بەیانیت باش',
  'thank you': 'سوپاس',
  thanks: 'سوپاس',
  yes: 'بەڵێ',
  no: 'نەخێر',
  please: 'تکایە',
  'i love you': 'خۆشم دەوێی',
  'what is your name': 'ناوت چییە',
  'how are you': 'چۆنی',
  'see you': 'دەتبینم',
  goodbye: 'ماڵئاوا',
  'good night': 'شەو باش',
  'my name is': 'ناوم',
  'excuse me': 'ببوورە',
  friend: 'هاوڕێ',
  love: 'خۆشەویستی',
  world: 'جیهان',
  water: 'ئاو',
  home: 'ماڵ',
  time: 'کات',
  today: 'ئەمڕۆ',
  tomorrow: 'بەیانی',
  'i am sorry': 'ببوورە',
};

function demoTranslate(text, target) {
  const mapped = text.replace(/\b(hello|good morning|thank you|what is your name|how are you|i love you|see you|good night|goodbye|excuse me|i am sorry|please|thanks|hi|yes|no|my name is|friend|love|world|water|home|time|today|tomorrow)\b/gi, (m) => {
    return DEMO_MAP[m.toLowerCase()] ?? m;
  });
  return mapped === text ? `[${target}] ${text}` : mapped;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Map our internal codes to the codes MyMemory expects. */
function myMemoryCode(code) {
  const map = { ku: 'ku', ckb: 'ku', zh: 'zh-CN', he: 'he' };
  return map[code] ?? code;
}

function splitForLimit(text, limit = 450) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let current = '';
  for (const sentence of text.split(/(?<=[.!?؟。])\s+/)) {
    if ((current + ' ' + sentence).trim().length > limit && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = `${current} ${sentence}`.trim();
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

async function fetchJSON(url, options, signal) {
  const response = await fetch(url, { ...options, signal });
  const body = await response.text();
  let data;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    throw new Error(`Unexpected response (${response.status}): ${body.slice(0, 180)}`);
  }
  if (!response.ok) {
    const message = data?.error?.message || data?.error || data?.message || body.slice(0, 180);
    throw new Error(`HTTP ${response.status} – ${message}`);
  }
  return data;
}

async function translateWithMyMemory(texts, { source, target, signal }) {
  const out = [];
  for (const text of texts) {
    const pieces = [];
    for (const chunk of splitForLimit(text)) {
      if (!chunk.trim()) {
        pieces.push(chunk);
        continue;
      }
      const url = new URL('https://api.mymemory.translated.net/get');
      url.searchParams.set('q', chunk);
      url.searchParams.set('langpair', `${myMemoryCode(source)}|${myMemoryCode(target)}`);
      const data = await fetchJSON(url.toString(), { method: 'GET' }, signal);
      const translated = data?.responseData?.translatedText;
      if (!translated) throw new Error(data?.responseDetails || 'Empty translation from MyMemory');
      pieces.push(translated);
      await sleep(120);
    }
    out.push(pieces.join(' '));
  }
  return out;
}

async function translateWithLibre(texts, { source, target, signal, config }) {
  const base = (config.libretranslateUrl || 'https://libretranslate.com').replace(/\/+$/, '');
  const out = [];
  for (const text of texts) {
    const data = await fetchJSON(
      `${base}/translate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: text,
          source,
          target,
          format: 'text',
          ...(config.libretranslateKey ? { api_key: config.libretranslateKey } : {}),
        }),
      },
      signal,
    );
    if (!data?.translatedText) throw new Error('LibreTranslate returned no translatedText');
    out.push(data.translatedText);
  }
  return out;
}

function buildLLMPrompt(texts, { source, target, glossary }) {
  const targetName = LANGUAGES.find(([code]) => code === target)?.[1] ?? target;
  const sourceName = LANGUAGES.find(([code]) => code === source)?.[1] ?? source;
  const terms = (glossary || '')
    .split('\n')
    .map((line) => line.split(/\s*(?:=>|=|:)\s*/).filter(Boolean))
    .filter((parts) => parts.length >= 2);
  return [
    {
      role: 'system',
      content: [
        `You are a professional subtitle translator. Translate from ${sourceName} to ${targetName}.`,
        'Rules: keep the exact number of items; keep line breaks inside an item; never add numbering or explanations; preserve names, slang and tone; keep each line short enough to read aloud.',
        terms.length
          ? `Glossary (always use these renderings):\n${terms.map(([a, b]) => `${a} => ${b}`).join('\n')}`
          : '',
        'Return ONLY a JSON array of strings with the same length as the input array.',
      ]
        .filter(Boolean)
        .join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify(texts),
    },
  ];
}

function parseJSONArray(raw, expectedLength) {
  const text = String(raw ?? '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('Model did not return a JSON array');
  const parsed = JSON.parse(candidate.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('Model did not return a JSON array');
  if (parsed.length !== expectedLength) {
    throw new Error(`Model returned ${parsed.length} lines instead of ${expectedLength}`);
  }
  return parsed.map((item) => String(item ?? ''));
}

async function translateWithLLM(texts, opts) {
  const { signal, config } = opts;
  const endpoint = (config.llmUrl || 'https://api.openai.com/v1/chat/completions').replace(/\/+$/, '');
  const model = config.llmModel || 'gpt-4o-mini';
  if (!config.llmKey && !/localhost|127\.0\.0\.1/.test(endpoint)) {
    throw new Error('Add an API key in Settings, or point the endpoint at a local model (e.g. Ollama).');
  }
  const headers = { 'Content-Type': 'application/json' };
  if (config.llmKey) headers.Authorization = `Bearer ${config.llmKey}`;

  const data = await fetchJSON(
    endpoint,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: buildLLMPrompt(texts, opts),
      }),
    },
    signal,
  );
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('The model returned an empty message');
  return parseJSONArray(content, texts.length);
}

async function runPool(items, limit, worker, signal) {
  const results = new Array(items.length);
  let cursor = 0;
  let failed = null;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      if (signal?.aborted) return;
      const index = cursor++;
      try {
        results[index] = { ok: true, value: await worker(items[index], index) };
      } catch (error) {
        if (signal?.aborted) return;
        results[index] = { ok: false, error };
        failed ??= error;
      }
    }
  });
  await Promise.all(runners);
  return { results, failed };
}

/**
 * Translate a list of cue objects.
 * @param {Array<{id:number,text:string}>} cues
 * @param {{provider:string, source:string, target:string, config:object, glossary?:string,
 *          onProgress?:(done:number,total:number)=>void, signal?:AbortSignal}} options
 * @returns {Promise<{translations:string[], errors:string[]}>}
 */
export async function translateCues(cues, options) {
  const {
    provider,
    source,
    target,
    config = {},
    glossary = '',
    onProgress,
    signal,
  } = options;

  const sources = cues.map((cue) => cue.text);
  const total = sources.length;
  let done = 0;
  const report = () => onProgress?.(done, total);
  const errors = [];

  if (provider === 'demo') {
    const out = [];
    for (const text of sources) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      out.push(demoTranslate(text, target));
      done += 1;
      report();
      await sleep(25);
    }
    return { translations: out, errors };
  }

  const opts = { source, target, config, glossary, signal };

  if (provider === 'openai') {
    // Group cues so one request covers many lines regardless of file size.
    const batchSize = 25;
    const batches = [];
    for (let i = 0; i < cues.length; i += batchSize) {
      batches.push({ start: i, items: cues.slice(i, i + batchSize) });
    }
    const { results, failed } = await runPool(
      batches,
      2,
      async (batch) => {
        const texts = batch.items.map((cue) => cue.text);
        const values = await translateWithLLM(texts, opts);
        done += texts.length;
        report();
        return { start: batch.start, values };
      },
      signal,
    );
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const out = sources.slice();
    let failures = 0;
    results.forEach((result, batchIndex) => {
      const batch = batches[batchIndex];
      if (result?.ok) {
        result.value.values.forEach((value, offset) => {
          out[batch.start + offset] = value;
        });
      } else {
        failures += 1;
        errors.push(`Batch ${batchIndex + 1}: ${result?.error?.message ?? 'failed'}`);
        done += batch.items.length;
        report();
      }
    });
    if (failed && failures === batches.length) throw failed;
    return { translations: out, errors };
  }

  const translateOne =
    provider === 'mymemory'
      ? async (text) => (await translateWithMyMemory([text], opts))[0]
      : async (text) => (await translateWithLibre([text], opts))[0];

  if (provider === 'mymemory' && (source === target)) {
    throw new Error('Choose two different languages.');
  }

  const { results, failed } = await runPool(
    sources,
    3,
    async (text) => {
      const value = await translateOne(text);
      done += 1;
      report();
      return value;
    },
    signal,
  );
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (failed && results.every((result) => !result?.ok)) throw failed;

  const out = sources.map((text, index) => {
    const result = results[index];
    if (result?.ok) return result.value;
    errors.push(`Cue ${index + 1}: ${result?.error?.message ?? 'failed'}`);
    done += 1;
    report();
    return text;
  });
  return { translations: out, errors };
}
