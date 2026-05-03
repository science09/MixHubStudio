<script setup>
import { ref, onMounted, onUnmounted, nextTick, computed, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import logoUrl from './assets/logo.jpg'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'

const md = new MarkdownIt({
  highlight: function (str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        const highlighted = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
        let btnHtml = '';
        if (lang.toLowerCase() === 'html' || lang.toLowerCase() === 'xml') {
          btnHtml = `<button class="btn-preview-html" data-content="${encodeURIComponent(str)}">✨ ${currentLang.value === 'zh' ? '预览效果' : 'Preview'}</button>`;
        }
        return `<div class="code-block-wrapper">${btnHtml}<pre class="hljs"><code>${highlighted}</code></pre></div>`;
      } catch (__) {}
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
  },
  linkify: true,
  breaks: true
})

// 状态管理
const activeTab = ref('chat')
const currentLang = ref('zh')

const i18n = {
  zh: {
    chat: '聊天室', models: '模型池', stats: '统计看板', sync: '同步模型', syncing: '同步中...',
    new_chat: '+ 新建会话', select_session: '请选择或创建一个会话', placeholder: '问点什么...',
    send: '发送', thinking: '思考中...', connected: '后端已连接', offline: '后端已断开',
    history: '请求历史详情', time: '时间', model: '模型', status: '状态', latency: '延迟',
    in_out: '输入 -> 输出', cached: '缓存', total_req: '总请求数', success: '成功次数',
    tokens: '总消耗 Token', error_blocked: '失败/拦截', available: '可用', cooldown: '冷却中',
    active_pool: '活跃模型池', caps: '能力', fail: '失败', last_active: '最后活跃',
    empty_state: '问点什么来开启对话吧...', total: '总计',
    settings: '系统设置', save: '保存设置', saved: '设置已保存', api_keys: 'API 密钥配置',
    aihubmix_key: 'AIHubMix 密钥', bailian_key: '阿里百炼 密钥', modelscope_key: '魔搭 密钥',
    all: '全部', provider: '供应商', api_guide: 'API 指南', endpoints: '接入端点',
    backend_error: '无法连接到后端。请确保 "make run" 正在运行。',
    server_error: '服务器错误', retry_hint: '正在尝试自动重连...',
    preview: '预览效果', preview_title: 'HTML 实时预览', close: '关闭', success_rate: '成功率',
    settings_desc: '管理你的 API 端点和供应商凭证，确保智能路由高效运行。',
    api_keys_desc: '配置后自动启用对应的模型提供商。',
    aihubmix_desc: '用于接入全球顶级模型路由',
    bailian_desc: '阿里云百炼平台访问凭证',
    modelscope_desc: '魔搭社区推理 API 密钥',
    proxy_port: '本地代理端口 (Default: 8000)',
    restart_hint: '修改后需重启应用生效',
    purge_confirm: '确定要清空所有统计数据吗？此操作不可撤销。',
    purge_btn: '清空数据',
    endpoints_desc: '支持多供应商原生端点与本地路由端点',
    api_guide_desc: '通过标准 OpenAI 协议接入，快速将多模型路由能力集成到你的业务中。',
    diagnostics: '故障排查',
    open_logs: '打开本地日志文件夹',
    logs_desc: '如果应用运行异常，请查看日志或发送给开发者'
  },
  en: {
    chat: 'Chat Studio', models: 'Model Hub', stats: 'Analytics', sync: 'Sync Models', syncing: 'Syncing...',
    new_chat: '+ New Chat', select_session: 'Select or create a session', placeholder: 'Ask anything...',
    send: 'Send', thinking: 'Thinking...', connected: 'Backend Connected', offline: 'Backend Offline',
    history: 'Detailed Request History', time: 'TIME', model: 'MODEL', status: 'STATUS', latency: 'LATENCY',
    in_out: 'IN -> OUT', cached: 'CACHED', total_req: 'Total Requests', success: 'Success Count',
    tokens: 'Tokens Consumed', error_blocked: 'Errors / Blocked', available: 'Available', cooldown: 'Cooldown',
    active_pool: 'Active Models Pool', caps: 'Capabilities', fail: 'Fail', last_active: 'Last Used',
    empty_state: 'Ask anything to start this conversation...', total: 'Total',
    settings: 'Settings', save: 'Save Settings', saved: 'Settings Saved', api_keys: 'API Keys Configuration',
    aihubmix_key: 'AIHubMix Key', bailian_key: 'Bailian Key', modelscope_key: 'ModelScope Key',
    all: 'All', provider: 'Provider', api_guide: 'API Guide', endpoints: 'Endpoints',
    backend_error: 'Cannot reach backend. Make sure "make run" is active.',
    server_error: 'Server Error', retry_hint: 'Attempting to reconnect automatically...',
    preview: 'Preview', preview_title: 'HTML Live Preview', close: 'Close', success_rate: 'Success Rate',
    settings_desc: 'Manage your API endpoints and provider credentials.',
    api_keys_desc: 'Model providers will be enabled after configuration.',
    aihubmix_desc: 'Access top-tier global models',
    bailian_desc: 'Alibaba Cloud Bailian access credentials',
    modelscope_desc: 'ModelScope community API key',
    proxy_port: 'Local Proxy Port (Default: 8000)',
    restart_hint: 'Restart app to apply changes',
    purge_confirm: 'Are you sure you want to clear all data?',
    purge_btn: 'Clear Data',
    endpoints_desc: 'Supports native provider and local routing endpoints',
    api_guide_desc: 'Integrate multi-model routing via standard OpenAI protocol.',
    diagnostics: 'Diagnostics',
    open_logs: 'Open Log Folder',
    logs_desc: 'View local logs for troubleshooting or support'
  }
}

const t = (key) => {
  if (!key) return ''
  const lang = currentLang.value || 'zh'
  return i18n[lang][key] || key
}
const copyCode = (type) => {
  const codes = {
    python: `from openai import OpenAI\n\nclient = OpenAI(api_key="YOUR_ROUTER_KEY", base_url="http://localhost:8000/v1")\n\nresponse = client.chat.completions.create(\n    model="any",\n    messages=[{"role": "user", "content": "你好"}],\n    stream=True\n)\n\nfor chunk in response:\n    print(chunk.choices[0].delta.content or "", end="")`,
    js: `const response = await fetch('http://localhost:8000/v1/chat/completions', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({\n    model: 'qwen-plus',\n    messages: [{ role: 'user', content: 'Hello' }],\n    stream: true\n  })\n});`,
    curl: `curl http://localhost:8000/v1/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "any",\n    "messages": [{"role": "user", "content": "Hi"}],\n    "stream": true\n  }'`
  }
  navigator.clipboard.writeText(codes[type])
  alert('Copied!')
}
const toggleLang = () => currentLang.value = currentLang.value === 'zh' ? 'en' : 'zh'
const stats = ref({
  summary: { total_requests: 0, success_count: 0, total_tokens: 0, fail_count: 0 },
  models: [],
  history: []
})

// 会话管理状态
const sessions = ref([])
const currentSessionId = ref(null)
const chatMessages = ref([])

const userInput = ref('')
const isSending = ref(false)
const isRefreshing = ref(false)
const isConnected = ref(true)
const connectionError = ref('')

// Artifact 预览状态
const showArtifact = ref(false)
const artifactContent = ref('')
const artifactIframe = ref(null)

const openPreview = (content) => {
  artifactContent.value = decodeURIComponent(content)
  showArtifact.value = true
  nextTick(() => {
    if (artifactIframe.value) artifactIframe.value.focus()
  })
}

const onIframeLoad = () => {
  if (artifactIframe.value) {
    artifactIframe.value.contentWindow.focus()
  }
}

