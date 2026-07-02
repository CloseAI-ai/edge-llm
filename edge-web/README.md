# @sauravpanda/edge-llm

[![npm](https://img.shields.io/npm/v/@sauravpanda/edge-llm.svg)](https://www.npmjs.com/package/@sauravpanda/edge-llm)
[![License](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](LICENSE)

Browser bindings for [Edge LLM](https://github.com/sauravpanda/edgellm) — a WASM-first LLM inference engine with WebGPU acceleration, built in pure Rust.

Run GGUF models directly in the browser: zero server costs, data never leaves the device, WebGPU when available with a WASM SIMD128 fallback.

**[→ Live demo](https://sauravpanda.github.io/edgellm/)**

## Install

```bash
npm install @sauravpanda/edge-llm
```

## Quick start

```javascript
import init, { EdgeEngine, EdgeTokenizer, webgpu_available } from '@sauravpanda/edge-llm';

// Initialise the WASM module
await init();

// Fetch a GGUF model (e.g. SmolLM2-135M Q8_0)
const modelBytes = await fetch('/models/smollm2-135m-q8.gguf')
  .then(r => new Uint8Array(await r.arrayBuffer()));
const tokenizerJson = await fetch('/models/tokenizer.json').then(r => r.text());

const engine = EdgeEngine.load(modelBytes);
const tokenizer = EdgeTokenizer.from_json(tokenizerJson);

// Opt into WebGPU if the browser supports it
if (webgpu_available()) {
  await engine.init_gpu();
}

// Use the model's chat template
const prompt = engine.apply_chat_template(
  'Explain quantum computing in simple terms.',
  'You are a helpful assistant.'
);
const ids = tokenizer.encode(prompt);

// Stream tokens one at a time
engine.begin_stream(ids, 128);
let out = '';
while (true) {
  const id = engine.next_token();
  if (id === undefined) break;
  out += tokenizer.decode_one(id);
}
console.log(out);
```

## API surface

### `EdgeEngine`
- `EdgeEngine.load(bytes)` — parse a GGUF buffer and build the model
- `init_gpu()` — opt into WebGPU (no-op if unsupported)
- `apply_chat_template(user, system)` — format a prompt with the model's detected template
- `begin_stream(ids, maxTokens)` / `next_token()` — token-by-token streaming
- `generate_tokens(ids, maxTokens)` — one-shot greedy generation
- `begin_stream_with_params(ids, max, temp, topP, topK, repeatPenalty)` — sampled streaming
- `add_stop_sequence(str)` / `clear_stop_sequences()` — early stopping
- `reset()` — clear KV cache between conversations
- `embed_token(id)` / `output_projection(hidden)` — head/tail primitives for P2P experimentation

### `EdgeTokenizer`
- `EdgeTokenizer.from_json(str)` — load a HuggingFace `tokenizer.json`
- `encode(text)` / `decode(ids)` / `decode_one(id)`

### `EdgeProgressiveLoader`
Stream model weights and start inference before the full download completes.

### Utilities
- `webgpu_available()` — feature detection for WebGPU
- `supports_relaxed_simd()`, `supports_webnn()`, `supports_webtransport()`
- `device_info()` — human-readable GPU/CPU description
- `cache_model(name, bytes)`, `load_cached_model(name)`, `is_model_cached(name)`,
  `list_cached_models()`, `delete_cached_model(name)`, `storage_estimate()` —
  Cache API integration for offline model persistence

Full typings live in [`pkg/edge_web.d.ts`](pkg/edge_web.d.ts).

## Web Worker usage

Inference blocks the thread it runs on. For a responsive UI, run `EdgeEngine` inside a Web Worker and post tokens back to the main thread. A reference worker is included in [`js/worker.ts`](js/worker.ts), and [`demo/`](demo/) contains a complete streaming chat example.

## Server headers for WebGPU + SharedArrayBuffer

WebGPU works without special headers. To enable the multi-worker WASM path (SharedArrayBuffer), serve your page with:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## Browser support

| Browser | WebGPU | WASM SIMD128 | Multi-worker |
|---|---|---|---|
| Chrome / Edge 113+ | Yes | Yes | With COOP/COEP |
| Safari 18+ | Yes | Yes | With COOP/COEP |
| Firefox 141+ | Yes | Yes | With COOP/COEP |
| Older browsers | Fallback to SIMD128 | Yes | — |

## License

MIT OR Apache-2.0
