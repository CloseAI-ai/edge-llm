/** Status of an individual shard download. */
export type ShardStatus = 'pending' | 'downloading' | 'paused' | 'done' | 'error'

/** Metadata and state for a single shard. */
export interface ShardInfo {
  /** Index of this shard (0-based). */
  index: number
  /** Direct download URL for this shard. */
  url: string
  /** Filename (e.g. "model-split-00001-of-00004.gguf"). */
  name: string
  /** Total size in bytes (from Content-Length or manifest). 0 if unknown. */
  totalBytes: number
  /** Bytes downloaded so far. */
  loadedBytes: number
  /** Current status. */
  status: ShardStatus
  /** Error message if status === 'error'. */
  error: string
  /** Download speed string (e.g. "12.3 MB/s"). */
  speed: string
}

/** Overall assembly state. */
export type AssemblyStatus = 'idle' | 'assembling' | 'done' | 'error'

/** Top-level state for a sharded download session. */
export interface ShardedDownloadState {
  /** Human-readable model name. */
  modelName: string
  /** All shards. */
  shards: ShardInfo[]
  /** Whether any download is in progress. */
  isDownloading: boolean
  /** Whether all shards are done. */
  allDone: boolean
  /** Assembly state after all shards complete. */
  assemblyStatus: AssemblyStatus
  /** Assembly error message. */
  assemblyError: string
  /** Overall progress label. */
  statusLabel: string
}
