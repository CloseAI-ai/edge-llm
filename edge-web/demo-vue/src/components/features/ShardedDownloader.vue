<script setup lang="ts">
import { ref, computed } from 'vue'
import BasePanel from '@/components/ui/BasePanel.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseBadge from '@/components/ui/BaseBadge.vue'
import type { ShardedDownloadState } from '@/types/shard'

const props = defineProps<{
  state: ShardedDownloadState
  overallPercent: number
  overallLoaded: string
  overallTotal: string
  completedCount: number
  formatSize: (bytes: number) => string
}>()

const emit = defineEmits<{
  initDemo: []
  startAll: []
  pauseAll: []
  retryFailed: []
  assemble: []
  reset: []
}>()

const activeTab = ref<'preset' | 'custom'>('preset')
const customUrls = ref('')

const PRESETS = [
  {
    name: 'Qwen2-0.5B-Instruct Q8_0',
    modelName: 'qwen2-0_5b-instruct-q8_0',
    base: 'https://github.com/LemonStudio-hub/edge-llm-models/releases/download/qwen2-0.5b-instruct-q8_0',
    files: [
      'qwen2-0_5b-instruct-q8_0-split-00001-of-00004.gguf',
      'qwen2-0_5b-instruct-q8_0-split-00002-of-00004.gguf',
      'qwen2-0_5b-instruct-q8_0-split-00003-of-00004.gguf',
      'qwen2-0_5b-instruct-q8_0-split-00004-of-00004.gguf',
    ],
  },
]

const preset = PRESETS[0]

function loadPreset() {
  emit('initDemo')
}

function loadCustom() {
  const urls = customUrls.value
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
  if (urls.length === 0) return
  // Handled via a custom event — pass URLs up
  // For now, we use the preset. Custom URLs would need a new emit.
}

const hasShards = computed(() => props.state.shards.length > 0)
const canStart = computed(() => hasShards.value && !props.state.isDownloading && !props.state.allDone)
const canPause = computed(() => props.state.isDownloading)
const canRetry = computed(() =>
  hasShards.value &&
  !props.state.isDownloading &&
  props.state.shards.some(s => s.status === 'error')
)
const canAssemble = computed(() => props.state.allDone && props.state.assemblyStatus === 'idle')
const canReset = computed(() => hasShards.value && !props.state.isDownloading)

function statusVariant(s: string): 'default' | 'ok' | 'warn' | 'info' | 'error' {
  switch (s) {
    case 'done': return 'ok'
    case 'downloading': return 'info'
    case 'paused': return 'warn'
    case 'error': return 'error'
    default: return 'default'
  }
}

function assemblyVariant(): 'default' | 'ok' | 'warn' | 'info' | 'error' {
  switch (props.state.assemblyStatus) {
    case 'done': return 'ok'
    case 'assembling': return 'info'
    case 'error': return 'error'
    default: return 'default'
  }
}
</script>

