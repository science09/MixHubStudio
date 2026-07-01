<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { diffWords } from 'diff'
import { md } from '../../utils/markdown'

const props = defineProps({
  showAiPanel: {
    type: Boolean,
    default: false
  },
  aiSessions: {
    type: Array,
    required: true
  },
  activeSessionId: {
    type: [Number, String, null],
    default: null
  },
  currentSession: {
    type: Object,
    default: null
  },
  chatHistory: {
    type: Array,
    required: true
  },
  isGenerating: {
    type: Boolean,
    default: false
  },
  isSelectionActive: {
    type: Boolean,
    default: false
  },
  selectedTextLength: {
    type: Number,
    default: 0
  },
  articles: {
    type: Array,
    required: true
  },
  activeArticleTitle: {
    type: String,
    default: ''
  },
  customInstruction: {
    type: String,
    default: ''
  },
  t: {
    type: Function,
    required: true
  }
})

const emit = defineEmits([
  'update:customInstruction',
  'create-session',
  'clear-chat',
  'select-session',
  'rename-session',
  'delete-session',
  'run-action',
  'apply-output',
  'restore-changes',
  'stop-generating'
])

// Two-way bound customInstruction
const localCustomInstruction = computed({
  get: () => props.customInstruction,
  set: (val) => emit('update:customInstruction', val)
})

// Local states for UI separation
const aiPanelWidth = ref(parseInt(localStorage.getItem('ai-panel-width') || '280'))
const showSessionDropdown = ref(false)
const editingSessionId = ref(null)
const editingSessionTitle = ref('')

const sessionDropdownTriggerRef = ref(null)
const sessionDropdownRef = ref(null)
const sessionRenameInputRef = ref(null)
const aiChatMessagesRef = ref(null)
const aiInputRef = ref(null)

// Mention dropdown local states
const showMentionDropdown = ref(false)
const mentionSearchQuery = ref('')
const mentionTriggerIndex = ref(-1)
const selectedMentionIndex = ref(0)
const mentionDropdownRef = ref(null)

// Attached Images local states
const attachedImages = ref([])

// Resizer handling
const initResize = (e) => {
  e.preventDefault()
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
  const startX = e.clientX
  const startWidth = aiPanelWidth.value

  const doResize = (moveEvent) => {
    const dx = moveEvent.clientX - startX
    const newWidth = Math.max(240, Math.min(800, startWidth - dx))
    aiPanelWidth.value = newWidth
  }

  const stopResize = () => {
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    localStorage.setItem('ai-panel-width', aiPanelWidth.value.toString())
    window.removeEventListener('pointermove', doResize)
    window.removeEventListener('pointerup', stopResize)
  }

  window.addEventListener('pointermove', doResize)
  window.addEventListener('pointerup', stopResize)
}

// Session dropdown toggle
const toggleSessionDropdown = () => {
  showSessionDropdown.value = !showSessionDropdown.value
}

const selectSession = (id) => {
  emit('select-session', id)
  showSessionDropdown.value = false
}

// Session Rename helpers
const startSessionRename = (session) => {
  editingSessionId.value = session.id
  editingSessionTitle.value = session.title
}

const saveSessionRename = (id) => {
  if (editingSessionTitle.value.trim()) {
    emit('rename-session', { id, title: editingSessionTitle.value.trim() })
  }
  editingSessionId.value = null
}

const deleteSession = (id) => {
  emit('delete-session', id)
  if (props.activeSessionId === id) {
    showSessionDropdown.value = false
  }
}

// Focus rename input on start
watch(editingSessionId, (newId) => {
  if (newId) {
    nextTick(() => {
      const el = Array.isArray(sessionRenameInputRef.value)
        ? sessionRenameInputRef.value[0]
        : sessionRenameInputRef.value
      if (el) {
        el.focus()
        el.select()
      }
    })
  }
})

// Auto scroll messages to bottom
const scrollToBottom = () => {
  nextTick(() => {
    if (aiChatMessagesRef.value) {
      aiChatMessagesRef.value.scrollTop = aiChatMessagesRef.value.scrollHeight
    }
  })
}

watch(() => props.chatHistory, () => {
  scrollToBottom()
}, { deep: true, immediate: true })

defineExpose({ scrollToBottom })

// Mention functionality
const filteredMentionArticles = computed(() => {
  if (!mentionSearchQuery.value) {
    return props.articles.slice(0, 10)
  }
  const q = mentionSearchQuery.value.toLowerCase()
  return props.articles.filter(art => 
    art.title && art.title.toLowerCase().includes(q)
  ).slice(0, 10)
})

