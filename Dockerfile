# Multi-stage build for edge-server
#
# Stage 1 — Build
#   Compiles the native server binary with cargo.
# Stage 2 — Runtime
#   Minimal Debian image with only the binary and its shared-library deps.
#
# Usage:
#   docker build -t edge-server .
#   docker run -p 8080:8080 edge-server
#   docker run -p 8080:8080 -v ./models:/models -e MODEL_FILE=/models/model.gguf edge-server

# ---------------------------------------------------------------------------
# Stage 1: builder
# ---------------------------------------------------------------------------
FROM rust:1.85-slim AS builder

WORKDIR /build

# Install build-time C deps (linker, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy workspace files
COPY Cargo.toml Cargo.lock ./
COPY edge-core       edge-core/
COPY edge-loader     edge-loader/
COPY edge-gpu        edge-gpu/
COPY edge-simd       edge-simd/
COPY edge-server     edge-server/
COPY edgellm         edgellm/
# edge-web and edge-edge are workspace members the server binary doesn't
# need; stub them out with minimal lib.rs files so cargo can resolve the
# workspace without pulling in their (wasm-pack / edge-runtime) toolchains.
COPY edge-web/Cargo.toml edge-web/Cargo.toml
RUN mkdir -p edge-web/src && echo 'pub fn dummy() {}' > edge-web/src/lib.rs
COPY edge-edge/Cargo.toml edge-edge/Cargo.toml
RUN mkdir -p edge-edge/src && echo 'pub fn dummy() {}' > edge-edge/src/lib.rs

RUN cargo build --release -p edgellm-server

# ---------------------------------------------------------------------------
# Stage 2: runtime
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/target/release/edge-server /usr/local/bin/edge-server

# Optional: volume mount point for model files
VOLUME ["/models"]

ENV HOST=0.0.0.0
ENV PORT=8080
# Set MODEL_FILE to the path inside /models to load a model on startup, e.g.:
#   -e MODEL_FILE=/models/phi-3-mini.gguf
ENV MODEL_FILE=""

EXPOSE 8080

ENTRYPOINT ["/bin/sh", "-c", \
  "if [ -n \"$MODEL_FILE\" ]; then \
     exec edge-server --model \"$MODEL_FILE\" --host \"$HOST\" --port \"$PORT\"; \
   else \
     exec edge-server --host \"$HOST\" --port \"$PORT\"; \
   fi"]
