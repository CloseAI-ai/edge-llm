<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useTheme } from './composables/useTheme'
import { useEngine } from './composables/useEngine'
import { useChat } from './composables/useChat'
import { useVoice } from './composables/useVoice'
import { useShardedDownload } from './composables/useShardedDownload'

import StatusPanel from './components/features/StatusPanel.vue'
import ModelLoader from './components/features/ModelLoader.vue'
import TokenizerLoader from './components/features/TokenizerLoader.vue'
import ChatPanel from './components/features/ChatPanel.vue'
import PerfDashboard from './components/features/PerfDashboard.vue'
import ModelInfoPanel from './components/features/ModelInfoPanel.vue'
import CachePanel from './components/features/CachePanel.vue'
import ShardedDownloader from './components/features/ShardedDownloader.vue'

// Composables
const { isDark, init: initTheme, toggle: toggleTheme } = useTheme()
const engine = useEngine()
const chat = useChat(engine.getEngine, engine.getTokenizer)
const voice = useVoice()
const shard = useShardedDownload()

// Sharded download preset — GitHub release split model files
const SHARD_BASE = 'https://github.com/LemonStudio-hub/edge-llm-models/releases/download/qwen2-0.5b-instruct-q8_0'
const SHARD_URLS = [
  `${SHARD_BASE}/qwen2-0_5b-instruct-q8_0-split-00001-of-00004.gguf`,
  `${SHARD_BASE}/qwen2-0_5b-instruct-q8_0-split-00002-of-00004.gguf`,
  `${SHARD_BASE}/qwen2-0_5b-instruct-q8_0-split-00003-of-00004.gguf`,
  `${SHARD_BASE}/qwen2-0_5b-instruct-q8_0-split-00004-of-00004.gguf`,
]

function onInitShardDemo() {
  shard.initShards(SHARD_URLS, 'qwen2-0_5b-instruct-q8_0')
}

// Voice button enabled state
const voiceReady = computed(() =>
  engine.isModelLoaded.value &&
  engine.isTokenizerLoaded.value &&
  voice.isSupported.value &&
  !chat.isStreaming.value
)

// ---- Event handlers ----
function onModelFile(file: File) {
  chat.clear()
  engine.loadModelFromFile(file)
}

function onModelUrl(url: string) {
  chat.clear()
  engine.loadModelFromUrl(url)
}

function onTokenizerFile(file: File) {
  engine.loadTokenizerFromFile(file).catch((err: any) => {
    console.error(err)
  })
}

function onTokenizerUrl(url: string) {
  engine.loadTokenizerFromUrl(url).catch((err: any) => {
    console.error(err)
  })
}

async function onVoice() {
  if (!voiceReady.value) return
  try {
    const text = await voice.listen()
    if (text) {
      const params = {
        temperature: 0.7, topP: 0.95, topK: 40, repeatPenalty: 1.1, maxTokens: 128,
      }
      chat.generate(text, params, true, '', () => {})
    }
  } catch (err: any) {
    chat.genStats.value = 'Voice error: ' + (err?.message || err)
  }
}

onMounted(() => {
  initTheme()
  engine.initWasm()
})
</script>