const handleAiInput = (e) => {
  const textarea = e.target
  const cursor = textarea.selectionStart
  const text = textarea.value
  
  const lastAtIdx = text.lastIndexOf('@', cursor - 1)
  if (lastAtIdx !== -1) {
    const midText = text.substring(lastAtIdx + 1, cursor)
    if (!/\s/.test(midText)) {
      showMentionDropdown.value = true
      mentionTriggerIndex.value = lastAtIdx
      mentionSearchQuery.value = midText
      selectedMentionIndex.value = 0
      return
    }
  }
  
  showMentionDropdown.value = false
}

const handleAiKeyDown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !showMentionDropdown.value) {
    e.preventDefault()
    if (props.isGenerating || (!props.customInstruction.trim() && attachedImages.value.length === 0)) return
    runQuickAction('custom')
    return
  }

  if (!showMentionDropdown.value) return

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedMentionIndex.value = (selectedMentionIndex.value + 1) % filteredMentionArticles.value.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedMentionIndex.value = (selectedMentionIndex.value - 1 + filteredMentionArticles.value.length) % filteredMentionArticles.value.length
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault()
    if (filteredMentionArticles.value.length > 0) {
      insertMention(filteredMentionArticles.value[selectedMentionIndex.value])
    }
  } else if (e.key === 'Escape') {
    e.preventDefault()
    showMentionDropdown.value = false
  }
}

const handleAiBlur = () => {
  setTimeout(() => {
    showMentionDropdown.value = false
  }, 200)
}

const insertMention = (art) => {
  const textarea = aiInputRef.value
  if (!textarea) return
  
  const text = props.customInstruction
  const start = text.substring(0, mentionTriggerIndex.value)
  const end = text.substring(textarea.selectionStart)
  const mentionText = `@${art.title} `
  
  emit('update:customInstruction', start + mentionText + end)
  showMentionDropdown.value = false
  
  nextTick(() => {
    textarea.focus()
    const newCursorPos = mentionTriggerIndex.value + mentionText.length
    textarea.setSelectionRange(newCursorPos, newCursorPos)
  })
}

// Paste image attachments
const handlePaste = async (e) => {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.indexOf('image') !== -1) {
      e.preventDefault()
      const file = item.getAsFile()
      if (file) {
        const getBase64 = () => {
          return new Promise((resolve) => {
            const reader = new FileReader()
            reader.onload = (ev) => resolve(ev.target.result)
            reader.readAsDataURL(file)
          })
        }
        
        const getArrayBuffer = () => {
          return new Promise((resolve) => {
            const reader = new FileReader()
            reader.onload = (ev) => resolve(ev.target.result)
            reader.readAsArrayBuffer(file)
          })
        }

        try {
          const [previewUrl, arrayBuffer] = await Promise.all([getBase64(), getArrayBuffer()])
          const uint8Array = new Uint8Array(arrayBuffer)
          const path = await invoke('save_temp_image', { bytes: Array.from(uint8Array) })
          attachedImages.value.push({ path, previewUrl })
        } catch (err) {
          console.error('Failed to process pasted image:', err)
        }
      }
    }
  }
}

const selectAttachment = async () => {
  try {
    const selected = await open({
      multiple: true,
      filters: [{
        name: 'Images',
        extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp']
      }]
    })
    if (!selected) return
    
    const paths = Array.isArray(selected) ? selected : [selected]
    for (const path of paths) {
      if (attachedImages.value.some(img => img.path === path)) continue
      try {
        const previewUrl = await invoke('get_image_base64', { path })
        attachedImages.value.push({ path, previewUrl })
      } catch (err) {
        console.error('Failed to load image as base64, falling back to convertFileSrc:', err)
        const previewUrl = convertFileSrc(path)
        attachedImages.value.push({ path, previewUrl })
      }
    }
  } catch (err) {
    console.error('Failed to select attachment:', err)
  }
}

const removeAttachment = (idx) => {
  attachedImages.value.splice(idx, 1)
}

// Quick Actions Trigger
const runQuickAction = (actionType) => {
  if (actionType === 'custom') {
    const images = attachedImages.value.map(img => img.path)
    const previewUrls = attachedImages.value.map(img => img.previewUrl)
    emit('run-action', {
      type: 'custom',
      instruction: props.customInstruction,
      images,
      previewUrls
    })
    attachedImages.value = []
  } else {
    emit('run-action', { type: actionType })
  }
}

// Diff calculator
const getDiffParts = (oldText, newText) => {
  return diffWords(oldText || '', newText || '')
}

// Apply outputs (Inline Copy)
const applyAiOutput = (mode, content) => {
  emit('apply-output', { mode, content })
}

