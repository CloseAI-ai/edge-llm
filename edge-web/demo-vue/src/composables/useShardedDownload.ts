import { reactive, computed } from 'vue'
import type { ShardInfo, ShardStatus, ShardedDownloadState, AssemblyStatus } from '@/types/shard'

const CACHE_NAME = 'edge-shard-downloads-v1'

/**
 * Composable for parallel resumable sharded downloads with local assembly.
 *
 * Features:
 * - Parallel download of multiple shards via concurrent fetch()
 * - Resumable downloads using Cache API + Range headers
 * - Per-shard and overall progress tracking with speed
 * - Local assembly into a single file via OPFS or File System Access API
 */
export function useShardedDownload() {
  // ---- Reactive state ----
  const state = reactive<ShardedDownloadState>({
    modelName: '',
    shards: [],
    isDownloading: false,
    allDone: false,
    assemblyStatus: 'idle',
    assemblyError: '',
    statusLabel: '',
  })

  // AbortControllers per shard, keyed by index
  const controllers = new Map<number, AbortController>()
  // Per-shard start time for speed calculation
  const startTimes = new Map<number, number>()
  // Per-shard base loaded bytes (for resume speed calc)
  const baseLoaded = new Map<number, number>()

  // ---- Computed ----
  const overallProgress = computed(() => {
    const total = state.shards.reduce((s, sh) => s + sh.totalBytes, 0)
    const loaded = state.shards.reduce((s, sh) => s + sh.loadedBytes, 0)
    return { loaded, total, percent: total > 0 ? Math.round((loaded / total) * 100) : 0 }
  })

  const completedCount = computed(() => state.shards.filter(s => s.status === 'done').length)

  // ---- Cache helpers ----
  async function getCache(): Promise<Cache> {
    return await caches.open(CACHE_NAME)
  }

  /** Store downloaded bytes for a shard into Cache API. */
  async function cacheShardBytes(shard: ShardInfo, bytes: Uint8Array) {
    try {
      const cache = await getCache()
      const resp = new Response(new Blob([bytes as unknown as BlobPart]), {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(bytes.byteLength),
        },
      })
      await cache.put(shard.url, resp)
    } catch {
      // Cache full or unavailable — non-fatal
    }
  }

  /** Load cached bytes for a shard. Returns null if not cached. */
  async function getCachedShardBytes(shard: ShardInfo): Promise<Uint8Array | null> {
    try {
      const cache = await getCache()
      const resp = await cache.match(shard.url)
      if (!resp) return null
      return new Uint8Array(await resp.arrayBuffer())
    } catch {
      return null
    }
  }

  /** Delete cached bytes for a shard. */
  async function clearShardCache(shard: ShardInfo) {
    try {
      const cache = await getCache()
      await cache.delete(shard.url)
    } catch { /* ignore */ }
  }

  // ---- Initialization ----
  /**
   * Initialize shards from a list of URLs.
   * Probes each URL with a HEAD request to get Content-Length.
   */
  async function initShards(urls: string[], modelName?: string) {
    state.modelName = modelName || 'model'
    state.shards = urls.map((url, i) => ({
      index: i,
      url,
      name: fileNameFromUrl(url),
      totalBytes: 0,
      loadedBytes: 0,
      status: 'pending' as ShardStatus,
      error: '',
      speed: '',
    }))
    state.isDownloading = false
    state.allDone = false
    state.assemblyStatus = 'idle'
    state.assemblyError = ''
    state.statusLabel = `Initialized ${urls.length} shards. Probing sizes...`

    // Probe sizes in parallel
    const probes = urls.map(async (url, i) => {
      try {
        const resp = await fetch(url, { method: 'HEAD' })
        if (resp.ok) {
          const len = resp.headers.get('Content-Length')
          if (len) state.shards[i].totalBytes = parseInt(len, 10)
        }
      } catch { /* non-fatal */ }
    })
    await Promise.allSettled(probes)

    // Check for cached partial/complete shards
    const checks = state.shards.map(async (shard) => {
      const cached = await getCachedShardBytes(shard)
      if (cached) {
        shard.loadedBytes = cached.byteLength
        if (shard.totalBytes > 0 && cached.byteLength >= shard.totalBytes) {
          shard.status = 'done'
        }
      }
    })
    await Promise.allSettled(checks)

    updateAllDone()
    if (state.allDone) {
      state.statusLabel = 'All shards already downloaded. Ready to assemble.'
    } else {
      state.statusLabel = `Ready. ${completedCount.value}/${state.shards.length} shards cached.`
    }
  }

  // ---- Download control ----
  /** Start or resume downloading all non-done shards in parallel. */
  async function startAll() {
    if (state.isDownloading) return
    state.isDownloading = true
    state.assemblyStatus = 'idle'
    state.statusLabel = 'Downloading...'

    const promises = state.shards
      .filter(s => s.status !== 'done')
      .map(s => downloadShard(s))

    await Promise.allSettled(promises)
    state.isDownloading = false
    updateAllDone()

    if (state.allDone) {
      state.statusLabel = 'All shards downloaded. Ready to assemble.'
    } else if (state.shards.some(s => s.status === 'error')) {
      state.statusLabel = 'Some shards failed. Click retry to resume.'
    }
  }

  /** Pause all in-flight downloads. */
  function pauseAll() {
    for (const [idx, ctrl] of controllers) {
      ctrl.abort()
      controllers.delete(idx)
      const shard = state.shards[idx]
      if (shard && shard.status === 'downloading') {
        shard.status = 'paused'
        shard.speed = ''
      }
    }
    state.isDownloading = false
    state.statusLabel = 'Paused. Click resume to continue.'
  }

  /** Retry only errored shards. */
  async function retryFailed() {
    if (state.isDownloading) return
    state.isDownloading = true
    state.statusLabel = 'Retrying failed shards...'

    const failed = state.shards.filter(s => s.status === 'error')
    for (const s of failed) {
      s.error = ''
      s.status = 'pending'
    }

    const promises = failed.map(s => downloadShard(s))
    await Promise.allSettled(promises)
    state.isDownloading = false
    updateAllDone()

    if (state.allDone) {
      state.statusLabel = 'All shards downloaded. Ready to assemble.'
    }
  }

  /** Download a single shard with resume support. */
  async function downloadShard(shard: ShardInfo) {
    const idx = shard.index
    const ctrl = new AbortController()
    controllers.set(idx, ctrl)

    shard.status = 'downloading'
    shard.error = ''
    shard.speed = ''
    startTimes.set(idx, performance.now())
    baseLoaded.set(idx, shard.loadedBytes)

    try {
      // Check for cached partial data
      let cachedBytes: Uint8Array | null = null
      const cached = await getCachedShardBytes(shard)
      if (cached && cached.byteLength > 0) {
        cachedBytes = cached
        shard.loadedBytes = cached.byteLength
      }

      // If already complete, mark done
      if (shard.totalBytes > 0 && shard.loadedBytes >= shard.totalBytes) {
        shard.status = 'done'
        controllers.delete(idx)
        return
      }

      // Build Range header for resume
      const headers: Record<string, string> = {}
      if (shard.loadedBytes > 0) {
        headers['Range'] = `bytes=${shard.loadedBytes}-`
      }

      const resp = await fetch(shard.url, { headers, signal: ctrl.signal })

      if (!resp.ok && resp.status !== 206) {
        throw new Error(`HTTP ${resp.status} ${resp.statusText}`)
      }

      // If server doesn't support range, restart from beginning
      if (resp.status === 200 && shard.loadedBytes > 0) {
        shard.loadedBytes = 0
        cachedBytes = null
      }

      const contentLength = parseInt(resp.headers.get('Content-Length') || '0', 10)
      const isPartial = resp.status === 206

      // If totalBytes unknown, estimate from Content-Length
      if (shard.totalBytes === 0) {
        shard.totalBytes = isPartial ? shard.loadedBytes + contentLength : contentLength
      }

      const reader = resp.body!.getReader()
      const chunks: Uint8Array[] = []
      let received = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        received += value.byteLength

        const totalLoaded = shard.loadedBytes + received
        shard.loadedBytes = totalLoaded

        // Speed calculation
        const elapsed = (performance.now() - (startTimes.get(idx) || performance.now())) / 1000
        const baseBytes = baseLoaded.get(idx) || 0
        const deltaBytes = totalLoaded - baseBytes
        if (elapsed > 0.3 && deltaBytes > 0) {
          shard.speed = `${(deltaBytes / elapsed / 1e6).toFixed(1)} MB/s`
        }

        // Yield to main thread periodically
        if (received % (1024 * 1024 * 4) < value.byteLength) {
          await new Promise(r => setTimeout(r, 0))
        }
      }

      // Merge new chunks with cached bytes
      let finalBytes: Uint8Array
      if (cachedBytes && isPartial) {
        finalBytes = new Uint8Array(cachedBytes.byteLength + received)
        finalBytes.set(cachedBytes, 0)
        let offset = cachedBytes.byteLength
        for (const chunk of chunks) { finalBytes.set(chunk, offset); offset += chunk.byteLength }
      } else if (cachedBytes && !isPartial && received === 0) {
        finalBytes = cachedBytes
      } else {
        finalBytes = new Uint8Array(received)
        let offset = 0
        for (const chunk of chunks) { finalBytes.set(chunk, offset); offset += chunk.byteLength }
      }

      shard.loadedBytes = finalBytes.byteLength

      // Cache the complete shard
      await cacheShardBytes(shard, finalBytes)

      shard.status = 'done'
      shard.speed = ''
    } catch (err: any) {
      if (err.name === 'AbortError') {
        shard.status = 'paused'
        shard.speed = ''
      } else {
        shard.status = 'error'
        shard.error = err.message || String(err)
        shard.speed = ''
      }
    } finally {
      controllers.delete(idx)
    }
  }

  // ---- Assembly ----
  /**
   * Assemble all shards into a single file.
   * Tries File System Access API first (user picks save location),
   * falls back to OPFS + download link.
   */
  async function assembleFile() {
    if (!state.allDone) return

    state.assemblyStatus = 'assembling'
    state.assemblyError = ''
    state.statusLabel = 'Assembling shards...'

    try {
      // Load all shard bytes from cache
      const parts: Uint8Array[] = []
      let totalSize = 0
      for (const shard of state.shards) {
        const bytes = await getCachedShardBytes(shard)
        if (!bytes) throw new Error(`Shard ${shard.name} not found in cache`)
        parts.push(bytes)
        totalSize += bytes.byteLength
      }

      // Merge into single buffer
      const merged = new Uint8Array(totalSize)
      let offset = 0
      for (const part of parts) {
        merged.set(part, offset)
        offset += part.byteLength
      }

      // Try File System Access API for save-as dialog
      if ('showSaveFilePicker' in window) {
        try {
          const handle = await (window as any).showSaveFilePicker({
            suggestedName: `${state.modelName}.gguf`,
            types: [{
              description: 'GGUF Model File',
              accept: { 'application/octet-stream': ['.gguf'] },
            }],
          })
          const writable = await handle.createWritable()
          await writable.write(merged)
          await writable.close()

          state.assemblyStatus = 'done'
          state.statusLabel = `Saved as ${handle.name}. Assembly complete!`
          return
        } catch (err: any) {
          // User cancelled the picker — fall through to fallback
          if (err.name === 'AbortError') {
            state.assemblyStatus = 'idle'
            state.statusLabel = 'Assembly cancelled.'
            return
          }
          // Other errors — try fallback
        }
      }

      // Fallback: save to OPFS then trigger browser download
      const outputName = `${state.modelName}.gguf`
      try {
        const root = await navigator.storage.getDirectory()
        const fileHandle = await root.getFileHandle(outputName, { create: true })
        const writable = await fileHandle.createWritable()
        await writable.write(merged)
        await writable.close()

        // Also trigger a browser download via blob URL
        const blob = new Blob([merged], { type: 'application/octet-stream' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = outputName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)

        state.assemblyStatus = 'done'
        state.statusLabel = `Assembled and downloaded ${outputName}.`
      } catch (err: any) {
        // Final fallback: just blob download
        const blob = new Blob([merged], { type: 'application/octet-stream' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = outputName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)

        state.assemblyStatus = 'done'
        state.statusLabel = `Assembled and downloaded ${outputName}.`
      }
    } catch (err: any) {
      state.assemblyStatus = 'error'
      state.assemblyError = err.message || String(err)
      state.statusLabel = 'Assembly failed: ' + state.assemblyError
    }
  }

  // ---- Cleanup ----
  /** Clear all cached shard data and reset state. */
  async function resetAll() {
    pauseAll()
    for (const shard of state.shards) {
      await clearShardCache(shard)
    }
    state.shards = []
    state.isDownloading = false
    state.allDone = false
    state.assemblyStatus = 'idle'
    state.assemblyError = ''
    state.statusLabel = ''
    state.modelName = ''
    controllers.clear()
    startTimes.clear()
    baseLoaded.clear()
  }

  // ---- Helpers ----
  function updateAllDone() {
    state.allDone = state.shards.length > 0 && state.shards.every(s => s.status === 'done')
  }

  function fileNameFromUrl(url: string): string {
    try {
      return new URL(url).pathname.split('/').pop() || url
    } catch {
      return url.split('/').pop() || url
    }
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB'
    return (bytes / 1073741824).toFixed(2) + ' GB'
  }

  return {
    state,
    overallProgress,
    completedCount,
    initShards,
    startAll,
    pauseAll,
    retryFailed,
    assembleFile,
    resetAll,
    formatSize,
  }
}
