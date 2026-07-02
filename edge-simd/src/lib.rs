//! WASM SIMD128 CPU fallback backend for Edge LLM.
//!
//! Used when WebGPU is not available. Implements the same [`edge_core::model::ComputeBackend`]
//! trait as `edge-gpu`, providing tiled matrix multiply, RMSNorm, RoPE,
//! softmax, and SiLU activation on the CPU.

pub mod backend;
pub mod matmul;

pub use backend::SimdBackend;