// Restore suggestions
const restoreAiChangesForMsg = (msg) => {
  emit('restore-changes', msg)
}
</script>

<template>
  <aside class="ai-assistant-panel" :style="{ width: aiPanelWidth + 'px' }">
    <!-- Resizer Handle -->
    <div class="ai-resizer" @pointerdown="initResize"></div>
    <div class="ai-panel-header" style="position: relative;">
      <div class="ai-session-selector-wrapper">
        <div class="ai-session-current" @click="toggleSessionDropdown" ref="sessionDropdownTriggerRef">
          <span class="session-icon">💬</span>
          <span class="session-title-text">{{ currentSession?.title || '未选择会话' }}</span>
          <span class="session-arrow">▼</span>
        </div>
        <div class="ai-session-header-actions">
          <button class="btn-new-session" @click="emit('create-session')" :title="t('new_chat')">
            ➕
          </button>
          <button 
            v-if="chatHistory.length > 0" 
            class="btn-clear-chat-header" 
            @click="emit('clear-chat')"
            :title="t('clear_history')"
          >
            🧹
          </button>
        </div>
      </div>

      <!-- Custom Session Dropdown Menu -->
      <div v-if="showSessionDropdown" class="ai-session-dropdown" ref="sessionDropdownRef">
        <div class="session-dropdown-header">
          <span>{{ t('sessions_history') }}</span>
        </div>
        <div class="session-dropdown-list">
          <div 
            v-for="s in aiSessions" 
            :key="s.id" 
            :class="['session-dropdown-item', { active: activeSessionId === s.id }]"
            @click="selectSession(s.id)"
          >
            <div class="session-item-left">
              <span class="session-item-icon">💬</span>
              <input 
                v-if="editingSessionId === s.id"
                v-model="editingSessionTitle"
                class="session-title-input"
                @blur="saveSessionRename(s.id)"
                @keyup.enter="saveSessionRename(s.id)"
                @click.stop
                ref="sessionRenameInputRef"
              />
              <span v-else class="session-item-title">{{ s.title }}</span>
            </div>
            <div class="session-item-actions">
              <button 
                v-if="editingSessionId !== s.id"
                class="btn-session-action rename" 
                @click.stop="startSessionRename(s)"
                title="重命名"
              >
                ✏️
              </button>
              <button 
                class="btn-session-action delete" 
                @click.stop="deleteSession(s.id)"
                title="删除"
              >
                🗑️
              </button>
            </div>
          </div>
        </div>
        <div v-if="aiSessions.length === 0" class="session-dropdown-empty">
          {{ t('no_sessions') }}
        </div>
      </div>
    </div>

    <!-- Selection & Document Status Indicator -->
    <div class="ai-selection-status" :class="{ active: isSelectionActive || activeArticleTitle }">
      <div class="ai-status-row">
        <span class="ai-status-item doc-context">
          📄 {{ t('active_document') }}: <strong class="doc-title-badge">{{ activeArticleTitle || t('untitled') }}</strong>
        </span>
      </div>
      <div class="ai-status-row" style="margin-top: 4px;">
        <span v-if="isSelectionActive" class="ai-status-item selection-active">
          ✨ {{ t('ai_status_selected').replace('{count}', selectedTextLength) }}
        </span>
        <span v-else class="ai-status-item">
          ℹ️ {{ t('ai_status_all') }}
        </span>
      </div>
    </div>

    <!-- Scrollable Body Container -->
    <div class="ai-panel-body">
      <!-- Quick Actions Grid -->
      <div class="ai-actions-grid">
        <button class="btn-ai-action" @click="runQuickAction('polish')" :disabled="isGenerating">
          📝 {{ t('ai_polish') }}
        </button>
        <button class="btn-ai-action" @click="runQuickAction('continue')" :disabled="isGenerating">
          ✍️ {{ t('ai_continue') }}
        </button>
        <button class="btn-ai-action" @click="runQuickAction('title')" :disabled="isGenerating">
          🔥 {{ t('ai_titles') }}
        </button>
        <button class="btn-ai-action" @click="runQuickAction('grammar')" :disabled="isGenerating">
          🔍 {{ t('ai_grammar') }}
        </button>
        <button class="btn-ai-action" @click="runQuickAction('summary')" :disabled="isGenerating">
          📖 {{ t('ai_summary') }}
        </button>
      </div>

      <!-- AI Chat Messages Area -->
      <div class="ai-chat-messages" ref="aiChatMessagesRef">
        <div v-if="chatHistory.length === 0" class="ai-chat-welcome">
          <div class="ai-welcome-icon">🤖</div>
          <h5>{{ t('ai_assistant') }}</h5>
          <p class="ai-welcome-desc">我可以帮你润色文章、续写内容、提取摘要或解答疑问。输入 @ 可以引用其他文档作为上下文。</p>
        </div>
        <div 
          v-for="(msg, index) in chatHistory" 
          :key="index" 
          :class="['ai-chat-message', msg.role]"
        >
          <div v-if="msg.role !== 'user'" class="message-header">
            <span class="message-role-badge">
              🤖 {{ t('ai_assistant') }}
            </span>
            <span v-if="msg.model" class="message-model-badge">{{ msg.model }}</span>
          </div>
          
          <div class="message-body">
            <div v-if="msg.role === 'user'" class="message-text">
              <div class="user-text-content">{{ msg.content }}</div>
              <div v-if="msg.images && msg.images.length > 0" class="message-images-attached">
                <img v-for="(imgUrl, iIdx) in msg.images" :key="iIdx" :src="imgUrl" class="chat-message-image" />
              </div>
            </div>
            <div v-else-if="msg.role === 'assistant'">
              <!-- Agent Steps Timeline -->
              <div v-if="msg.steps && msg.steps.length > 0" class="agent-steps">
                <details class="agent-steps-details" open>
                  <summary class="agent-steps-summary">
                    <span class="agent-status-indicator">
                      <span v-if="msg.isGenerating" class="pulse-dot-mini"></span>
                      {{ msg.isGenerating ? '🤖 智能体执行中...' : '🤖 智能体已执行完毕' }}
                    </span>
                    <span class="steps-count">({{ msg.steps.length }} 步)</span>
                  </summary>
                  <div class="agent-steps-timeline">
                    <div v-for="(step, sIdx) in msg.steps" :key="sIdx" :class="['agent-step', step.type]">
                      <span class="step-icon">
                        <span v-if="step.type === 'thinking'" class="icon-thinking">⚙️</span>
                        <span v-else-if="step.type === 'success'" class="icon-success">✅</span>
                        <span v-else-if="step.type === 'error'" class="icon-error">❌</span>
                        <span v-else-if="step.type === 'finish'" class="icon-finish">🏁</span>
                        <span v-else>ℹ️</span>
                      </span>
                      <span class="step-message">{{ step.message }}</span>
                    </div>
                  </div>
                </details>
              </div>

              <!-- Final Summary Output -->
              <div 
                v-if="msg.content" 
                class="ai-markdown-output" 
                v-html="md.render(msg.content)"
              ></div>

              <!-- Diff Comparison Toggle -->
              <div v-if="msg.diffInfo" class="ai-diff-toggle-wrapper">
                <button 
                  class="btn-toggle-diff" 
                  @click="msg.diffInfo.showDiff = !msg.diffInfo.showDiff"
                >
                  {{ msg.diffInfo.showDiff ? '📊 隐藏修改对比' : '📊 查看修改对比' }}
                </button>
              </div>

              <!-- Diff Comparison Container -->
              <div v-if="msg.diffInfo && msg.diffInfo.showDiff" class="ai-diff-container">
                <div class="diff-header">
                  <span>绿色为新增，红色并带删除线为被删除/替换内容：</span>
                </div>
                <div class="diff-content-box">
                  <template v-for="(part, pIdx) in getDiffParts(msg.diffInfo.oldText, msg.diffInfo.newText)" :key="pIdx">
                    <span v-if="part.removed" class="diff-removed">{{ part.value }}</span>
                    <span v-else-if="part.added" class="diff-added">{{ part.value }}</span>
                    <span v-else class="diff-unchanged">{{ part.value }}</span>
                  </template>
                </div>
              </div>
              
              <!-- Default generating message if no content and no steps yet -->
              <div v-if="msg.isGenerating && (!msg.steps || msg.steps.length === 0)" class="ai-generating-pulse">
                <span class="pulse-dot"></span> {{ t('thinking') }}
              </div>
            </div>
          </div>
          
          <!-- Assistant tools (Replace, Insert, Copy) specific to this message -->
          <div v-if="msg.role === 'assistant' && msg.content && !msg.isGenerating" class="ai-apply-tools-inline">
            <template v-if="msg.diffInfo">
              <span v-if="msg.diffInfo.restored" class="ai-applied-badge info">❌ 已还原修改内容</span>
              <template v-else>
                <span class="ai-applied-badge">✅ 已自动更新文档</span>
                <button class="btn-apply-replace-inline" @click="restoreAiChangesForMsg(msg)">还原内容</button>
              </template>
            </template>
            <template v-else-if="msg.steps && msg.steps.some(s => s.type === 'success' && (s.message.includes('write') || s.message.includes('edit') || s.message.includes('修改') || s.message.includes('保存')))">
              <span class="ai-applied-badge">✅ 已自动更新文档</span>
            </template>
            <button 
              class="btn-apply-copy-inline" 
              @click="applyAiOutput('copy', msg.content)"
              title="复制回答"
            >
              📋 复制回答
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Custom Instruction Input (Fixed at bottom) -->
    <div class="ai-panel-footer" style="position: relative;">
      <!-- Mention Dropdown -->
      <div v-if="showMentionDropdown" class="ai-mention-dropdown" ref="mentionDropdownRef">
        <div class="mention-dropdown-header">选择要引用的文档:</div>
        <div class="mention-dropdown-list">
          <div 
            v-for="(art, idx) in filteredMentionArticles" 
            :key="art.id"
            :class="['mention-item', { active: idx === selectedMentionIndex }]"
            @click="insertMention(art)"
          >
            <span class="mention-icon">📄</span>
            <span class="mention-title">{{ art.title }}</span>
          </div>
          <div v-if="filteredMentionArticles.length === 0" class="mention-empty">
            未找到匹配的文章
          </div>
        </div>
      </div>

      <!-- Attached Images Previews -->
      <div v-if="attachedImages.length > 0" class="attached-images-container">
        <div v-for="(img, idx) in attachedImages" :key="idx" class="attached-image-card">
          <img :src="img.previewUrl" class="attached-image-preview" />
          <button class="btn-remove-attachment" @click="removeAttachment(idx)">×</button>
        </div>
      </div>

      <div class="ai-custom-prompt">
        <textarea 
          ref="aiInputRef"
          v-model="localCustomInstruction" 
          :placeholder="t('ai_instruction_placeholder')"
          :disabled="isGenerating"
          @input="handleAiInput"
          @keydown="handleAiKeyDown"
          @blur="handleAiBlur"
          @paste="handlePaste"
        ></textarea>
        <div class="ai-prompt-actions">
          <button 
            class="btn-attach-image" 
            @click="selectAttachment" 
            :disabled="isGenerating"
            title="添加图片"
          >
            🖼️ 添加图片
          </button>
          <button 
            v-if="isGenerating"
            class="btn-stop-custom-ai" 
            @click="emit('stop-generating')"
          >
            🛑 停止执行
          </button>
          <button 
            v-else
            class="btn-run-custom-ai" 
            @click="runQuickAction('custom')" 
            :disabled="isGenerating || (!props.customInstruction.trim() && attachedImages.length === 0)"
          >
            {{ t('ai_execute') }}
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
/* AI Assistant Panel styles */
.ai-assistant-panel {
  position: relative;
  background: #f8fafc;
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  height: 100%;
  flex-shrink: 0;
  box-sizing: border-box;
  animation: slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.ai-resizer {
  position: absolute;
  top: 0;
  left: -4px;
  width: 8px;
  height: 100%;
  cursor: col-resize;
  background: transparent;
  z-index: 100;
  display: flex;
  justify-content: center;
}

.ai-resizer::after {
  content: '';
  width: 2px;
  height: 100%;
  background: transparent;
  transition: background 0.2s;
}

.ai-resizer:hover::after,
.ai-resizer:active::after {
  background: #07c160;
}

.ai-panel-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: white;
}

