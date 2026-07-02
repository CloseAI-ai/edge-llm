# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Edge LLM is a WASM-first LLM inference engine in pure Rust. Single codebase compiles to native binary and WASM for browser/edge deployment. Dual compute path: WebGPU (primary via wgpu + WGSL shaders) with WASM SIMD128 CPU fallback in browsers, and runtime-detected SIMD (NEON/AVX2/AMX) on native.

## Build & Test Commands

```bash
# Build (native)
cargo build --release

# Build (WASM browser target)
wasm-pack build edge-web --target web

# Run all tests (550+)
cargo test --workspace

# Run a single crate's tests
cargo test -p edgellm-core

# Run a specific test by name
cargo test -p edgellm-core test_matvec_simd_matches_scalar

# Lint (CI fails on any warning)
cargo clippy --workspace --all-targets -- -D warnings

# Format check
cargo fmt --all -- --check

# Doc build
cargo doc --workspace --no-deps --all-features
```

## Benchmarks

```bash
# Criterion microbenchmarks (matmul, sampling)
cargo bench -p edgellm-simd

# CPU matvec benchmark
cargo run -p edgellm-core --example matvec_bench --release

# GPU vs CPU benchmark
cargo run -p edgellm-gpu --example gpu_bench --release

# End-to-end benchmark (requires models/smollm2-135m-instruct-q8_0.gguf)
cargo run -p edgellm-server --example e2e_bench --release

# Append result to BENCHMARK_HISTORY.md
cargo run -p edgellm-server --example e2e_bench --release -- --log

# Benchmark all GGUF models in models/
./scripts/bench_multi.sh
./scripts/bench_multi.sh --json   # machine-readable
./scripts/bench_multi.sh --log    # append to history
```

If a change affects inference speed, run the e2e benchmark and include results in the PR. Baseline: SmolLM2-135M-Instruct Q8_0.

## Running the Server & Demo

```bash
# Native server (OpenAI-compatible API on port 8080)
cargo run -p edgellm-server --release -- --model models/smollm2-135m-instruct-q8_0.gguf

# Browser demo
wasm-pack build edge-web --target web
cd edge-web && python3 -m http.server 8000
# Open http://localhost:8000/demo/
```

## Workspace Crates

Directory names use `edge-*` prefix; package names use `edgellm-*` (because `edge-core` was taken on crates.io).

| Crate | Package | Purpose |
|---|---|---|
| `edge-core/` | `edgellm-core` | Core inference: tensor ops, model forward pass, KV cache, sampling, tokenizer, chat templates, LoRA |
| `edge-loader/` | `edgellm-loader` | Model loading: GGUF parser, SafeTensors parser, quantization, progressive/streaming loading |
| `edge-gpu/` | `edgellm-gpu` | WebGPU/wgpu compute backend + 44 WGSL shaders in `shaders/` |
| `edge-simd/` | `edgellm-simd` | WASM SIMD128 CPU fallback backend |
| `edge-web/` | `edgellm-web` | Browser integration: wasm-bindgen, WebGPU init, Cache API, Web Worker, OPFS |
| `edge-server/` | `edgellm-server` | Native server (axum), CLI, model info — 3 binaries |
| `edge-edge/` | `edgellm-edge` | Serverless edge runtime: Cloudflare Workers, Fermyon Spin, Deno Deploy |
| `edgellm/` | `edgellm` | Umbrella crate re-exporting core + optional loader/gpu |

## Architecture

**Core inference path** (`edge-core`): `model.rs` (Llama transformer) → `generate.rs` (generation loop) → `sampling.rs` (temperature/top_p/top_k/min_p). KV cache in `kv_cache.rs` uses a ring buffer with Q8/Q2 quantization.

**GPU path**: `edge-gpu` holds WGSL compute shaders. WebGPU in browser, Vulkan/Metal/DX12 native via wgpu. KV cache runs on GPU when available.

**Browser path**: `edge-web` compiles to WASM via wasm-bindgen. Runs inference in Web Workers (non-blocking UI). Progressive model loading streams weights and starts inference before full download. Cache API and OPFS for model persistence.

**Edge path**: `edge-edge` exposes a synchronous API (`handle_chat_request` / `handle_chat_request_stream`) for serverless platforms that don't support async.

**Server** (`edge-server`): Axum HTTP server with OpenAI-compatible `/v1/chat/completions`, `/v1/models`, `/health`. Supports SSE streaming and non-streaming modes.

## Key Code Locations

- `edge-core/src/model.rs` — Llama transformer forward pass
- `edge-core/src/tensor.rs` — Tensor operations
- `edge-core/src/generate.rs` — Generation loop (Generator struct)
- `edge-core/src/sampling.rs` — Sampling strategies
- `edge-core/src/kv_cache.rs` — Ring-buffer KV cache with quantization
- `edge-core/src/tokenizer.rs` — BPE tokenizer
- `edge-core/src/chat.rs` — Chat templates (Llama3, ChatML, Phi3, Gemma, Alpaca, Raw)
- `edge-core/src/lora.rs` — LoRA adapter support
- `edge-gpu/shaders/` — All 44 WGSL compute shaders
- `edge-web/src/lib.rs` — wasm-bindgen EdgeEngine API
- `edge-edge/src/lib.rs` — Edge runtime entry point
- `edge-server/src/main.rs` — Native server entry point

## Code Style & Conventions

- Standard Rust: `rustfmt` + `clippy` enforced in CI (warnings = errors via `RUSTFLAGS="-D warnings"`)
- No `unwrap()` in library code — return `Result` with `thiserror`
- Document public APIs with `///` doc comments
- Mark unsafe blocks with `// SAFETY:` explaining invariants
- Use `#[cfg(target_arch = "wasm32")]` for WASM-specific code paths
- Prefer zero-copy parsing for model formats
- All model weight data is untrusted input — validate thoroughly

## SIMD Guidelines

- ARM NEON: `cfg(target_arch = "aarch64")` — always available on target
- x86 AVX2: runtime detection via `is_x86_feature_detected!`
- Always compare SIMD results against scalar reference (`matvec_scalar`) in tests
- The `test_matvec_simd_matches_scalar` test catches regressions across many sizes

## CI

GitHub Actions runs 7 jobs on PRs: check, test, fmt, clippy, wasm (wasm-pack build + npm pack dry-run), doc, docker. PRs touching core/loader/simd/server also trigger benchmark runs on macOS-14 (informational, non-blocking).

## Constraints

- **Public repo** — never commit secrets, API keys, credentials, or internal URLs
- **No AI assistant names** in commits, PRs, or code comments
- WASM-first: design for no threads, no filesystem, limited memory, 4GB max
- `unsafe` requires clear justification and a `// SAFETY:` comment