<template>
  <BasePanel>
    <template #default>
      <h3 class="panel-title">Deploy Model (Sharded Download)</h3>

      <!-- Preset / Custom tabs -->
      <div v-if="!hasShards" class="tabs">
        <button
          :class="['tab-btn', { active: activeTab === 'preset' }]"
          @click="activeTab = 'preset'"
        >Preset</button>
        <button
          :class="['tab-btn', { active: activeTab === 'custom' }]"
          @click="activeTab = 'custom'"
        >Custom URLs</button>
      </div>

      <!-- Preset panel -->
      <div v-if="!hasShards && activeTab === 'preset'" class="tab-panel">
        <div class="preset-card">
          <div class="preset-info">
            <span class="preset-name">{{ preset.name }}</span>
            <span class="stats">4 shards &middot; ~507 MB total &middot; from GitHub Releases</span>
          </div>
          <BaseButton variant="primary" @click="loadPreset">Load</BaseButton>
        </div>
        <p class="stats" style="margin-top:0.6rem;">
          Downloads 4 shards in parallel with resumable support. After download, assemble into a single GGUF file.
        </p>
      </div>

      <!-- Custom URLs panel -->
      <div v-if="!hasShards && activeTab === 'custom'" class="tab-panel">
        <p class="stats">Enter one shard URL per line:</p>
        <textarea
          v-model="customUrls"
          class="url-textarea"
          placeholder="https://example.com/model-00001-of-00004.gguf&#10;https://example.com/model-00002-of-00004.gguf&#10;..."
          rows="4"
        ></textarea>
        <BaseButton :disabled="customUrls.trim().length === 0" @click="loadCustom" style="margin-top:0.4rem;">
          Load URLs
        </BaseButton>
      </div>

      <!-- Active download state -->
      <div v-if="hasShards" class="download-area">
        <!-- Status bar -->
        <div class="status-bar">
          <span class="stats">{{ state.statusLabel }}</span>
          <BaseBadge v-if="state.allDone" variant="ok">All Done</BaseBadge>
          <BaseBadge v-else-if="state.isDownloading" variant="info">Downloading</BaseBadge>
          <BaseBadge v-else-if="state.assemblyStatus === 'done'" variant="ok">Assembled</BaseBadge>
        </div>

        <!-- Overall progress -->
        <div v-if="!state.allDone || state.isDownloading" class="overall-progress">
          <div class="progress-header">
            <span class="stats">Overall: {{ completedCount }}/{{ state.shards.length }} shards</span>
            <span class="stats">{{ overallLoaded }} / {{ overallTotal }} ({{ overallPercent }}%)</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: overallPercent + '%' }"></div>
          </div>
        </div>

        <!-- Per-shard list -->
        <div class="shard-list">
          <div
            v-for="shard in state.shards"
            :key="shard.index"
            :class="['shard-row', 'shard-' + shard.status]"
          >
            <div class="shard-header">
              <div class="shard-name">
                <BaseBadge :variant="statusVariant(shard.status)">{{ shard.status }}</BaseBadge>
                <span class="shard-filename">{{ shard.name }}</span>
              </div>
              <div class="shard-meta">
                <span v-if="shard.speed" class="shard-speed">{{ shard.speed }}</span>
                <span class="shard-size">
                  {{ formatSize(shard.loadedBytes) }}
                  <template v-if="shard.totalBytes > 0"> / {{ formatSize(shard.totalBytes) }}</template>
                </span>
              </div>
            </div>
            <!-- Shard progress bar -->
            <div v-if="shard.totalBytes > 0" class="progress-track progress-track-sm">
              <div
                class="progress-fill"
                :class="{ 'fill-done': shard.status === 'done', 'fill-error': shard.status === 'error' }"
                :style="{ width: Math.min(100, Math.round((shard.loadedBytes / shard.totalBytes) * 100)) + '%' }"
              ></div>
            </div>
            <div v-if="shard.error" class="shard-error">{{ shard.error }}</div>
          </div>
        </div>

        <!-- Control buttons -->
        <div class="controls">
          <BaseButton
            v-if="canStart"
            variant="primary"
            @click="emit('startAll')"
          >
            {{ completedCount > 0 ? 'Resume All' : 'Start Download' }}
          </BaseButton>
          <BaseButton
            v-if="canPause"
            variant="danger"
            @click="emit('pauseAll')"
          >Pause</BaseButton>
          <BaseButton
            v-if="canRetry"
            @click="emit('retryFailed')"
          >Retry Failed</BaseButton>
          <BaseButton
            v-if="canAssemble"
            variant="primary"
            @click="emit('assemble')"
          >Assemble File</BaseButton>
          <BaseButton
            v-if="state.assemblyStatus === 'done'"
            variant="primary"
            disabled
          >✓ Assembled</BaseButton>
          <BaseButton
            v-if="canReset"
            @click="emit('reset')"
          >Reset</BaseButton>
        </div>

        <!-- Assembly status -->
        <div v-if="state.assemblyStatus !== 'idle'" class="assembly-status">
          <BaseBadge :variant="assemblyVariant()">{{ state.assemblyStatus }}</BaseBadge>
          <span v-if="state.assemblyError" class="text-error stats">{{ state.assemblyError }}</span>
        </div>
      </div>
    </template>
  </BasePanel>
</template>

<style scoped>
.panel-title {
  font-size: 0.95rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--fg-dim);
  margin-bottom: 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.tabs {
  display: flex;
  gap: 0.25rem;
  margin-bottom: 0.75rem;
}
.tab-btn {
  font-size: 0.82rem;
  padding: 0.3rem 0.7rem;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  background: transparent;
  color: var(--fg-dim);
  cursor: pointer;
  font: inherit;
}
.tab-btn.active {
  background: var(--accent-bg);
  border-color: var(--accent-border);
  color: var(--accent);
}
.tab-panel {
  margin-bottom: 0.5rem;
}

/* Preset card */
.preset-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
}
.preset-info {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.preset-name {
  font-weight: 600;
  font-size: 0.92rem;
}

/* Custom URL textarea */
.url-textarea {
  font: inherit;
  font-size: 0.85rem;
  font-family: var(--font-mono);
  padding: 0.5rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--fg);
  width: 100%;
  resize: vertical;
  margin-top: 0.4rem;
  transition: border-color 0.15s;
}
.url-textarea:focus {
  outline: none;
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--accent-bg);
}

/* Download area */
.download-area {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.status-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

/* Overall progress */
.overall-progress {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.progress-track {
  height: 8px;
  background: var(--bg-surface-alt);
  border-radius: 4px;
  overflow: hidden;
}
.progress-track-sm {
  height: 4px;
  margin-top: 0.3rem;
}
.progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 4px;
  transition: width 0.3s ease;
  min-width: 0;
}
.fill-done {
  background: var(--success);
}
.fill-error {
  background: var(--error);
}

/* Shard list */
.shard-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.shard-row {
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  transition: border-color 0.15s;
}
.shard-done {
  border-color: var(--success-border);
  background: var(--success-bg);
}
.shard-error {
  border-color: var(--error-border);
  background: var(--error-bg);
}
.shard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}
.shard-name {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}
.shard-filename {
  font-size: 0.82rem;
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.shard-meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-shrink: 0;
}
.shard-speed {
  font-size: 0.78rem;
  color: var(--accent);
  font-family: var(--font-mono);
}
.shard-size {
  font-size: 0.78rem;
  color: var(--fg-dim);
  font-family: var(--font-mono);
}

.shard-error {
  font-size: 0.78rem;
  color: var(--error);
  margin-top: 0.25rem;
}

/* Controls */
.controls {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

/* Assembly */
.assembly-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
</style>