.ai-panel-header h4 {
  font-size: 13px;
  font-weight: 800;
  color: var(--text);
  margin: 0;
}

.ai-selection-status {
  padding: 8px 12px;
  background: #f1f5f9;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-light);
}

.ai-selection-status.active {
  background: oklch(95% 0.05 145);
  color: var(--success);
}

.ai-actions-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: white;
}

.btn-ai-action {
  padding: 8px;
  font-size: 11px;
  font-weight: 700;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: #fafafa;
  cursor: pointer;
  transition: 0.2s;
  text-align: left;
}

.btn-ai-action:hover:not(:disabled) {
  border-color: #07c160;
  color: #07c160;
  background: oklch(98% 0.01 145);
}

.btn-ai-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ai-panel-body {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.ai-panel-footer {
  border-top: 1px solid var(--border);
  background: white;
  flex-shrink: 0;
}

.ai-custom-prompt {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: white;
}

.ai-custom-prompt textarea {
  width: 100%;
  height: 60px;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  font-size: 11px;
  resize: none;
  outline: none;
}

.btn-run-custom-ai {
  background: #07c160;
  color: white;
  border: none;
  border-radius: 6px;
  padding: 8px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: 0.2s;
  flex: 1;
}

.btn-run-custom-ai:hover:not(:disabled) {
  background: #06ad56;
}

.btn-run-custom-ai:disabled {
  background: var(--border);
  color: var(--text-light);
  cursor: not-allowed;
}

.btn-stop-custom-ai {
  background: #fa5151;
  color: white;
  border: none;
  border-radius: 6px;
  padding: 8px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: 0.2s;
  flex: 1;
}

.btn-stop-custom-ai:hover {
  background: #de4444;
}

/* AI Prompt Actions & Attachments Styles */
.ai-prompt-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.btn-attach-image {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f5f5;
  color: #333;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 11px;
  cursor: pointer;
  transition: 0.2s;
  gap: 4px;
}

.btn-attach-image:hover:not(:disabled) {
  background: #e5e5e5;
}

.btn-attach-image:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.attached-images-container {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 16px 0;
  background: white;
}

.attached-image-card {
  position: relative;
  width: 50px;
  height: 50px;
  border-radius: 6px;
  border: 1px solid var(--border);
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  transition: transform 0.2s;
}

.attached-image-card:hover {
  transform: scale(1.05);
}

.attached-image-preview {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.btn-remove-attachment {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(0,0,0,0.6);
  color: white;
  border: none;
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  line-height: 1;
}

.btn-remove-attachment:hover {
  background: rgba(255,0,0,0.8);
}

.message-images-attached {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.ai-output-area {
  padding: 16px;
  font-size: 12px;
  line-height: 1.6;
  color: #334155;
}

.ai-output-placeholder {
  color: #94a3b8;
  font-style: italic;
  font-size: 11px;
  text-align: center;
  margin-top: 20px;
}

.ai-generating-pulse {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: #07c160;
}

.ai-markdown-output {
  padding: 10px 14px;
  background: white;
  border: 1px solid var(--border);
  border-radius: 12px 12px 12px 2px;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  color: #1e293b;
}

.ai-markdown-output :deep(p) {
  margin: 0 0 8px 0;
  line-height: 1.6;
  font-family: inherit;
  font-size: inherit;
  color: inherit;
}

.ai-markdown-output :deep(p:last-child) {
  margin-bottom: 0;
}

.ai-markdown-output :deep(h1),
.ai-markdown-output :deep(h2),
.ai-markdown-output :deep(h3),
.ai-markdown-output :deep(h4) {
  margin: 12px 0 6px 0;
  font-size: 1.1em;
  font-weight: 700;
  color: var(--text);
  font-family: inherit;
}

.ai-markdown-output :deep(ul),
.ai-markdown-output :deep(ol) {
  margin: 8px 0;
  padding-left: 20px;
  font-family: inherit;
  font-size: inherit;
}

.ai-markdown-output :deep(li) {
  margin-bottom: 4px;
  line-height: 1.5;
  font-family: inherit;
  font-size: inherit;
}

.ai-markdown-output :deep(pre) {
  margin: 8px 0;
  padding: 10px;
  border-radius: 6px;
  background: #f1f5f9;
  overflow-x: auto;
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
}

.ai-markdown-output :deep(code) {
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  background: #f1f5f9;
  padding: 2px 4px;
  border-radius: 4px;
}

.ai-markdown-output :deep(pre code) {
  padding: 0;
  background: transparent;
}

.ai-apply-tools {
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  background: white;
  display: flex;
  gap: 6px;
}

.ai-apply-tools button {
  flex: 1;
  padding: 8px;
  font-size: 10px;
  font-weight: 800;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: white;
  cursor: pointer;
  transition: 0.2s;
}

.ai-mention-dropdown {
  position: absolute;
  bottom: 100%;
  left: 16px;
  right: 16px;
  margin-bottom: 8px;
  background: white;
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.08);
  z-index: 1000;
  max-height: 200px;
  display: flex;
  flex-direction: column;
}

.mention-dropdown-header {
  padding: 8px 12px;
  font-size: 10px;
  font-weight: 700;
  color: var(--text-light);
  background: #f8fafc;
  border-bottom: 1px solid var(--border);
  border-top-left-radius: 8px;
  border-top-right-radius: 8px;
}

.mention-dropdown-list {
  overflow-y: auto;
  flex: 1;
  padding: 4px 0;
}

.mention-item {
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: background 0.15s;
}

.mention-item:hover,
.mention-item.active {
  background: oklch(98% 0.01 145);
  color: var(--success);
}

.mention-icon {
  font-size: 12px;
}

.mention-empty {
  padding: 12px;
  font-size: 11px;
  color: var(--text-light);
  text-align: center;
  font-style: italic;
}

.ai-chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: #f8fafc;
}

.ai-chat-welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 16px;
  text-align: center;
  color: var(--text-light);
}