<template>
  <div class="app">
    <!-- Header -->
    <header class="header">
      <div class="header-left">
        <h1>Edge LLM</h1>
        <p class="subtitle">WASM-first LLM inference, running entirely in your browser.</p>
      </div>
      <button class="theme-toggle" @click="toggleTheme" :title="isDark ? 'Switch to light' : 'Switch to dark'">
        <span v-if="isDark">☀</span>
        <span v-else>🌙</span>
      </button>
    </header>

    <!-- Status -->
    <StatusPanel
      :status-text="engine.statusText.value"
      :status-is-error="engine.statusIsError.value"
      :env="engine.env"
      :backend-name="engine.backendName.value"
      :is-ready="engine.isReady.value"
    />

    <!-- Performance Dashboard -->
    <PerfDashboard
      :show="chat.showPerf.value"
      :tps="chat.perfTps.value"
      :ttft="chat.perfTtft.value"
      :tokens="chat.perfTokens.value"
      :mem="chat.perfMem.value"
      :backend="engine.backendName.value"
    />

    <!-- Model Loader -->
    <ModelLoader
      :is-ready="engine.isReady.value"
      :progress="engine.progress"
      @load-file="onModelFile"
      @load-url="onModelUrl"
    />

    <!-- Sharded Downloader (Deploy) -->
    <ShardedDownloader
      :state="shard.state"
      :overall-percent="shard.overallProgress.value.percent"
      :overall-loaded="shard.formatSize(shard.overallProgress.value.loaded)"
      :overall-total="shard.formatSize(shard.overallProgress.value.total)"
      :completed-count="shard.completedCount.value"
      :format-size="shard.formatSize"
      @init-demo="onInitShardDemo"
      @start-all="shard.startAll"
      @pause-all="shard.pauseAll"
      @retry-failed="shard.retryFailed"
      @assemble="shard.assembleFile"
      @reset="shard.resetAll"
    />

    <!-- Cached Models -->
    <CachePanel
      :show="engine.env.opfs"
      :models="engine.cachedModels.value"
      :storage="engine.storageInfo.value"
      :format-size="engine.formatSize"
      @load="engine.loadModelFromCache"
      @delete="engine.deleteCachedModel"
    />

    <!-- Model Info -->
    <ModelInfoPanel v-if="engine.modelInfo.value" :info="engine.modelInfo.value!" />

    <!-- Tokenizer Loader -->
    <TokenizerLoader
      :is-ready="engine.isReady.value"
      :is-loaded="engine.isTokenizerLoaded.value"
      :vocab-size="engine.getTokenizer()?.vocab_size"
      :bos-token-id="engine.getTokenizer()?.bos_token_id"
      :eos-token-id="engine.getTokenizer()?.eos_token_id"
      @load-file="onTokenizerFile"
      @load-url="onTokenizerUrl"
    />

    <!-- Chat -->
    <ChatPanel
      :is-model-loaded="engine.isModelLoaded.value"
      :is-tokenizer-loaded="engine.isTokenizerLoaded.value"
      :is-streaming="chat.isStreaming.value"
      :messages="chat.messages.value"
      :gen-stats="chat.genStats.value"
      :token-counter="chat.tokenCounter.value"
      :template-name="engine.modelInfo.value?.template || ''"
      :render-markdown="chat.renderMarkdown"
      :voice-supported="voiceReady"
      @generate="(text, params, chatMode, sysPrompt) => chat.generate(text, params, chatMode, sysPrompt, () => {})"
      @stop="chat.stop"
      @clear="chat.clear"
      @voice="onVoice"
    />

    <!-- Footer -->
    <footer class="footer">
      <a href="https://github.com/sauravpanda/edgellm" target="_blank" rel="noopener">
        github.com/sauravpanda/edgellm
      </a>
    </footer>
  </div>
</template>

<style scoped>
.app {
  max-width: 860px;
  margin: 0 auto;
  padding: 1.5rem 1rem 3rem;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1.5rem;
}
.header h1 {
  font-size: 1.75rem;
  letter-spacing: -0.02em;
}
.header .subtitle {
  color: var(--fg-dim);
  margin: 0.25rem 0 0;
  font-size: 0.95rem;
}
.theme-toggle {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0.4rem 0.6rem;
  cursor: pointer;
  font-size: 1.1rem;
  line-height: 1;
  transition: background 0.15s, border-color 0.15s;
}
.theme-toggle:hover {
  border-color: var(--border-focus);
  background: var(--accent-bg);
}

.footer {
  text-align: center;
  color: var(--fg-faint);
  font-size: 0.82rem;
  margin-top: 2rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border);
}

@media (max-width: 480px) {
  .app { padding: 1rem 0.75rem 2rem; }
}
</style>
