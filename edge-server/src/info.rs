use std::fs::File;
use std::io::BufReader;

use edge_loader::gguf::GgufFile;

/// Bits per weight for Q4-quantized memory estimates.
const Q4_BITS: f32 = 4.0;
/// Bits per weight for Q8-quantized memory estimates.
const Q8_BITS: f32 = 8.0;
/// Bits per weight/value for F16 memory estimates.
const F16_BITS: f32 = 16.0;
/// Short-context KV cache estimate shown by the CLI.
const SHORT_CONTEXT_ESTIMATE_TOKENS: usize = 2048;
/// Long-context KV cache estimate shown by the CLI.
const LONG_CONTEXT_ESTIMATE_TOKENS: usize = 4096;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: edge-info <model.gguf>");
        std::process::exit(1);
    }

    let path = &args[1];
    let mut reader = BufReader::new(File::open(path).unwrap_or_else(|e| {
        eprintln!("Error: {e}");
        std::process::exit(1);
    }));

    let gguf = GgufFile::parse_header(&mut reader).unwrap_or_else(|e| {
        eprintln!("GGUF parse error: {e}");
        std::process::exit(1);
    });

    println!("=== Model Info: {path} ===\n");
    println!("GGUF version:   {}", gguf.version);
    println!(
        "Architecture:   {}",
        gguf.architecture().unwrap_or("unknown")
    );
    println!("Tensors:        {}", gguf.tensors.len());

    if let Ok(config) = gguf.to_model_config() {
        println!();
        println!("--- Configuration ---");
        println!("Hidden dim:     {}", config.hidden_dim);
        println!("Layers:         {}", config.num_layers);
        println!("Heads:          {}", config.num_heads);
        println!("KV heads:       {}", config.num_kv_heads);
        println!("Head dim:       {}", config.head_dim);
        println!("Intermediate:   {}", config.intermediate_dim);
        println!("Vocab size:     {}", config.vocab_size);
        println!("Context length: {}", config.max_seq_len);
        println!("RoPE theta:     {}", config.rope_theta);
        println!("RMS norm eps:   {}", config.rms_norm_eps);

        let params = config.estimate_param_count();
        println!("\n--- Estimates ---");
        println!("Parameters:     ~{:.1}M", params as f64 / 1e6);
        println!(
            "Weights (Q4):   ~{:.0}MB",
            config.estimate_weight_memory(Q4_BITS) as f64 / 1e6
        );
        println!(
            "Weights (Q8):   ~{:.0}MB",
            config.estimate_weight_memory(Q8_BITS) as f64 / 1e6
        );
        println!(
            "Weights (F16):  ~{:.0}MB",
            config.estimate_weight_memory(F16_BITS) as f64 / 1e6
        );
        println!(
            "KV cache (2K):  ~{:.0}MB",
            config.estimate_kv_cache_memory(SHORT_CONTEXT_ESTIMATE_TOKENS, F16_BITS) as f64 / 1e6
        );
        println!(
            "KV cache (4K):  ~{:.0}MB",
            config.estimate_kv_cache_memory(LONG_CONTEXT_ESTIMATE_TOKENS, F16_BITS) as f64 / 1e6
        );
    }

    println!("\n--- Tensors ---");
    for t in &gguf.tensors {
        let dims: Vec<String> = t.dimensions.iter().map(|d| d.to_string()).collect();
        println!(
            "  {:50} [{:>15}]  {:?}  ({:.1}MB)",
            t.name,
            dims.join(", "),
            t.dtype,
            t.byte_size() as f64 / 1e6
        );
    }
}