.ai-welcome-icon {
  font-size: 32px;
  margin-bottom: 12px;
}

.ai-chat-welcome h5 {
  font-size: 13px;
  font-weight: 700;
  margin: 0 0 8px 0;
  color: var(--text);
}

.ai-welcome-desc {
  font-size: 11px;
  line-height: 1.5;
  margin: 0;
  max-width: 200px;
}

.ai-chat-message {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 90%;
}

.ai-chat-message.user {
  align-self: flex-end;
  background: #e1f5fe;
  border: 1px solid #b3e5fc;
  border-radius: 12px 12px 2px 12px;
  padding: 10px 12px;
}

.ai-chat-message.assistant {
  align-self: flex-start;
  width: 100%;
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10px;
  font-weight: 700;
  color: var(--text-light);
  margin-bottom: 2px;
}

.ai-chat-message.user .message-header {
  color: #0288d1;
}

.message-model-badge {
  font-size: 9px;
  background: #e2e8f0;
  padding: 1px 4px;
  border-radius: 3px;
  font-weight: 600;
}

.message-text {
  font-size: 13px;
  line-height: 1.5;
  color: #1e293b;
  word-break: break-all;
  white-space: pre-wrap;
  font-family: inherit;
}

.ai-apply-tools-inline {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}

.ai-apply-tools-inline button {
  padding: 4px 8px;
  font-size: 10px;
  font-weight: 700;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: white;
  cursor: pointer;
  transition: all 0.2s;
  color: var(--text-light);
}