// API 基础路径 (切换至 Rust 高性能引擎进行测试)
const API_BASE = 'http://127.0.0.1:8001'

// 代码示例 Tab 状态
const activeCodeTab = ref('python')
const codeTabs = [
  { id: 'python', name: 'Python (OpenAI)' },
  { id: 'js', name: 'Node.js' },
  { id: 'curl', name: 'cURL (Bash)' }
]

// 辅助函数：获取代码片段
const getCodeSnippet = (type) => {
  const snippets = {
    python: `from openai import OpenAI\n\n# 初始化路由客户端\nclient = OpenAI(\n    api_key="YOUR_AIHUB_KEY",\n    base_url="http://localhost:8000/v1"\n)\n\n# 使用 'any' 模型自动路由\nresponse = client.chat.completions.create(\n    model="any",\n    messages=[{"role": "user", "content": "你好"}],\n    stream=True\n)\n\nfor chunk in response:\n    content = chunk.choices[0].delta.content\n    if content:\n        print(content, end="")`,
    js: `// 使用 fetch 接入本地路由\nconst response = await fetch('http://localhost:8000/v1/chat/completions', {\n  method: 'POST',\n  headers: {\n    'Content-Type': 'application/json',\n    'Authorization': 'Bearer YOUR_KEY'\n  },\n  body: JSON.stringify({\n    model: 'qwen-plus',\n    messages: [{ role: 'user', content: 'Hello' }],\n    stream: true\n  })\n});`,
    curl: `curl http://localhost:8000/v1/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "any",\n    "messages": [{"role": "user", "content": "Hi"}],\n    "stream": true\n  }'`
  }
  return snippets[type] || ''
}

// 辅助函数：代码高亮渲染
const highlightCode = (code) => {
  return hljs.highlightAuto(code).value
}

// 获取全局统计
const updateStats = async () => {
  try {
    const res = await fetch(`${API_BASE}/api/stats`)
    if (res.ok) {
      stats.value = await res.json()
      isConnected.value = true
      connectionError.value = ''
    } else {
      isConnected.value = false
      connectionError.value = 'server_error'
    }
  } catch (e) {
    isConnected.value = false
    connectionError.value = 'backend_error'
  }
}

// --- 会话逻辑 ---

const loadSessions = async () => {
  try {
    const res = await fetch(`${API_BASE}/api/sessions`)
    if (res.ok) {
      sessions.value = await res.json()
      if (sessions.value.length > 0 && !currentSessionId.value) {
        selectSession(sessions.value[0].id)
      } else if (sessions.value.length === 0) {
        createNewSession()
      }
    }
  } catch (e) { console.error('Load sessions failed', e) }
}

const createNewSession = async () => {
  const id = Date.now().toString()
  const title = `New Chat ${new Date().toLocaleTimeString()}`
  try {
    await fetch(`${API_BASE}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, title })
    })
    await loadSessions()
    selectSession(id)
  } catch (e) { console.error('Create session failed', e) }
}

const selectSession = async (id) => {
  currentSessionId.value = id
  try {
    const res = await fetch(`${API_BASE}/api/sessions/${id}/messages`)
    if (res.ok) {
      chatMessages.value = await res.json()
      scrollToBottom()
    }
  } catch (e) { console.error('Load messages failed', e) }
}

const deleteSession = async (id) => {
  try {
    const res = await fetch(`${API_BASE}/api/sessions/${id}`, { method: 'DELETE' })
    if (res.ok) {
      if (currentSessionId.value === id) {
        currentSessionId.value = null
        chatMessages.value = []
      }
      await loadSessions()
    }
  } catch (e) {
    console.error('Delete session failed', e)
  }
}

const scrollToBottom = () => {
  nextTick(() => {
    const box = document.getElementById('msg-box')
    if (box) box.scrollTop = box.scrollHeight
  })
}

// --- 聊天逻辑 ---

const sendMessage = async () => {
  if (!userInput.value.trim() || isSending.value || !currentSessionId.value) return
  
  const text = userInput.value
  userInput.value = ''
  isSending.value = true
  
  // 本地添加用户消息
  chatMessages.value.push({ role: 'user', content: text })
  scrollToBottom()

  // 添加 AI 占位消息
  const aiMsgIndex = chatMessages.value.push({ 
    role: 'ai', 
    content: 'Thinking...', 
    isError: false,
    startTime: Date.now(),
    elapsed: 0
  }) - 1

  const timerInterval = setInterval(() => {
    if (chatMessages.value[aiMsgIndex] && chatMessages.value[aiMsgIndex].content === 'Thinking...') {
      chatMessages.value[aiMsgIndex].elapsed = ((Date.now() - chatMessages.value[aiMsgIndex].startTime) / 1000).toFixed(1)
    } else {
      clearInterval(timerInterval)
    }
  }, 100)
  
  // 构造上下文消息
  const contextMessages = chatMessages.value
    .filter(m => m.content !== 'Thinking...') // 排除掉加载占位符
    .slice(-15) // 取最近 15 条
    .map(m => ({ 
      role: m.role === 'ai' || m.role === 'assistant' ? 'assistant' : 'user', 
      content: m.content 
    }))

  try {
    const response = await fetch(`${API_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        model: 'any', 
        messages: contextMessages, 
        stream: true,
        session_id: currentSessionId.value,
        provider: chatProvider.value
      })
    })

    if (!response.ok) {
      let errorMsg = 'Request failed'
      try {
        const err = await response.json()
        errorMsg = err.error || err.detail || JSON.stringify(err)
      } catch (e) {
        errorMsg = await response.text() || 'Unknown error'
      }
      chatMessages.value[aiMsgIndex].content = `Error: ${errorMsg}`
      chatMessages.value[aiMsgIndex].isError = true
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        const dataStr = trimmed.slice(6)
        if (dataStr === '[DONE]') continue
        
        try {
          const data = JSON.parse(dataStr)
          if (data.model) chatMessages.value[aiMsgIndex].model = data.model
          if (data.error) {
            chatMessages.value[aiMsgIndex].content = `Error: ${data.error.message || JSON.stringify(data.error)}`
            chatMessages.value[aiMsgIndex].isError = true
          } else {
            const content = data.choices?.[0]?.delta?.content || ''
            if (content && chatMessages.value[aiMsgIndex].content === 'Thinking...') {
              chatMessages.value[aiMsgIndex].content = ''
            }
            chatMessages.value[aiMsgIndex].content += content
            scrollToBottom()
          }
        } catch (e) {}
      }
    }
    updateStats()
  } catch (e) {
    chatMessages.value[aiMsgIndex].content = `Error: ${e.message}`
    chatMessages.value[aiMsgIndex].isError = true
  } finally {
    isSending.value = false
  }
}

const refreshModels = async () => {
  isRefreshing.value = true
  try {
    await fetch(`${API_BASE}/refresh`, { method: 'POST' })
    await updateStats()
  } finally {
    isRefreshing.value = false
  }
}

const settings = ref({
  AIHUBMIX_API_KEY: '',
  BAILIAN_API_KEY: '',
  MODELSCOPE_API_KEY: '',
  PROXY_PORT: 8000
})
const isSaving = ref(false)
const modelFilter = ref('All')
const chatProvider = ref('All')
const currentPage = ref(1)
const itemsPerPage = ref(20)

const filteredModels = computed(() => {
  if (modelFilter.value.toLowerCase() === 'all') return stats.value.models
  return stats.value.models.filter(m => m.provider === modelFilter.value)
})