.btn-apply-replace-inline:hover:not(:disabled) {
  border-color: #07c160;
  color: #07c160;
  background: oklch(98% 0.01 145);
}

.btn-apply-replace-inline:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: #f1f5f9;
}

.btn-apply-copy-inline:hover {
  border-color: #10b981;
  color: #10b981;
  background: #ecfdf5;
}

.ai-applied-badge {
  font-size: 10px;
  font-weight: 700;
  color: #07c160;
  background: oklch(96% 0.04 145);
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid oklch(90% 0.08 145);
  display: inline-flex;
  align-items: center;
}

.ai-applied-badge.warning {
  color: #d97706;
  background: #fef3c7;
  border-color: #fcd34d;
}

.ai-applied-badge.info {
  color: #4b5563;
  background: #f3f4f6;
  border-color: #d1d5db;
}

/* Agent Steps Timeline Styling */
.agent-steps {
  margin-bottom: 8px;
  background: rgba(15, 23, 42, 0.03);
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  font-family: inherit;
}

.agent-steps-details {
  width: 100%;
}

.agent-steps-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-light);
  cursor: pointer;
  user-select: none;
  padding-bottom: 4px;
}

.agent-steps-summary::-webkit-details-marker {
  display: none;
}

.agent-steps-summary::after {
  content: '▼';
  font-size: 8px;
  margin-left: 6px;
  transition: transform 0.2s;
  color: var(--text-light);
}

.agent-steps-details[open] .agent-steps-summary::after {
  transform: rotate(180deg);
}

.agent-status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
}

.agent-steps-timeline {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed rgba(15, 23, 42, 0.08);
}

.agent-step {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 11px;
  line-height: 1.4;
  padding: 4px 6px;
  border-radius: 4px;
  color: #475569;
}

.agent-step.thinking {
  background: rgba(59, 130, 246, 0.06);
  border-left: 2px solid #3b82f6;
}

.agent-step.success {
  background: rgba(16, 185, 129, 0.06);
  border-left: 2px solid #10b981;
  color: #065f46;
}

.agent-step.error {
  background: rgba(239, 68, 68, 0.06);
  border-left: 2px solid #ef4444;
  color: #991b1b;
}

.agent-step.finish {
  background: rgba(139, 92, 246, 0.06);
  border-left: 2px solid #8b5cf6;
  color: #5b21b6;
}

/* Diff styles */
.ai-diff-toggle-wrapper {
  margin-top: 8px;
  display: flex;
  justify-content: flex-start;
}

.btn-toggle-diff {
  background: oklch(96% 0.01 255);
  color: oklch(40% 0.1 255);
  border: 1px solid oklch(90% 0.01 255);
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.btn-toggle-diff:hover {
  background: oklch(92% 0.02 255);
  color: oklch(25% 0.12 255);
}

.ai-diff-container {
  margin-top: 10px;
  border: 1px dashed oklch(85% 0.02 255);
  border-radius: 10px;
  background: oklch(99.5% 0.002 255);
  padding: 12px;
  overflow: hidden;
}

.diff-header {
  font-size: 11px;
  color: oklch(50% 0.01 255);
  margin-bottom: 8px;
  font-weight: 500;
}

.diff-content-box {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}

.diff-removed {
  background-color: oklch(92% 0.03 15 / 80%);
  color: oklch(45% 0.15 15);
  text-decoration: line-through;
  padding: 1px 4px;
  margin: 0 1px;
  border-radius: 3px;
}

.diff-added {
  background-color: oklch(94% 0.04 140 / 80%);
  color: oklch(45% 0.16 140);
  padding: 1px 4px;
  margin: 0 1px;
  border-radius: 3px;
}

.diff-unchanged {
  color: oklch(30% 0.01 255);
}

/* AI Review Banner styles */
.ai-review-banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: oklch(95% 0.03 140);
  border: 1px solid oklch(88% 0.05 140);
  border-radius: 12px;
  padding: 12px 18px;
  margin: 15px 20px 5px 20px;
  box-shadow: 0 4px 12px oklch(0% 0 0 / 4%);
  animation: slide-down 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

/* AI Assistant Session Management Styles */
.ai-session-selector-wrapper {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.ai-session-current {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 1;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: #f8fafc;
  cursor: pointer;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--text);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  overflow: hidden;
  user-select: none;
}

.ai-session-current:hover {
  background: #ffffff;
  border-color: #07c160;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
}

.ai-session-current .session-icon {
  margin-right: 6px;
  font-size: 13px;
}

.ai-session-current .session-title-text {
  flex: 1;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-right: 6px;
}

.ai-session-current .session-arrow {
  font-size: 8px;
  color: var(--text-light);
  transition: transform 0.2s;
}

.ai-session-current:active .session-arrow {
  transform: translateY(1px);
}

.ai-session-header-actions {
  display: flex;
  gap: 4px;
  align-items: center;
}

.btn-new-session,
.btn-clear-chat-header {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: white;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.btn-new-session:hover {
  background: #f0fdf4;
  border-color: #07c160;
  color: #07c160;
  transform: translateY(-1px);
}

.btn-clear-chat-header:hover {
  background: #fef2f2;
  border-color: #ef4444;
  color: #ef4444;
  transform: translateY(-1px);
}

.ai-session-dropdown {
  position: absolute;
  top: 100%;
  left: 12px;
  right: 12px;
  margin-top: 4px;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05);
  z-index: 1000;
  animation: dropdownFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  overflow: hidden;
}

@keyframes dropdownFadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.session-dropdown-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-light);
  border-bottom: 1px solid var(--border);
  background: rgba(248, 250, 252, 0.8);
  letter-spacing: 0.5px;
}