const localEndpoints = computed(() => [
  { p: 'Bailian', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { p: 'ModelScope', url: 'https://api-inference.modelscope.cn/v1' },
  { p: 'AIHubMix', url: 'https://api.aihubmix.com/v1' },
  { p: 'LOCAL', url: `http://localhost:${settings.value.PROXY_PORT || 8000}/v1`, special: true }
])

const paginatedHistory = computed(() => {
  if (!stats.value.history) return []
  const start = (currentPage.value - 1) * itemsPerPage.value
  const end = start + itemsPerPage.value
  return stats.value.history.slice(start, end)
})

const totalPages = computed(() => {
  if (!stats.value.history || stats.value.history.length === 0) return 0
  return Math.ceil(stats.value.history.length / itemsPerPage.value)
})

const loadSettings = async () => {
  try {
    const res = await fetch(`${API_BASE}/api/settings`)
    if (res.ok) settings.value = await res.json()
  } catch (e) {}
}

const saveSettings = async () => {
  isSaving.value = true
  try {
    const res = await fetch(`${API_BASE}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings.value)
    })
    if (res.ok) {
      alert(t('saved'))
      await loadSessions()
      await updateStats()
    }
  } finally {
    isSaving.value = false
  }
}

const purgeStats = async () => {
  if (!confirm(t('purge_confirm'))) return
  try {
    await fetch(`${API_BASE}/api/stats/purge`, { method: 'POST' })
    await updateStats()
  } catch (e) {}
}

const openLogFolder = async () => {
  try {
    await invoke('open_log_folder')
  } catch (e) {
    console.error('Failed to open log folder:', e)
  }
}

// 轮询定时器
let timer
onMounted(() => {
  updateStats()
  loadSessions()
  loadSettings()
  timer = setInterval(updateStats, 5000)
  
  // 监听预览按钮点击 (事件委托)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-preview-html')
    if (btn) {
      openPreview(btn.dataset.content)
    }
  })
})
// 监听连接状态，恢复时自动刷新数据
watch(isConnected, async (newVal, oldVal) => {
  if (newVal === true && oldVal === false) {
    console.log('Backend reconnected, refreshing data...')
    await loadSessions()
    await loadSettings()
  }
})

// 监听标签页切换
watch(activeTab, (newTab) => {
  if (newTab === 'chat') {
    scrollToBottom()
  }
})

// 监听消息变化，自动滚动到底部
watch(chatMessages, () => {
  scrollToBottom()
}, { deep: true })

onUnmounted(() => clearInterval(timer))

</script>

<template>
  <div class="app-container">
    <!-- 侧边栏 -->
    <aside class="sidebar">
      <div class="logo">
        <img :src="logoUrl" class="logo-img" alt="MixHub">
        <span>MixHub Studio</span>
      </div>
      <nav>
        <div :class="['nav-item', { active: activeTab === 'chat' }]" @click="activeTab = 'chat'">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
          {{ t('chat') }}
        </div>
        <div :class="['nav-item', { active: activeTab === 'docs' }]" @click="activeTab = 'docs'" key="api-guide-item">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>
          {{ t('api_guide') }}
        </div>
        <div :class="['nav-item', { active: activeTab === 'models' }]" @click="activeTab = 'models'">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
          {{ t('models') }}
        </div>
        <div :class="['nav-item', { active: activeTab === 'stats' }]" @click="activeTab = 'stats'">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
          {{ t('stats') }}
        </div>
        <div :class="['nav-item', { active: activeTab === 'settings' }]" @click="activeTab = 'settings'">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          {{ t('settings') }}
        </div>
      </nav>
      
      <div class="connection-status" :class="{ offline: !isConnected }">
        <span class="status-dot"></span>
        {{ isConnected ? t('connected') : t('offline') }}
      </div>
      <div class="sidebar-footer">
        <button class="btn-sync" @click="refreshModels" :disabled="isRefreshing">
          {{ isRefreshing ? t('syncing') : t('sync') }}
        </button>
        <button class="btn-lang" @click="toggleLang">
          🌐 {{ currentLang === 'zh' ? 'English' : '中文' }}
        </button>
      </div>
    </aside>

    <!-- 主内容区 -->
    <main class="main-content">
      <div v-if="!isConnected" class="connection-error-banner">
        <div class="error-content">
          <span class="error-icon">⚠️</span>
          <span class="error-text">{{ t(connectionError) }}</span>
          <div class="error-retry-hint">{{ t('retry_hint') }}</div>
        </div>
      </div>

      <!-- 聊天页 (双栏布局) -->
      <section v-if="activeTab === 'chat'" class="tab-pane h-full">
        <div class="chat-workspace">
          <!-- 会话列表 -->
          <div class="sessions-sidebar">
            <div class="sessions-header">
              <button class="btn-new-chat" @click="createNewSession">{{ t('new_chat') }}</button>
            </div>
            <div class="sessions-list">
              <div 
                v-for="s in sessions" 
                :key="s.id" 
                :class="['session-item', { active: currentSessionId === s.id }]"
                @click="selectSession(s.id)"
              >
                <div class="session-title">{{ s.title }}</div>
                <button class="btn-delete-session" @click.stop="deleteSession(s.id)">×</button>
              </div>
            </div>
          </div>

          <!-- 聊天主窗 -->
          <div class="chat-main">
            <div class="chat-header">
              <div v-if="currentSessionId">
                <h2>{{ sessions.find(s => s.id === currentSessionId)?.title }}</h2>
              </div>
              <div v-else>
                <h2>{{ t('select_session') }}</h2>
              </div>
              <div class="provider-selector" v-if="currentSessionId">
                <span class="label">🌐 {{ t('provider') }}:</span>
                <select v-model="chatProvider">
                  <option value="All">{{ t('all') }}</option>
                  <option value="Bailian">Bailian</option>
                  <option value="ModelScope">ModelScope</option>
                  <option value="AIHubMix">AIHubMix</option>
                </select>
              </div>
            </div>
            <div class="chat-messages-premium" id="msg-box">
              <div v-for="(msg, i) in chatMessages" :key="i" :class="['msg-item-premium', msg.role]">
                <div class="msg-bubble-premium" :class="{ 'is-error': msg.isError, 'is-ai': msg.role === 'ai' || msg.role === 'assistant' }">
                  <template v-if="msg.content === 'Thinking...'">
                    <div class="typing-premium">
                      <div class="typing-dots"><span></span><span></span><span></span></div>
                      <div class="typing-time">{{ msg.elapsed }}s</div>
                    </div>
                  </template>
                  <template v-else>
                    <div v-if="msg.role === 'assistant' || msg.role === 'ai'" class="markdown-body-premium" v-html="md.render(msg.content)"></div>
                    <div v-else class="user-text">{{ msg.content }}</div>
                  </template>
                  
                  <div v-if="msg.model && (msg.role === 'ai' || msg.role === 'assistant')" class="msg-meta-distilled">
                    <span class="meta-model">{{ msg.model }}</span>
                    <span v-if="msg.elapsed" class="meta-sep">/</span>
                    <span v-if="msg.elapsed" class="meta-time">{{ msg.elapsed }}s</span>
                  </div>
                </div>
              </div>
              <div v-if="chatMessages.length === 0" class="empty-chat-premium">
                <div class="empty-glow"></div>
                <div class="empty-content">
                  <span class="empty-emoji">✨</span>
                  <p>{{ t('empty_state') }}</p>
                </div>
              </div>
            </div>
            <div class="chat-input-wrapper">
              <div class="chat-input-area">
                <input 
                  v-model="userInput" 
                  type="text" 
                  :disabled="!currentSessionId"
                  :placeholder="t('placeholder')" 
                  @keypress.enter="sendMessage"
                >
                <button 
                  class="btn-send-premium" 
                  @click="sendMessage" 
                  :disabled="isSending || !currentSessionId || !userInput.trim()"
                >
                  <svg v-if="!isSending" class="send-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                  <span v-else>...</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 模型页 -->
      <section v-if="activeTab === 'models'" class="tab-pane">
        <div class="models-premium">
          <div class="view-header">
            <div class="header-main">
              <h1>{{ t('active_pool') }}</h1>
              <span class="count-badge">{{ filteredModels.length }} {{ t('total') }}</span>
            </div>
            <div class="filter-bar-premium">
              <div 
                v-for="p in ['all', 'Bailian', 'ModelScope', 'AIHubMix']" 
                :key="p"
                :class="['filter-item', { active: modelFilter === p }]"
                @click="modelFilter = p"
              >
                {{ t(p.toLowerCase()) || p }}
              </div>
            </div>
          </div>

          <div class="models-grid-premium">
            <div v-for="m in filteredModels" :key="m.id" class="model-card-premium">
              <div class="m-card-header">
                <span class="m-name">{{ m.id }}</span>
                <span v-if="m.capabilities && m.capabilities.includes('multimodal')" class="m-cap-tag">Vision</span>
              </div>
              
              <div class="m-card-body">
                <div class="m-info-row">
                  <span :class="['p-tag-mini', m.provider.toLowerCase()]">{{ m.provider }}</span>
                  <div class="m-status-mini">
                    <span :class="['status-pulse', m.status === 'Available' ? 'online' : 'cooldown']"></span>
                    <span class="status-label">{{ m.status === 'Available' ? 'ACTIVE' : 'IDLE' }}</span>
                  </div>
                </div>
                
                <div class="m-stats-row">
                  <div class="stat-unit">
                    <span class="stat-label">REQUESTS</span>
                    <span class="stat-value">{{ m.success || 0 }}</span>
                  </div>
                  <div class="stat-unit">
                    <span class="stat-label">TOKENS</span>
                    <span class="stat-value">{{ m.tokens?.toLocaleString() || 0 }}</span>
                  </div>
                </div>
              </div>

              <div class="m-card-footer">
                <span class="last-seen">LAST ACTIVE: {{ m.last_active || 'NEVER' }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>
      
      <!-- 统计页 -->
      <section v-if="activeTab === 'stats'" class="tab-pane">
        <div class="metrics-bar">
          <div class="metric-item">
            <span class="m-label">{{ t('total_req') }}</span>
            <span class="m-value">{{ stats.summary.total_requests }}</span>
          </div>
          <div class="metric-divider"></div>
          <div class="metric-item">
            <span class="m-label">{{ t('success') }}</span>
            <span class="m-value text-success">{{ stats.summary.success_count }}</span>
          </div>
          <div class="metric-divider"></div>
          <div class="metric-item">
            <span class="m-label">{{ t('tokens') }}</span>
            <span class="m-value">{{ stats.summary.total_tokens.toLocaleString() }}</span>
          </div>
          <div class="metric-divider"></div>
          <div class="metric-item">
            <span class="m-label">{{ t('error_blocked') }}</span>
            <span class="m-value text-danger">{{ stats.summary.fail_count }}</span>
          </div>
          <div class="metric-divider"></div>
          <div class="metric-item">
            <span class="m-label">{{ t('success_rate') }}</span>
            <span class="m-value highlight">
              {{ ((stats.summary.success_count / (stats.summary.total_requests || 1)) * 100).toFixed(1) }}%
            </span>
          </div>
        </div>
        
        <div class="history-premium mt-8">
          <div class="view-header">
            <h3>{{ t('history') }} <span class="page-indicator-distilled" v-if="totalPages > 0">({{ currentPage }} / {{ totalPages }})</span></h3>
            <button class="btn-purge" @click="purgeStats">🗑️ {{ t('purge_btn') }}</button>
          </div>
          
          <div class="history-list-premium">
            <div class="h-thead">
              <div class="col-time">{{ t('time') }}</div>
              <div class="col-model">{{ t('model') }}</div>
              <div class="col-status">{{ t('status') }}</div>
              <div class="col-latency">{{ t('latency') }}</div>
              <div class="col-io">{{ t('io_tokens') }}</div>
            </div>

            <div v-for="(h, i) in paginatedHistory" :key="i" class="h-row">
              <div class="col-time">{{ h.time }}</div>
              <div class="col-model">{{ h.model }}</div>
              <div class="col-status">
                <span :class="['h-status-tag', (h.status && h.status.toLowerCase() === 'success') ? 'success' : 'error']">
                  {{ (h.status && h.status.toLowerCase() === 'success') ? 'SUCCESS' : 'ERROR' }}
                </span>
              </div>
              <div class="col-latency">{{ h.latency }}s</div>
              <div class="col-io">
                <span class="io-val">{{ h.p }}</span>
                <span class="io-arr">→</span>
                <span class="io-val">{{ h.c }}</span>
              </div>
            </div>
          </div>

          <!-- Pagination -->
          <div v-if="totalPages > 1" class="pagination-premium">
            <button :disabled="currentPage === 1" @click="currentPage--" class="page-nav">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <div class="page-numbers">
              <span 
                v-for="p in totalPages" 
                :key="p"
                :class="['page-num', { active: currentPage === p }]"
                @click="currentPage = p"
              >
                {{ p }}
              </span>
            </div>
            <button :disabled="currentPage === totalPages" @click="currentPage++" class="page-nav">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
          </div>
        </div>
      </section>

      <!-- 开发者中心 (API 指南) -->
      <section v-if="activeTab === 'docs'" class="tab-pane">
        <div class="docs-premium">
          <div class="view-header">
            <h1>{{ t('api_guide') }}</h1>
            <p class="view-subtitle">{{ t('api_guide_desc') }}</p>
          </div>

          <div class="docs-grid-premium">
            <!-- 快速接入：端点 -->
            <div class="docs-section-premium full-width">
              <div class="section-header-distilled">
                <div class="header-icon">🔌</div>
                <div class="header-text">
                  <h3>{{ t('endpoints') }}</h3>
                  <p>{{ t('endpoints_desc') }}</p>
                </div>
              </div>
              <div class="endpoints-distilled">
                <div v-for="ep in localEndpoints" :key="ep.p" :class="['ep-card-distilled', { local: ep.special }]">
                  <span :class="['p-tag-mini', ep.p.toLowerCase()]">{{ ep.p }}</span>
                  <code class="ep-url">{{ ep.url }}</code>
                </div>
              </div>
            </div>

            <!-- 代码示例：集成编辑器 -->
            <div class="docs-section-premium full-width">
              <div class="editor-frame-premium">
                <div class="editor-header">
                  <div class="editor-tabs">
                    <div 
                      v-for="tab in codeTabs" 
                      :key="tab.id"
                      :class="['editor-tab', { active: activeCodeTab === tab.id }]"
                      @click="activeCodeTab = tab.id"
                    >
                      <span class="tab-dot"></span>
                      {{ tab.name }}
                    </div>
                  </div>
                  <button class="btn-copy-distilled" @click="copyCode(activeCodeTab)">
                    <svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    <span>COPY</span>
                  </button>
                </div>
                <div class="editor-content">
                  <pre class="hljs"><code v-html="highlightCode(getCodeSnippet(activeCodeTab))"></code></pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      
      <section v-if="activeTab === 'settings'" class="tab-pane">
        <div class="settings-premium">
          <div class="view-header">
            <h1>{{ t('settings') }}</h1>
            <p>{{ t('settings_desc') }}</p>
          </div>

          <div class="settings-sections">
            <!-- 核心凭证组 -->
            <div class="settings-group">
              <div class="group-header">
                <h3>{{ t('api_keys') }}</h3>
                <p>{{ t('api_keys_desc') }}</p>
              </div>
              
              <div class="settings-list">
                <div class="settings-row">
                  <div class="s-info">
                    <label>{{ t('aihubmix_key') }}</label>
                    <span class="s-desc">{{ t('aihubmix_desc') }}</span>
                  </div>
                  <div class="s-action">
                    <input v-model="settings.AIHUBMIX_API_KEY" type="password" placeholder="sk-...">
                  </div>
                </div>

                <div class="settings-row">
                  <div class="s-info">
                    <label>{{ t('bailian_key') }}</label>
                    <span class="s-desc">{{ t('bailian_desc') }}</span>
                  </div>
                  <div class="s-action">
                    <input v-model="settings.BAILIAN_API_KEY" type="password" placeholder="sk-...">
                  </div>
                </div>

                <div class="settings-row">
                  <div class="s-info">
                    <label>{{ t('modelscope_key') }}</label>
                    <span class="s-desc">{{ t('modelscope_desc') }}</span>
                  </div>
                  <div class="s-action">
                    <input v-model="settings.MODELSCOPE_API_KEY" type="password" placeholder="Key...">
                  </div>
                </div>

                <div class="settings-row">
                  <div class="s-info">
                    <label>{{ t('proxy_port') }}</label>
                    <span class="s-desc">{{ t('restart_hint') }}</span>
                  </div>
                  <div class="s-action">
                    <input v-model="settings.PROXY_PORT" type="number" placeholder="8000">
                  </div>
                </div>
              </div>

            </div>

            <!-- 诊断组 -->
            <div class="settings-group">
              <div class="group-header">
                <h3>{{ t('diagnostics') }}</h3>
                <p>{{ t('logs_desc') }}</p>
              </div>
              <div class="settings-list">
                <div class="settings-row">
                  <div class="s-info">
                    <label>{{ t('open_logs') }}</label>
                    <span class="s-desc">Path: ~/Library/Logs/com.mixhub.ultimate/</span>
                  </div>
                  <div class="s-action">
                    <button class="btn-sync" style="margin-bottom: 0;" @click="openLogFolder">📁 {{ t('open_logs') }}</button>
                  </div>
                </div>
              </div>
            </div>

            <!-- 操作区 -->
            <div class="settings-footer-premium">
              <button class="btn-save-premium" @click="saveSettings" :disabled="isSaving">
                <svg v-if="!isSaving" class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                <span v-if="!isSaving">{{ t('save') }}</span>
                <span v-else>⏳ {{ t('syncing') }}</span>
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>

    <!-- Artifact 预览侧板 -->
    <div v-if="showArtifact" class="artifact-overlay" @click.self="showArtifact = false">
      <div class="artifact-panel">
        <div class="artifact-header">
          <div class="artifact-title">
            <span class="artifact-icon">✨</span>
            {{ t('preview_title') }}
          </div>
          <button class="btn-close-artifact" @click="showArtifact = false">{{ t('close') }}</button>
        </div>
        <div class="artifact-body">
          <iframe 
            ref="artifactIframe"
            :srcdoc="artifactContent" 
            frameborder="0" 
            sandbox="allow-scripts allow-same-origin"
            @load="onIframeLoad"
          ></iframe>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
:root {
  /* OKLCH Color System - Brand: Indigo */
  --primary: oklch(60% 0.18 255);
  --primary-light: oklch(94% 0.04 255);
  --primary-hover: oklch(55% 0.20 255);
  
  --bg: oklch(99% 0.005 255);           /* Tinted White */
  --sidebar: oklch(97.5% 0.01 255);     /* Tinted Sidebar */
  --border: oklch(93% 0.01 255);        /* Subtle Border */
  
  --text: oklch(25% 0.02 255);          /* Deep Tinted Grey */
  --text-light: oklch(55% 0.015 255);
  
  --success: oklch(68% 0.16 145);
  --warning: oklch(78% 0.16 85);
  --danger: oklch(62% 0.18 25);
  
  /* Modular Scale (1.25) */
  --fs-h1: 2.441rem;
  --fs-h2: 1.953rem;
  --fs-h3: 1.563rem;
  --fs-h4: 1.25rem;
  --fs-base: 0.938rem;
  --fs-small: 0.75rem;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body { 
  font-family: 'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  overflow: hidden;
}

h1, h2, h3 { 
  line-height: 1.15; 
  font-weight: 800; 
  letter-spacing: -0.02em;
  color: var(--text);
}

.app-container { display: flex; height: 100vh; }
.h-full { height: 100%; }

/* Sidebar */
.sidebar { width: 240px; background: var(--sidebar); border-right: 1px solid var(--border); display: flex; flex-direction: column; padding: 20px; }
.logo { display: flex; align-items: center; gap: 12px; margin-bottom: 30px; }
.logo-img { width: 30px; height: 30px; border-radius: 8px; object-fit: cover; border: 1px solid var(--border); }
.logo span:last-child { font-weight: 900; font-size: 18px; color: var(--text); letter-spacing: -0.02em; }
nav { flex: 1; overflow-y: auto; margin: 10px 0; }
.nav-item { display: flex; align-items: center; gap: 14px; padding: 12px 16px; border-radius: 12px; cursor: pointer; margin-bottom: 4px; color: var(--text-light); font-weight: 700; transition: 0.2s; font-size: 14px; }
.nav-item:hover { background: var(--bg); color: var(--text); }
.nav-item:hover .nav-icon { transform: scale(1.1); color: var(--primary); }
.nav-item.active { background: var(--primary-light); color: var(--primary); }
.nav-item.active .nav-icon { color: var(--primary); }

.nav-icon { width: 18px; height: 18px; transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1); }

.btn-icon { width: 14px; height: 14px; }

/* Connection Status */
.connection-status { margin-bottom: 12px; padding: 8px 12px; background: #f0fdf4; color: #166534; border-radius: 8px; font-size: 11px; display: flex; align-items: center; font-weight: 600; }
.connection-status.offline { background: #fef2f2; color: #991b1b; }
.connection-status .status-dot { width: 6px; height: 6px; background: currentColor; margin-right: 8px; border-radius: 50%; }

/* Connection Error Banner Premium */
.connection-error-banner {
  position: sticky;
  top: 16px;
  z-index: 1000;
  margin: 0 24px 24px 24px;
  padding: 12px 20px;
  background: oklch(95% 0.05 45 / 80%);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid oklch(85% 0.1 45);
  border-radius: 14px;
  box-shadow: 0 4px 20px oklch(0% 0 0 / 5%);
  animation: slideDown 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes slideDown {
  from { transform: translateY(-10px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

.error-content {
  display: flex;
  align-items: center;
  gap: 12px;
}

.error-icon {
  font-size: 16px;
  animation: errorPulse 2s infinite;
}

@keyframes errorPulse {
  0% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.1); opacity: 0.7; }
  100% { transform: scale(1); opacity: 1; }
}

.error-text {
  font-size: 13px;
  font-weight: 700;
  color: oklch(40% 0.15 45);
  flex: 1;
}

.error-retry-hint {
  font-size: 11px;
  font-weight: 600;
  color: oklch(50% 0.1 45);
  opacity: 0.8;
}

.sidebar-footer { border-top: 1px solid var(--border); padding-top: 15px; }
.btn-sync { width: 100%; padding: 10px; border-radius: 10px; border: 1px solid var(--border); background: white; cursor: pointer; font-size: 13px; font-weight: 600; transition: all 0.2s; margin-bottom: 8px; }
.btn-sync:hover { background: #f8fafc; border-color: var(--primary); color: var(--primary); }

.btn-lang { width: 100%; padding: 8px; background: rgba(255,255,255,0.05); color: var(--text-light); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; font-size: 13px; cursor: pointer; transition: 0.2s; }
.btn-lang:hover { background: rgba(255,255,255,0.1); border-color: var(--primary); }

/* Main Content */
.main-content { flex: 1; display: flex; flex-direction: column; background: var(--bg); height: 100vh; overflow: hidden; }
.tab-pane { flex: 1; display: flex; flex-direction: column; padding: 25px; overflow-y: auto; align-items: center; }
.tab-pane > div, .tab-pane > section { width: 100%; max-width: 1350px; }

.view-header { margin-bottom: 12px; display: flex; justify-content: space-between; align-items: baseline; }
.view-header h1 { font-size: 2.2rem; font-weight: 850; letter-spacing: -0.04em; color: var(--text); margin: 0; }
.view-header h2 { font-size: 1.8rem; font-weight: 850; margin: 0; }
.view-header h3 { font-size: 1.4rem; font-weight: 850; margin: 0; }
.btn-purge { background: none; border: 1px solid var(--border); color: var(--text-light); padding: 4px 12px; border-radius: 8px; font-size: 11px; font-weight: 700; cursor: pointer; transition: 0.2s; }
.btn-purge:hover { background: #fef2f2; color: #ef4444; border-color: #fee2e2; }

/* Chat Workspace */
.chat-workspace { display: flex; flex: 1; background: white; border-radius: 20px; border: 1px solid var(--border); overflow: hidden; height: calc(100vh - 50px); }

/* Sessions Sidebar */
.sessions-sidebar { width: 260px; border-right: 1px solid var(--border); display: flex; flex-direction: column; background: #fcfdfe; }
.sessions-header { padding: 15px; border-bottom: 1px solid var(--border); }
.btn-new-chat { width: 100%; padding: 10px; border-radius: 8px; border: 1px dashed var(--primary); background: var(--primary-light); color: var(--primary); font-weight: 600; cursor: pointer; }
.btn-new-chat:hover { background: #e0e7ff; }

.sessions-list { flex: 1; overflow-y: auto; padding: 10px; }
.session-item {
  padding: 12px 16px;
  border-radius: 12px;
  cursor: pointer;
  margin-bottom: 8px;
  transition: all 0.2s ease;
  position: relative;
  border: 1px solid transparent;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}
.session-item:hover { background: rgba(255, 255, 255, 0.05); }
.session-item.active { background: rgba(99, 102, 241, 0.1); border-color: rgba(99, 102, 241, 0.3); }
.session-title { flex: 1; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.btn-delete-session {
  opacity: 0;
  background: none;
  border: none;
  color: #ff4d4f;
  font-size: 18px;
  padding: 4px 8px;
  border-radius: 6px;
  transition: all 0.2s;
  cursor: pointer;
}
.session-item:hover .btn-delete-session { opacity: 1; }
.btn-delete-session:hover { background: rgba(255, 77, 79, 0.1); transform: scale(1.1); }

/* Chat Main Area */
.chat-main { flex: 1; display: flex; flex-direction: column; }
.chat-header { padding: 16px 24px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: white; }
.provider-selector { display: flex; align-items: center; gap: 8px; background: #f8fafc; padding: 4px 12px; border-radius: 10px; border: 1px solid var(--border); }
.provider-selector .label { font-size: 12px; font-weight: 600; color: var(--text-light); }
.provider-selector select { border: none; background: transparent; font-size: 12px; font-weight: 700; color: var(--primary); cursor: pointer; outline: none; }
.chat-header h2 { margin: 0; font-size: 18px; }
.chat-header p { margin: 4px 0 0; color: var(--text-light); font-size: 13px; }

/* Premium Chat Distillation */
.chat-messages-premium { flex: 1; padding: 24px 30px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; background: #fafafa; scroll-behavior: smooth; }
.msg-item-premium { display: flex; flex-direction: column; width: 100%; }
.msg-item-premium.user { align-items: flex-end; }
.msg-item-premium.ai, .msg-item-premium.assistant { align-items: flex-start; }

.msg-bubble-premium { position: relative; max-width: 85%; padding: 12px 20px; border-radius: 18px; transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
.user .msg-bubble-premium { background: var(--primary); color: white; border-bottom-right-radius: 4px; box-shadow: 0 8px 24px var(--primary-light); }
.is-ai.msg-bubble-premium { background: white; border: 1px solid var(--border); border-top-left-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.01); }
.is-ai.msg-bubble-premium:hover { border-color: var(--primary-light); box-shadow: 0 8px 20px rgba(0,0,0,0.03); }
.is-error { background: #fef2f2 !important; border-color: #fee2e2 !important; color: #991b1b; }

.markdown-body-premium { font-size: 14.5px; line-height: 1.6; color: var(--text); }
.markdown-body-premium p { margin-bottom: 10px; }
.markdown-body-premium p:last-child { margin-bottom: 0; }
.markdown-body-premium ul, .markdown-body-premium ol { padding-left: 20px; margin: 8px 0; }
.markdown-body-premium li { margin-bottom: 6px; }
.markdown-body-premium li::marker { color: var(--primary); font-weight: 800; }
.markdown-body-premium code:not(pre code) { background: var(--bg); color: var(--primary); padding: 2px 5px; border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 0.9em; font-weight: 600; }

.user-text { font-size: 14.5px; font-weight: 500; line-height: 1.5; }

.msg-meta-distilled { margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--border); display: flex; align-items: center; gap: 8px; opacity: 0; transition: 0.2s; }
.msg-bubble-premium:hover .msg-meta-distilled { opacity: 0.8; }
.meta-model { font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 800; color: var(--text-light); text-transform: uppercase; letter-spacing: 0.05em; }
.meta-sep { color: var(--border); font-size: 10px; }
.meta-time { font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 700; color: var(--primary); }

.typing-premium { display: flex; align-items: center; gap: 12px; }
.typing-dots { display: flex; gap: 4px; }
.typing-dots span { width: 6px; height: 6px; background: var(--primary); border-radius: 50%; animation: typing 1.4s infinite ease-in-out both; }
.typing-dots span:nth-child(2) { animation-delay: 0.2s; }
.typing-dots span:nth-child(3) { animation-delay: 0.4s; }
.typing-time { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--text-light); font-weight: 600; }

.empty-chat-premium { flex: 1; display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden; }
.empty-glow { position: absolute; width: 300px; height: 300px; background: radial-gradient(circle, var(--primary-light) 0%, transparent 70%); opacity: 0.3; filter: blur(40px); }
.empty-content { position: relative; text-align: center; color: var(--text-light); z-index: 1; }
.empty-emoji { font-size: 40px; margin-bottom: 16px; display: block; filter: drop-shadow(0 0 10px var(--primary-light)); }
.empty-content p { font-size: 15px; font-weight: 600; letter-spacing: 0.02em; }

/* Distilled Chat Input */
.chat-input-wrapper { padding: 20px 30px 30px; background: white; border-top: 1px solid var(--border); }
.chat-input-area { display: flex; align-items: center; gap: 12px; background: var(--bg); border: 1px solid var(--border); padding: 8px 10px 8px 20px; border-radius: 16px; transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
.chat-input-area:focus-within { border-color: var(--primary); background: white; box-shadow: 0 4px 20px rgba(0,0,0,0.05); }

.chat-input-area input { flex: 1; border: none !important; background: transparent !important; padding: 10px 0; font-size: 15px; color: var(--text); outline: none; box-shadow: none !important; }
.chat-input-area input::placeholder { color: var(--text-light); opacity: 0.6; }

.btn-send-premium { width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; background: var(--primary); color: white; border: none; border-radius: 12px; cursor: pointer; transition: 0.3s; flex-shrink: 0; }
.btn-send-premium:hover:not(:disabled) { transform: scale(1.05) translateY(-2px); box-shadow: 0 6px 15px var(--primary-light); background: var(--primary-hover); }
.btn-send-premium:disabled { background: var(--border); color: var(--text-light); opacity: 0.5; cursor: not-allowed; }

.send-icon { width: 18px; height: 18px; transform: translateX(-1px) translateY(1px); }

/* Distilled Docs Premium */
.docs-premium { width: 100%; }
.view-subtitle { font-size: 15px; color: var(--text-light); margin-top: 4px; }
.docs-grid-premium { display: flex; flex-direction: column; gap: 40px; margin-top: 30px; }

.section-header-distilled { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
.header-icon { font-size: 24px; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; background: var(--bg); border-radius: 12px; }
.header-text h3 { font-size: 18px; font-weight: 850; margin: 0; }
.header-text p { font-size: 12px; color: var(--text-light); margin: 2px 0 0; }

.endpoints-distilled { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
.ep-card-distilled { background: white; border: 1px solid var(--border); padding: 16px 20px; border-radius: 16px; display: flex; flex-direction: column; gap: 10px; transition: 0.3s; }
.ep-card-distilled:hover { border-color: var(--primary); transform: translateY(-2px); box-shadow: 0 10px 25px rgba(0,0,0,0.03); }
.ep-card-distilled.local { background: oklch(98% 0.01 255); border-color: var(--primary-light); }
.ep-url { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text); word-break: break-all; opacity: 0.8; }

.editor-frame-premium { background: #0f172a; border-radius: 24px; overflow: hidden; border: 1px solid rgba(255,255,255,0.05); box-shadow: 0 20px 50px rgba(0,0,0,0.2); }
.editor-header { display: flex; justify-content: space-between; align-items: center; padding: 0 24px; background: rgba(255,255,255,0.03); border-bottom: 1px solid rgba(255,255,255,0.05); }
.editor-tabs { display: flex; gap: 8px; }
.editor-tab { padding: 18px 20px; font-size: 13px; font-weight: 800; color: #94a3b8; cursor: pointer; transition: 0.2s; display: flex; align-items: center; gap: 8px; position: relative; }
.editor-tab:hover { color: white; }
.editor-tab.active { color: #38bdf8; }
.tab-dot { width: 6px; height: 6px; border-radius: 50%; background: #334155; transition: 0.3s; }
.editor-tab.active .tab-dot { background: #38bdf8; box-shadow: 0 0 8px #38bdf8; }

.btn-copy-distilled { background: transparent; border: 1px solid rgba(255,255,255,0.1); color: #94a3b8; padding: 6px 14px; border-radius: 8px; font-size: 11px; font-weight: 850; cursor: pointer; transition: 0.2s; display: flex; align-items: center; gap: 8px; }
.btn-copy-distilled:hover { background: rgba(255,255,255,0.05); color: white; border-color: rgba(255,255,255,0.2); }
.copy-icon { width: 14px; height: 14px; }

.editor-content { padding: 0; }
.editor-content pre { margin: 0; padding: 30px; background: transparent !important; }
.editor-content code { font-family: 'JetBrains Mono', monospace; font-size: 14px; line-height: 1.8; color: #e2e8f0; }
.btn-copy-premium:hover { background: #38bdf8; color: white; }

.code-viewer { position: relative; }
.code-content { margin: 0; padding: 24px; background: #0f172a !important; color: #f1f5f9 !important; font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 14px; line-height: 1.7; overflow-x: auto; min-height: 300px; }

.provider-tag.local { background: #6366f1; color: white; }
/* Premium Model Cards Grid */
.models-premium { width: 100%; }
.header-main { display: flex; align-items: baseline; gap: 16px; margin-bottom: 24px; }
.count-badge { padding: 4px 12px; background: var(--primary-light); color: var(--primary); border-radius: 20px; font-size: 11px; font-weight: 850; letter-spacing: 0.05em; }

.filter-bar-premium { display: flex; gap: 6px; margin-bottom: 32px; background: var(--sidebar); padding: 4px; border-radius: 14px; border: 1px solid var(--border); width: fit-content; }
.filter-item { padding: 8px 20px; border-radius: 10px; font-size: 13px; font-weight: 700; color: var(--text-light); cursor: pointer; transition: 0.2s; }
.filter-item:hover { color: var(--text); }
.filter-item.active { background: white; color: var(--primary); box-shadow: 0 2px 8px rgba(0,0,0,0.05); }

.models-grid-premium { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.model-card-premium { background: white; border: 1px solid var(--border); border-radius: 14px; padding: 18px; display: flex; flex-direction: column; gap: 14px; transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1); position: relative; }
.model-card-premium:hover { border-color: var(--primary); transform: translateY(-3px); box-shadow: 0 8px 24px rgba(0,0,0,0.04); }

.m-card-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
.m-name { font-size: 14px; font-weight: 850; color: var(--text); letter-spacing: -0.01em; line-height: 1.25; min-height: 2.5em; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.m-cap-tag { font-size: 8px; font-weight: 900; background: var(--bg); color: var(--text-light); padding: 1px 5px; border-radius: 3px; text-transform: uppercase; flex-shrink: 0; }

.m-info-row { display: flex; align-items: center; justify-content: space-between; margin-top: -4px; }
.p-tag-mini { font-size: 9px; font-weight: 800; padding: 2px 6px; border-radius: 5px; text-transform: uppercase; letter-spacing: 0.05em; }
.p-tag-mini.bailian { background: oklch(96% 0.04 40); color: oklch(50% 0.15 40); }
.p-tag-mini.modelscope { background: oklch(96% 0.04 280); color: oklch(50% 0.15 280); }
.p-tag-mini.aihubmix { background: oklch(96% 0.04 255); color: oklch(50% 0.15 255); }

.m-status-mini { display: flex; align-items: center; gap: 4px; }
.status-pulse { width: 5px; height: 5px; border-radius: 50%; }
.status-pulse.online { background: var(--success); box-shadow: 0 0 6px var(--success); animation: pulse 2s infinite; }
.status-pulse.cooldown { background: var(--warning); }
@keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; } }
.status-label { font-size: 9px; font-weight: 850; color: var(--text-light); letter-spacing: 0.05em; }

.m-stats-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 10px; background: var(--bg); border-radius: 10px; }
.stat-unit { display: flex; flex-direction: column; gap: 0; }
.stat-label { font-size: 8px; font-weight: 800; color: var(--text-light); opacity: 0.7; }
.stat-value { font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 800; color: var(--text); }

/* Distilled History Premium */
.history-premium { width: 100%; }
.history-list-premium { background: white; border-radius: 20px; border: 1px solid var(--border); overflow: hidden; }

.h-thead { 
  display: grid; 
  grid-template-columns: 1fr 2.5fr 1fr 1fr 1.5fr; 
  padding: 16px 24px; 
  background: var(--sidebar); 
  border-bottom: 1px solid var(--border); 
  font-family: 'JetBrains Mono', monospace; 
  font-size: 13px; 
  font-weight: 800; 
  color: var(--text); 
  letter-spacing: 0.02em; 
}
.h-row { display: grid; grid-template-columns: 1fr 2.5fr 1fr 1fr 1.5fr; padding: 14px 24px; border-bottom: 1px solid var(--bg); align-items: center; transition: 0.2s; }
.h-row:last-child { border-bottom: none; }
.h-row:hover { background: var(--bg); }

.col-time { font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 600; color: var(--text-light); }
.col-model { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 13px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 12px; }

.h-status-tag { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 900; padding: 2px 8px; border-radius: 6px; letter-spacing: 0.02em; }
.h-status-tag.success { background: oklch(95% 0.05 145); color: oklch(50% 0.15 145); }
.h-status-tag.error { background: oklch(95% 0.05 25); color: oklch(50% 0.15 25); }

.col-latency { font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 600; color: var(--text); }

.col-io { display: flex; align-items: center; gap: 8px; font-family: 'JetBrains Mono', monospace; font-size: 13px; }
.io-val { color: var(--text); font-weight: 700; }
.io-arr { color: var(--border); font-weight: 400; }

/* Pagination Premium */
.pagination-premium { margin-top: 24px; display: flex; align-items: center; justify-content: center; gap: 20px; }
.page-numbers { display: flex; gap: 8px; }
.page-num { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 8px; font-size: 12px; font-weight: 800; color: var(--text-light); cursor: pointer; transition: 0.2s; border: 1px solid transparent; }
.page-num:hover { background: var(--bg); color: var(--text); }
.page-num.active { background: var(--primary); color: white; box-shadow: 0 4px 12px var(--primary-light); }

.page-nav { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 8px; border: 1px solid var(--border); background: white; color: var(--text-light); cursor: pointer; transition: 0.2s; }
.page-nav:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }
.page-nav:disabled { opacity: 0.3; cursor: not-allowed; }

.page-indicator-distilled { font-size: 12px; font-weight: 500; color: var(--text-light); margin-left: 8px; opacity: 0.6; }

.m-card-footer { margin-top: 0; padding-top: 2px; }
.last-seen { font-size: 8px; font-weight: 850; color: var(--text-light); opacity: 0.9; letter-spacing: 0.05em; text-transform: uppercase; }

/* Distilled Metrics Bar */
.metrics-bar { display: flex; align-items: center; justify-content: space-between; background: white; padding: 30px 40px; border-radius: 24px; border: 1px solid var(--border); box-shadow: 0 4px 20px rgba(0,0,0,0.02); margin-bottom: 20px; }
.metric-item { display: flex; flex-direction: column; gap: 6px; }
.metric-divider { width: 1px; height: 40px; background: var(--border); }
.m-label { font-family: 'Outfit', 'Inter', 'JetBrains Mono', monospace; font-size: 11px; font-weight: 850; color: var(--text); text-transform: uppercase; letter-spacing: 0.1em; }
.m-value { font-family: 'JetBrains Mono', monospace; font-size: 32px; font-weight: 800; color: var(--text); line-height: 1; }
.m-value.highlight { color: var(--primary); }

.mt-8 { margin-top: 8px; }
.mt-20 { margin-top: 20px; }
.text-success { color: var(--success); font-weight: 600; }
.text-warning { color: var(--warning); font-weight: 600; }
.text-danger { color: var(--danger); font-weight: 600; }
.text-indigo { color: #6366f1; font-weight: 600; }
.text-light { color: var(--text-light); }
.font-bold { font-weight: 700; }
.font-medium { font-weight: 500; }
.font-mono { font-family: 'JetBrains Mono', monospace; font-size: 12px; }
.markdown-body { font-size: 15px; line-height: 1.6; color: inherit; }
/* Distilled Settings Premium */
.settings-premium { width: 100%; }
.settings-sections { display: flex; flex-direction: column; gap: 40px; }
.settings-group { background: white; border-radius: 24px; border: 1px solid var(--border); overflow: hidden; }
.group-header { padding: 24px 30px; border-bottom: 1px solid var(--border); background: var(--sidebar); }
.group-header h3 { font-size: 16px; margin-bottom: 4px; }
.group-header p { font-size: 12px; color: var(--text-light); }

.settings-list { padding: 10px 0; }
.settings-row { display: flex; align-items: center; justify-content: space-between; padding: 20px 30px; border-bottom: 1px solid var(--bg); transition: 0.2s; }
.settings-row:last-child { border-bottom: none; }
.settings-row:hover { background: var(--bg); }

.s-info { display: flex; flex-direction: column; gap: 4px; }
.s-info label { font-size: 14px; font-weight: 700; color: var(--text); }
.s-info .s-desc { font-size: 11px; color: var(--text-light); font-weight: 500; }

.s-action { width: 450px; }
.s-action input { width: 100%; padding: 12px 16px; border: 1px solid var(--border); border-radius: 10px; font-family: 'JetBrains Mono', monospace; font-size: 13px; transition: 0.3s; background: var(--sidebar); }
.s-action input:focus { outline: none; border-color: var(--primary); background: white; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }

.settings-footer-premium { display: flex; justify-content: flex-end; }
.btn-save-premium { padding: 14px 40px; background: var(--primary); color: white; border: none; border-radius: 12px; font-weight: 800; cursor: pointer; transition: 0.3s; display: flex; align-items: center; gap: 8px; font-size: 14px; }
.btn-save-premium:hover { transform: translateY(-2px); box-shadow: 0 8px 24px var(--primary-light); }

/* Artifact Preview Styles */
.code-block-wrapper { position: relative; }
.btn-preview-html {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 6px 12px;
  background: oklch(30% 0.1 260);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
  z-index: 10;
  transition: 0.2s;
  border: 1px solid rgba(255,255,255,0.1);
}
.btn-preview-html:hover { background: var(--primary); transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.2); }

.artifact-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  backdrop-filter: blur(4px);
  z-index: 9999;
  display: flex;
  justify-content: flex-end;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

.artifact-panel {
  width: 50%;
  height: 100%;
  background: white;
  box-shadow: -10px 0 30px rgba(0,0,0,0.1);
  display: flex;
  flex-direction: column;
  animation: slideLeft 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes slideLeft { from { transform: translateX(100%); } to { transform: translateX(0); } }

.artifact-header {
  padding: 16px 24px;
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--sidebar);
}

.artifact-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 850;
  font-size: 15px;
  color: var(--text);
}

.artifact-icon { font-size: 18px; }

.btn-close-artifact {
  padding: 6px 16px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: white;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: 0.2s;
}
.btn-close-artifact:hover { background: #fef2f2; color: #dc2626; border-color: #fecaca; }

.artifact-body { flex: 1; background: #f8fafc; overflow: hidden; }
.artifact-body iframe { width: 100%; height: 100%; background: white; }

.markdown-body-premium pre { margin: 12px 0; border-radius: 12px; overflow: hidden; }

/* Responsive Adjustments */
@media (max-width: 1200px) {
  .sessions-sidebar { width: 220px; }
  .chat-input-wrapper { padding: 15px 20px 20px; }
  .chat-messages-premium { padding: 20px; }
}

@media (max-width: 1024px) {
  .sidebar { width: 80px; padding: 20px 10px; }
  .logo span:last-child, .nav-item span:not(.nav-icon), .connection-status, .btn-sync, .btn-lang { display: none; }
  .logo { justify-content: center; margin-bottom: 20px; }
  .nav-item { justify-content: center; padding: 12px; }
  .sidebar-footer { border: none; }
  .nav-icon { width: 24px; height: 24px; }
  
  .tab-pane { padding: 15px; }
  .chat-workspace { height: calc(100vh - 30px); }
}

@media (max-width: 768px) {
  .sessions-sidebar { width: 180px; }
  .chat-header h2 { font-size: 15px; }
  .provider-selector { display: none; }
  .msg-bubble-premium { max-width: 95%; }
}

@media (max-width: 640px) {
  .sessions-sidebar { display: none; }
  .app-container { flex-direction: column; }
  .sidebar { width: 100%; height: 60px; flex-direction: row; padding: 0 15px; }
  .logo { margin-bottom: 0; }
  nav { display: flex; flex-direction: row; margin: 0; }
  .nav-item { margin-bottom: 0; }
  .sidebar-footer { display: none; }
  .chat-workspace { border-radius: 0; border: none; }
}

/* Fix for flex overflow */
.chat-main { min-width: 0; }
.chat-input-area { width: 100%; }
</style>