.session-dropdown-list {
  max-height: 240px;
  overflow-y: auto;
  padding: 4px;
}

.session-dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text);
  transition: all 0.15s ease;
  margin-bottom: 2px;
}

.session-dropdown-item:last-child {
  margin-bottom: 0;
}

.session-dropdown-item:hover {
  background: rgba(241, 245, 249, 0.9);
}

.session-dropdown-item.active {
  background: rgba(7, 193, 96, 0.08);
  color: #07c160;
  font-weight: 700;
}

.session-item-left {
  display: flex;
  align-items: center;
  flex: 1;
  overflow: hidden;
}

.session-item-icon {
  margin-right: 8px;
  font-size: 12px;
  opacity: 0.7;
}

.session-item-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.session-title-input {
  width: 100%;
  border: 1px solid #07c160;
  background: white;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 12px;
  font-family: inherit;
  color: var(--text);
  outline: none;
}

.session-item-actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s ease;
  margin-left: 8px;
}

.session-dropdown-item:hover .session-item-actions {
  opacity: 1;
}

.btn-session-action {
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 2px;
  font-size: 11px;
  border-radius: 4px;
  transition: all 0.15s ease;
}

.btn-session-action:hover {
  background: rgba(0, 0, 0, 0.05);
}

.btn-session-action.delete:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.session-dropdown-empty {
  padding: 16px;
  text-align: center;
  font-size: 11px;
  color: var(--text-light);
}

/* Selection and Document Status Badge Styles */
.ai-status-row {
  display: flex;
  align-items: center;
}

.ai-status-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.doc-context {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-title-badge {
  background: rgba(226, 232, 240, 0.8);
  padding: 1px 6px;
  border-radius: 4px;
  color: var(--text);
  font-weight: 700;
  max-width: 120px;
  display: inline-block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}

.ai-selection-status.active .doc-title-badge {
  background: rgba(7, 193, 96, 0.1);
  color: #07c160;
}
</style>

