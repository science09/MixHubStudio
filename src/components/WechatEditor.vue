<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import {
  adaptWechatBullets,
  adaptWechatFootnotes,
  adaptWechatTables,
  adaptWechatCodeBlocks,
  adaptWechatBlockquotes,
  adaptWechatLinks,
  propagateWechatStyles,
  cleanWechatHtml,
  getCodeThemeId
} from '../utils/wechatHtmlAdapter'
import SidebarExplorer from './wechat-editor/SidebarExplorer.vue'
import AiPanel from './wechat-editor/AiPanel.vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { diffWords } from 'diff'
import { createWenyanCore } from '@wenyan-md/core'
import { resolveThemeCss, themesList } from '../utils/wechatThemeResolver'
import { translations } from '../utils/wechatTranslations'
import { useWechatArticles } from '../composables/useWechatArticles'
import {
  publishToWechatDraft as publishToWechatDraftHelper,
  copyPlatform as copyPlatformHelper,
  parseFrontmatter
} from '../utils/wechatPublishService'

// i18n helper
const currentLang = ref('zh')

const t = (key) => {
  const lang = window.__MIXHUB_LANG__ || 'zh'
  return translations[lang]?.[key] || translations['zh'][key] || key
}

// UI State
const searchQuery = ref('')
const syncScroll = ref(true)
const isAddFootnote = ref(localStorage.getItem('wechat_add_footnote') !== 'false')
const showSplitView = ref(true)
const showMobilePreview = ref(false)
const showAiPanel = ref(false)
const customInstruction = ref('')
const aiOutput = ref('')
const isGenerating = ref(false)
const isCancelled = ref(false)
const isSelectionActive = ref(false)
const selectedTextLength = ref(0)
const lastRenderedWechatHtml = ref('')

const isReviewingAi = ref(false)
const diffContentOld = ref('')
const diffContentNew = ref('')

// AI Chat History State
const chatHistory = ref([])
let activeGeneratingMsg = null
let activeGeneratingSessionId = null
let activeGeneratingChatHistory = null

const clearChatHistory = () => {
  chatHistory.value = []
}

// AI Session Management State
const aiSessions = ref([])
const activeSessionId = ref(null)

const currentSession = computed(() => {
  return aiSessions.value.find(s => s.id === activeSessionId.value) || null
})

// Initialize database folders/articles hook
const {
  articles,
  folders,
  expandedFolders,
  articleForm,
  activeArticleId,
  activeFolderId,
  editingFolderId,
  editingFolderName,
  folderRenameInput,
  saveStatus,
  pathsInfo,
  showDeleteConfirm,
  deleteType,
  deleteTargetName,
  selectedTheme,
  visibleTreeItems,
  dragOverFolderId,
  loadArticles,
  selectArticle,
  createNewArticle,
  saveActiveArticle,
  triggerAutosave,
  loadFolders,
  createNewFolder,
  loadPathsInfo,
  resolveLocalPath,
  resolveImagePath,
  openFolderInExplorer,
  triggerDeleteFolder,
  triggerDeleteArticle,
  openDbFolder,
  openWorkspaceFolder,
  confirmDelete,
  deleteFolder,
  startRenameFolder,
  finishRenameFolder,
  cancelRenameFolder,
  createArticleInFolder,
  toggleFolder,
  downloadMarkdown,
  handleDragStart,
  handleDragEnd,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  handleDropToRoot,
  getPublishStatus
} = useWechatArticles({
  t,
  isReviewingAi,
  updatePreviews: () => updatePreviews()
})

// Image copying and folder opening actions
const showCopyNotice = ref(false)
const copyNoticeText = ref('')

const copyRelativePath = async (path) => {
  try {
    await navigator.clipboard.writeText(path)
    copyNoticeText.value = '已复制相对路径！'
    showCopyNotice.value = true
    setTimeout(() => {
      showCopyNotice.value = false
    }, 2000)
  } catch (err) {
    console.error('Failed to copy relative path: ', err)
  }
}

const copyMarkdownRef = async (path) => {
  const filename = path.substring(path.lastIndexOf('/') + 1)
  const markdownRef = `![${filename}](${path})`
  try {
    await navigator.clipboard.writeText(markdownRef)
    copyNoticeText.value = '已复制 Markdown 引用！'
    showCopyNotice.value = true
    setTimeout(() => {
      showCopyNotice.value = false
    }, 2000)
  } catch (err) {
    console.error('Failed to copy Markdown reference: ', err)
  }
}

const openImageFolder = (imageRelativePath) => {
  if (!pathsInfo.value || !pathsInfo.value.workspace_path) return
  const syncDir = `${pathsInfo.value.workspace_path}/公众号文章`
  const absoluteFilePath = `${syncDir}/${imageRelativePath}`
  const lastSlashIndex = absoluteFilePath.replace(/\\/g, '/').lastIndexOf('/')
  const parentFolder = lastSlashIndex !== -1 ? absoluteFilePath.substring(0, lastSlashIndex) : syncDir
  invoke('open_path', { path: parentFolder })
}

// Load all AI Assistant sessions (migrating legacy per-article histories if any)
const loadAiSessions = () => {
  try {
    const stored = localStorage.getItem('oneink-ai-sessions')
    if (stored) {
      aiSessions.value = JSON.parse(stored)
    } else {
      // Migrate legacy per-article chat history
      const legacySessions = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && key.startsWith('oneink-chat-history-')) {
          const articleId = key.substring('oneink-chat-history-'.length)
          const art = articles.value.find(a => a.id === articleId)
          const title = art ? `历史: ${art.title}` : `历史会话 (${articleId.substring(0, 5)})`
          const historyStr = localStorage.getItem(key)
          if (historyStr && historyStr !== '[]') {
            const id = 'session_migrated_' + articleId
            legacySessions.push({
              id,
              title,
              created_at: Date.now() - legacySessions.length * 1000
            })
            localStorage.setItem(`oneink-ai-session-messages-${id}`, historyStr)
          }
        }
      }
      
      if (legacySessions.length > 0) {
        legacySessions.sort((a, b) => b.created_at - a.created_at)
        aiSessions.value = legacySessions
        // Clean up legacy keys
        legacySessions.forEach(ls => {
          const originalArticleId = ls.id.substring('session_migrated_'.length)
          localStorage.removeItem(`oneink-chat-history-${originalArticleId}`)
        })
      } else {
        aiSessions.value = []
      }
    }
    
    const storedActiveId = localStorage.getItem('oneink-active-session-id')
    if (storedActiveId && aiSessions.value.some(s => s.id === storedActiveId)) {
      activeSessionId.value = storedActiveId
    } else if (aiSessions.value.length > 0) {
      activeSessionId.value = aiSessions.value[0].id
    } else {
      createNewAiSession('默认会话')
    }
    
    loadSessionChatHistory(activeSessionId.value)
  } catch (e) {
    console.error('Failed to load AI sessions:', e)
    aiSessions.value = []
    createNewAiSession('默认会话')
  }
}

// Save AI Assistant sessions metadata
const saveAiSessions = () => {
  localStorage.setItem('oneink-ai-sessions', JSON.stringify(aiSessions.value))
  if (activeSessionId.value) {
    localStorage.setItem('oneink-active-session-id', activeSessionId.value)
  } else {
    localStorage.removeItem('oneink-active-session-id')
  }
}

// Create a new session
const createNewAiSession = (title = '') => {
  const id = 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9)
  const newSession = {
    id,
    title: title || `会话 ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
    created_at: Date.now()
  }
  aiSessions.value.unshift(newSession)
  saveAiSessions()
  selectSession(id)
}

// Select a session
const selectSession = (id) => {
  activeSessionId.value = id
  saveAiSessions()
  loadSessionChatHistory(id)
  showSessionDropdown.value = false
}

// Toggle session dropdown menu visibility


// Close session dropdown when clicking outside


// Delete a session
const deleteSession = (id) => {
  if (aiSessions.value.length <= 1) {
    alert('必须保留至少一个会话')
    return
  }
  if (confirm('确定要删除该会话及其所有聊天记录吗？')) {
    aiSessions.value = aiSessions.value.filter(s => s.id !== id)
    localStorage.removeItem(`oneink-ai-session-messages-${id}`)
    saveAiSessions()
    if (activeSessionId.value === id) {
      activeSessionId.value = aiSessions.value[0].id
      saveAiSessions()
      loadSessionChatHistory(activeSessionId.value)
    }
  }
}

// Rename session




// Load chat history for a session
const loadSessionChatHistory = (sessionId) => {
  if (sessionId) {
    try {
      const stored = localStorage.getItem(`oneink-ai-session-messages-${sessionId}`)
      const history = JSON.parse(stored || '[]')
      chatHistory.value = history.map(msg => {
        if (msg.isGenerating) {
          return { ...msg, isGenerating: false }
        }
        return msg
      })
    } catch (e) {
      console.error('Failed to load session chat history:', e)
      chatHistory.value = []
    }
  } else {
    chatHistory.value = []
  }
}

// Save current chat history to current session
const saveSessionChatHistory = () => {
  if (activeSessionId.value) {
    const cleanHistory = chatHistory.value.map(msg => {
      const { agentLogs, ...rest } = msg
      return rest
    })
    localStorage.setItem(`oneink-ai-session-messages-${activeSessionId.value}`, JSON.stringify(cleanHistory))
  }
}

watch(chatHistory, () => {
  saveSessionChatHistory()
}, { deep: true })









// Dom refs for scroll syncing and previews
const textareaRef = ref(null)
const lineNumbersRef = ref(null)
const previewRef = ref(null)
const mobilePreviewRef = ref(null)
const aiPanelRef = ref(null)
const aiChatMessagesRef = ref(null)

// AI Assistant Mentions State
const aiInputRef = ref(null)

watch(isAddFootnote, (val) => {
  localStorage.setItem('wechat_add_footnote', String(val))
})



// Scroll synchronization logic
const handleEditorScroll = (e) => {
  if (!syncScroll.value) return
  const textarea = e.target
  
  // Sync line numbers scroll
  if (lineNumbersRef.value) {
    lineNumbersRef.value.scrollTop = textarea.scrollTop
  }
  
  const percentage = textarea.scrollTop / (textarea.scrollHeight - textarea.clientHeight)
  
  if (showSplitView.value && previewRef.value) {
    previewRef.value.scrollTop = percentage * (previewRef.value.scrollHeight - previewRef.value.clientHeight)
  }
  
  if (showMobilePreview.value && mobilePreviewRef.value) {
    mobilePreviewRef.value.scrollTop = percentage * (mobilePreviewRef.value.scrollHeight - mobilePreviewRef.value.clientHeight)
  }
}

// parseFrontmatter and downloadUrl have been extracted to wechatPublishService

// Compute line numbers
const lineNumbers = computed(() => {
  const lines = articleForm.value.content.split('\n')
  return Array.from({ length: lines.length }, (_, i) => i + 1)
})

// Counts
const wordCount = computed(() => articleForm.value.content.length)
const lineCount = computed(() => articleForm.value.content.split('\n').length)

const activePublishMeta = computed(() => {
  if (!articleForm.value || !articleForm.value.content) return null
  return getPublishStatus(articleForm.value.content)
})

// Filtered articles list
const filteredArticles = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return articles.value
  return articles.value.filter(a => 
    (a.title || '').toLowerCase().includes(q) || 
    (a.content || '').toLowerCase().includes(q)
  )
})



const currentThemeName = computed(() => {
  const found = themesList.find(t => t.id === selectedTheme.value)
  return found ? found.name : selectedTheme.value
})


// WebKit/Safari requires selecting text inside a form control like textarea to allow execCommand('copy')
const copyWithEvent = (htmlContent, plainText = null) => {
  const tempElement = document.createElement('textarea')
  tempElement.value = 'temp'
  tempElement.setAttribute('style', 'position: fixed; top: 0; left: 0; width: 10px; height: 10px; opacity: 0.01; overflow: hidden; z-index: 99999;')
  document.body.appendChild(tempElement)

  const activeEl = document.activeElement
  tempElement.focus()
  tempElement.select()
  tempElement.setSelectionRange(0, 4)

  const listener = (e) => {
    e.clipboardData.setData('text/html', htmlContent)
    e.clipboardData.setData('text/plain', plainText || articleForm.value.content)
    e.preventDefault()
  }
  document.addEventListener('copy', listener)
  const success = document.execCommand('copy')
  document.removeEventListener('copy', listener)
  
  document.body.removeChild(tempElement)
  if (activeEl && activeEl.focus) {
    activeEl.focus()
  }
  return success
}

// WeChat Formatted copy utility wrapped call to service helper
const copyPlatform = async (platform) => {
  await copyPlatformHelper(platform, {
    content: articleForm.value.content,
    title: articleForm.value.title,
    selectedTheme: selectedTheme.value,
    isAddFootnote: isAddFootnote.value,
    wenyanCore: wenyan.value,
    wechatSettings: wechatSettings.value,
    t,
    resolveLocalPath,
    onProgressStart: (msg) => {
      isCopying.value = true
      copyingStatus.value = msg
    },
    onProgressUpdate: (msg) => {
      copyingStatus.value = msg
    },
    onProgressEnd: () => {
      isCopying.value = false
    },
    alert: (msg) => alert(msg),
    copyWithEvent,
    lastRenderedWechatHtml: lastRenderedWechatHtml.value
  })
}



const escapeRegExp = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const parseStreamContent = (fullText) => {
  let explanation = ''
  let modifiedText = ''
  let hasModifiedTag = false
  
  const tagStart = '<modified_text>'
  const tagEnd = '</modified_text>'
  
  const startIndex = fullText.indexOf(tagStart)
  if (startIndex !== -1) {
    hasModifiedTag = true
    explanation = fullText.substring(0, startIndex)
    
    const endIndex = fullText.indexOf(tagEnd, startIndex + tagStart.length)
    if (endIndex !== -1) {
      modifiedText = fullText.substring(startIndex + tagStart.length, endIndex)
      explanation += fullText.substring(endIndex + tagEnd.length)
    } else {
      modifiedText = fullText.substring(startIndex + tagStart.length)
    }
  } else {
    explanation = fullText
  }
  
  return { explanation, modifiedText, hasModifiedTag }
}

const parseIncrementalThoughts = (text) => {
  const firstCallIndex = text.indexOf('<call:')
  if (firstCallIndex !== -1) {
    return text.substring(0, firstCallIndex).trim()
  }
  return text.trim()
}

const parseToolCalls = (text) => {
  const toolCalls = []
  
  // Extract all <call:search_and_replace> blocks
  const sarRegex = /<call:search_and_replace>([\s\S]*?)<\/call:search_and_replace>/gi
  let match
  while ((match = sarRegex.exec(text)) !== null) {
    const inner = match[1]
    const targetMatch = /<target>([\s\S]*?)<\/target>/i.exec(inner)
    const replacementMatch = /<replacement>([\s\S]*?)<\/replacement>/i.exec(inner)
    
    if (targetMatch && replacementMatch) {
      let target = targetMatch[1]
      let replacement = replacementMatch[1]
      
      // Strip exactly one leading and/or trailing newline if they exist
      if (target.startsWith('\n')) target = target.substring(1)
      if (target.endsWith('\n')) target = target.substring(0, target.length - 1)
      if (replacement.startsWith('\n')) replacement = replacement.substring(1)
      if (replacement.endsWith('\n')) replacement = replacement.substring(0, replacement.length - 1)
      
      toolCalls.push({
        type: 'search_and_replace',
        target,
        replacement
      })
    }
  }

  // Extract <call:finish_task> blocks
  const finishRegex = /<call:finish_task>([\s\S]*?)<\/call:finish_task>/i.exec(text)
  if (finishRegex) {
    const inner = finishRegex[1]
    const summaryMatch = /<summary>([\s\S]*?)<\/summary>/i.exec(inner)
    let summary = summaryMatch ? summaryMatch[1] : inner
    
    if (summary.startsWith('\n')) summary = summary.substring(1)
    if (summary.endsWith('\n')) summary = summary.substring(0, summary.length - 1)
    
    toolCalls.push({
      type: 'finish_task',
      summary: summary.trim()
    })
  }

  return toolCalls
}

// AI Assistant actions
const handleAiAction = async (payload) => {
  const actionType = typeof payload === 'string' ? payload : (payload?.type || 'custom')
  const instruction = typeof payload === 'object' ? (payload.instruction || '') : ''
  const imgPaths = typeof payload === 'object' ? (payload.images || []) : []
  const userImages = typeof payload === 'object' ? (payload.previewUrls || []) : []

  const textarea = textareaRef.value
  if (isGenerating.value) return
  if (!textarea) return
  
  // Early return check for custom actions to prevent getting stuck in thinking state
  if (actionType === 'custom' && !instruction.trim() && imgPaths.length === 0) {
    return
  }
  
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const selectedText = textarea.value.substring(start, end)
  
  let textToProcess = selectedText
  if (!textToProcess.trim()) {
    textToProcess = articleForm.value.content
  }

  aiOutput.value = ''
  isCancelled.value = false
  isGenerating.value = true

  let prompt = ''
  let userMessageContent = ''

  if (actionType === 'polish') {
    prompt = `对当前文档内容进行润色，优化措辞和排版，使其更通顺、专业，适合在公众号上阅读，并保留原本的 Markdown 格式不变。`
    userMessageContent = '📝 ' + t('ai_polish') + '：' + (selectedText.trim() ? `"${selectedText.substring(0, 30)}..."` : '整篇文档')
  } else if (actionType === 'continue') {
    prompt = `根据当前文档内容进行合理续写，保持语气和风格一致，并使用 Markdown 格式。`
    userMessageContent = '✍️ ' + t('ai_continue') + '：' + (selectedText.trim() ? `"${selectedText.substring(0, 30)}..."` : '整篇文档')
  } else if (actionType === 'title') {
    prompt = `根据当前文档内容，生成 5 个吸引人、适合微信公众号传播的爆款标题。`
    userMessageContent = '🔥 ' + t('ai_titles') + '：' + (selectedText.trim() ? `"${selectedText.substring(0, 30)}..."` : '整篇文档')
  } else if (actionType === 'summary') {
    prompt = `对当前文档内容进行提炼总结，用简短的几个要点列出核心观点。`
    userMessageContent = '📖 ' + t('ai_summary') + '：' + (selectedText.trim() ? `"${selectedText.substring(0, 30)}..."` : '整篇文档')
  } else if (actionType === 'grammar') {
    prompt = `检查当前文档内容中的错别字和语法错误，并改正之，保留原本的 Markdown 格式。`
    userMessageContent = '🔍 ' + t('ai_grammar') + '：' + (selectedText.trim() ? `"${selectedText.substring(0, 30)}..."` : '整篇文档')
  } else if (actionType === 'custom') {
    userMessageContent = instruction
    
    let referencedContext = ''
    const instructionText = instruction
    const matchedArticles = []
    
    for (const art of articles.value) {
      if (art.title) {
        const escapedTitle = escapeRegExp(art.title)
        const regex = new RegExp(`@${escapedTitle}(?=\\s|[.,!?;:，。！？；：]|$)`, 'g')
        if (regex.test(instructionText)) {
          matchedArticles.push(art)
        }
      }
    }
    
    if (matchedArticles.length > 0) {
      referencedContext = '\n\n关联的文档上下文如下：'
      for (const art of matchedArticles) {
        referencedContext += `\n\n--- 文档名: "${art.title}" ---\n${art.content}`
      }
    }

    let promptText = instructionText
    for (const art of matchedArticles) {
      if (art.title) {
        const escapedTitle = escapeRegExp(art.title)
        const regex = new RegExp(`@${escapedTitle}(?=\\s|[.,!?;:，。！？；：]|$)`, 'g')
        promptText = promptText.replace(regex, `"${art.title}"`)
      }
    }
    
    prompt = `${promptText}${referencedContext}`
    
    customInstruction.value = ''
  }

  // Capture the target article details for background run
  const targetArticleId = activeArticleId.value
  const targetChatHistory = chatHistory.value

  // Push user message
  targetChatHistory.push({
    role: 'user',
    content: userMessageContent || (userImages.length > 0 ? '[发送了图片]' : ''),
    images: userImages
  })

  // Push assistant message placeholder
  const assistantMsg = {
    role: 'assistant',
    content: '',
    isGenerating: true,
    model: '',
    steps: [],
    agentLogs: []
  }
  targetChatHistory.push(assistantMsg)
  
  // Set global trackers
  activeGeneratingMsg = assistantMsg
  activeGeneratingSessionId = activeSessionId.value
  activeGeneratingChatHistory = targetChatHistory

  const scrollToBottom = () => {
    nextTick(() => {
      if (aiChatMessagesRef.value) {
        if (aiPanelRef.value) {
          aiPanelRef.value.scrollToBottom()
        }
      }
    })
  }

  scrollToBottom()

  try {
    // 调用 Rust 后端，在临时文件上运行 Pi 智能体修改
    const result = await invoke('run_pi_agent', {
      sessionId: activeSessionId.value,
      prompt,
      content: textToProcess,
      imagePaths: imgPaths
    })
    
    if (isCancelled.value) {
      assistantMsg.content = '已主动停止智能体执行。'
      assistantMsg.steps.push({
        type: 'error',
        message: '用户主动中止'
      })
      return
    }
    
    if (result.success) {
      const finalContent = result.modified_content
      const currentFullContent = activeArticleId.value === targetArticleId 
        ? articleForm.value.content 
        : (articles.value.find(a => a.id === targetArticleId)?.content || '')
      
      const finalFullContent = selectedText.trim() 
        ? currentFullContent.substring(0, start) + finalContent + currentFullContent.substring(end)
        : finalContent

      if (currentFullContent !== finalFullContent) {
        if (activeArticleId.value === targetArticleId) {
          articleForm.value.content = finalFullContent
          nextTick(() => {
            updatePreviews()
            saveActiveArticle()
          })
        } else {
          // background article is not active, save directly to database/syncdir
          const artMetadata = articles.value.find(a => a.id === targetArticleId)
          if (artMetadata) {
            await invoke('save_article', {
              payload: {
                id: targetArticleId,
                title: artMetadata.title || 'Untitled',
                content: finalFullContent,
                theme: (artMetadata.theme === 'default' || !artMetadata.theme) ? 'fresh-green' : artMetadata.theme,
                folder_id: artMetadata.folder_id || null
              }
            })
            // Reload articles list
            const getRes = await invoke('get_articles')
            articles.value = getRes || []
          }
        }
        
        assistantMsg.diffInfo = {
          oldText: currentFullContent,
          newText: finalFullContent,
          showDiff: false,
          restored: false,
          articleId: targetArticleId
        }
      }

      // 从 JSON 格式 of stdout 中重新提取最终的模型输出正文
      let cleanOutput = ''
      const stdoutLines = result.stdout.split('\n')
      for (const rawLine of stdoutLines) {
        const cleanRawLine = rawLine.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '').trim()
        if (!cleanRawLine) continue
        try {
          const parsed = JSON.parse(cleanRawLine)
          if (parsed.type === 'message_update' && parsed.assistantMessageEvent?.type === 'text_delta') {
            cleanOutput += parsed.assistantMessageEvent.delta
          }
        } catch {
          if (!cleanRawLine.startsWith('{')) {
            cleanOutput += (cleanOutput ? '\n' : '') + cleanRawLine
          }
        }
      }
      
      if (!cleanOutput.trim()) {
        cleanOutput = assistantMsg.content || '修改完成。'
      }
      assistantMsg.content = cleanOutput

      // 如果有智能体新创建的文件，自动导入并选中
      if (result.new_articles && result.new_articles.length > 0) {
        await loadFolders()
        await loadArticles()
        
        const newArt = result.new_articles[0]
        selectArticle(newArt.id)
        
        assistantMsg.steps.push({
          type: 'success',
          message: `自动检测并导入新文档: ${newArt.title}`
        })
      }
    } else {
      if (isCancelled.value) {
        assistantMsg.content = '已主动停止智能体执行。'
        assistantMsg.steps.push({
          type: 'error',
          message: '用户主动中止'
        })
      } else {
        const cleanErr = result.stderr ? result.stderr.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '').trim() : '未知错误'
        assistantMsg.content = `修改失败。错误详情:\n\n${cleanErr}`
      }
    }
  } catch (err) {
    console.error('Pi Agent error:', err)
    if (isCancelled.value) {
      assistantMsg.content = '已主动停止智能体执行。'
      assistantMsg.steps.push({
        type: 'error',
        message: '用户主动中止'
      })
    } else {
      assistantMsg.content = `运行 Pi 智能体失败: ${err.message || err}`
      assistantMsg.steps.push({
        type: 'error',
        message: '调用异常'
      })
    }
  } finally {
    assistantMsg.isGenerating = false
    activeGeneratingMsg = null
    activeGeneratingSessionId = null
    activeGeneratingChatHistory = null
    isGenerating.value = false
    saveSessionChatHistory()
  }
}

const stopAiGeneration = async () => {
  isCancelled.value = true
  try {
    await invoke('stop_pi_agent')
  } catch (err) {
    console.error('Failed to stop AI generation:', err)
  }
}

const getDiffParts = (oldText, newText) => {
  return diffWords(oldText || '', newText || '')
}

const generateDiffMarkdown = (oldText, newText) => {
  const parts = diffWords(oldText || '', newText || '')
  let markdown = ''
  for (const part of parts) {
    if (part.removed) {
      markdown += `<del class="editor-diff-removed">${part.value}</del>`
    } else if (part.added) {
      markdown += `<ins class="editor-diff-added">${part.value}</ins>`
    } else {
      markdown += part.value
    }
  }
  return markdown
}

const cleanCodeBlocksDiff = (markdown) => {
  const lines = markdown.split('\n')
  let inCodeBlock = false
  const result = []
  
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock
      result.push(line)
    } else if (inCodeBlock) {
      let cleanLine = line
        .replace(/<del[^>]*>([\s\S]*?)<\/del>/gi, '')
        .replace(/<ins[^>]*>([\s\S]*?)<\/ins>/gi, '$1')
      result.push(cleanLine)
    } else {
      let cleanLine = line.replace(/`([^`]+)`/g, (match, codeContent) => {
        const cleanCode = codeContent
          .replace(/<del[^>]*>([\s\S]*?)<\/del>/gi, '')
          .replace(/<ins[^>]*>([\s\S]*?)<\/ins>/gi, '$1')
        return `\`${cleanCode}\``
      })
      result.push(cleanLine)
    }
  }
  return result.join('\n')
}

const acceptAiChanges = () => {
  const pendingMsg = chatHistory.value.find(msg => msg.diffInfo && !msg.diffInfo.accepted && !msg.diffInfo.discarded)
  if (pendingMsg) {
    pendingMsg.diffInfo.accepted = true
  }
  articleForm.value.content = diffContentNew.value
  isReviewingAi.value = false
  nextTick(() => {
    updatePreviews()
    saveActiveArticle()
  })
}

const discardAiChanges = () => {
  const pendingMsg = chatHistory.value.find(msg => msg.diffInfo && !msg.diffInfo.accepted && !msg.diffInfo.discarded)
  if (pendingMsg) {
    pendingMsg.diffInfo.discarded = true
  }
  isReviewingAi.value = false
  nextTick(() => {
    updatePreviews()
  })
}

const restoreAiChangesForMsg = (msg) => {
  if (msg && msg.diffInfo) {
    const targetId = msg.diffInfo.articleId || activeArticleId.value
    if (activeArticleId.value === targetId) {
      articleForm.value.content = msg.diffInfo.oldText
      msg.diffInfo.restored = true
      nextTick(() => {
        updatePreviews()
        saveActiveArticle()
      })
    } else {
      const art = articles.value.find(a => a.id === targetId)
      if (art) {
        art.content = msg.diffInfo.oldText
        msg.diffInfo.restored = true
        invoke('save_article', { payload: art }).then(() => {
          invoke('get_articles').then(res => {
            articles.value = res || []
          })
        }).catch(err => {
          console.error('Failed to restore background article changes:', err)
        })
      }
    }
  }
}

const applyAiOutput = (method, text) => {
  const textarea = textareaRef.value
  if (!textarea) return
  
  const textToApply = text !== undefined ? text : aiOutput.value
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const content = articleForm.value.content
  
  if (method === 'replace') {
    articleForm.value.content = content.substring(0, start) + textToApply + content.substring(end)
    nextTick(() => {
      textarea.focus()
      textarea.setSelectionRange(start, start + textToApply.length)
    })
  } else if (method === 'insert') {
    articleForm.value.content = content.substring(0, start) + '\n' + textToApply + '\n' + content.substring(start)
    nextTick(() => {
      textarea.focus()
      textarea.setSelectionRange(start + textToApply.length + 2, start + textToApply.length + 2)
    })
  } else if (method === 'copy') {
    navigator.clipboard.writeText(textToApply)
    alert(t('copied'))
  }
}

const checkSelection = (e) => {
  const textarea = e.target
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  if (start !== end) {
    isSelectionActive.value = true
    selectedTextLength.value = end - start
  } else {
    isSelectionActive.value = false
    selectedTextLength.value = 0
  }
}

// WeChat API Configuration & Publishing settings definition
const wechatSettings = ref({
  WECHAT_APP_ID: '',
  WECHAT_APP_SECRET: ''
})
const isPublishing = ref(false)
const publishingStatus = ref('')
const isCopying = ref(false)
const copyingStatus = ref('')

const loadWechatSettings = async () => {
  try {
    const API_BASE = 'http://127.0.0.1:8001'
    const res = await fetch(`${API_BASE}/api/settings`)
    if (res.ok) {
      const data = await res.json()
      wechatSettings.value.WECHAT_APP_ID = data.WECHAT_APP_ID || ''
      wechatSettings.value.WECHAT_APP_SECRET = data.WECHAT_APP_SECRET || ''
    }
  } catch (err) {
    console.error('Failed to load WeChat settings:', err)
  }
}

const publishToWechatDraft = async () => {
  isPublishing.value = true
  publishingStatus.value = '加载配置中...'
  
  try {
    await loadWechatSettings()
    
    const result = await publishToWechatDraftHelper({
      title: articleForm.value.title,
      content: articleForm.value.content,
      selectedTheme: selectedTheme.value,
      isAddFootnote: isAddFootnote.value,
      wenyanCore: wenyan.value,
      wechatSettings: wechatSettings.value,
      resolveLocalPath,
      onProgress: (msg) => {
        publishingStatus.value = msg
      },
      alert: (msg) => alert(msg)
    })

    if (result && result.media_id) {
      const now = new Date()
      const pad = (n) => String(n).padStart(2, '0')
      const timeStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`

      const { attributes, body } = parseFrontmatter(articleForm.value.content)
      const newAttributes = {
        ...attributes,
        publish_status: 'draft',
        publish_time: timeStr,
        media_id: result.media_id
      }

      let frontmatterStr = '---\n'
      for (const [k, v] of Object.entries(newAttributes)) {
        frontmatterStr += `${k}: ${v}\n`
      }
      frontmatterStr += '---\n'

      articleForm.value.content = frontmatterStr + body
      
      await saveActiveArticle()
      await loadArticles()
    }
  } catch (err) {
    console.error('Publish error:', err)
    alert(`推送失败：${err.message || err}`)
  } finally {
    isPublishing.value = false
  }
}

const wenyan = ref(null)



const resolveLocalPreviewHtml = (html) => {
  if (!html) return ''
  // Replace Github raw/blob assets URLs with local hosted public assets paths for local previewing
  // Supports http/https, raw/blob, any branch name, case-insensitive, and uses relative paths
  let resolved = html
    .replace(/https?:\/\/(?:github\.com\/science09\/MixHubStudio\/(?:raw|blob)|raw\.githubusercontent\.com\/science09\/MixHubStudio)\/[^/]+\/assets\//gi, 'assets/')
  
  // Normalize any absolute /assets/ paths to relative assets/ to prevent root directory resolution issues in WebKit
  resolved = resolved.replace(/(src=["'])\/assets\//gi, '$1assets/')
  
  // Resolve local/relative image paths using resolveLocalPath
  resolved = resolved.replace(/<img\s+([^>]*?)src=["']([^"']+)["']([^>]*?)>/gi, (match, before, src, after) => {
    if (/^(https?|data|asset|tauri-http|tauri):/i.test(src)) {
      return match
    }
    const resolvedSrc = resolveLocalPath(src)
    return `<img ${before}src="${resolvedSrc}"${after}>`
  })
  
  return resolved
}

const updatePreviews = async () => {
  if (!wenyan.value) return
  
  try {
    let mdContent = articleForm.value.content
    if (isReviewingAi.value) {
      const diffMd = generateDiffMarkdown(diffContentOld.value, diffContentNew.value)
      mdContent = cleanCodeBlocksDiff(diffMd)
    }
    const { body } = parseFrontmatter(mdContent)
    const rawHtml = await wenyan.value.renderMarkdown(body)
    const localHtml = resolveLocalPreviewHtml(rawHtml)
    const wrappedHtml = `<div id="wenyan">${localHtml}</div>`
    
    const themeId = selectedTheme.value
    const themeCss = await resolveThemeCss(themeId)
    
    // Perform parsing, style inlining, and WeChat fixes ONCE on a single temporary element
    const tempContainer = document.createElement('div')
    tempContainer.innerHTML = wrappedHtml
    
    await wenyan.value.applyStylesWithTheme(tempContainer, {
      themeCss: themeCss,
      hlThemeId: getCodeThemeId(themeCss),
      isAddFootnote: isAddFootnote.value,
      isMacStyle: true
    })
    
    // Adapt WeChat structural issues in place
    adaptWechatBullets(tempContainer, themeCss)
    adaptWechatFootnotes(tempContainer, themeCss)
    adaptWechatTables(tempContainer)
    adaptWechatCodeBlocks(tempContainer, themeCss)
    adaptWechatBlockquotes(tempContainer)
    propagateWechatStyles(tempContainer)
    
    const finalHtml = tempContainer.innerHTML
    lastRenderedWechatHtml.value = finalHtml
    
    // Efficiently assign styled HTML to the active previews directly
    if (showSplitView.value && previewRef.value) {
      previewRef.value.innerHTML = finalHtml
    }
    
    if (showMobilePreview.value && mobilePreviewRef.value) {
      mobilePreviewRef.value.innerHTML = finalHtml
    }
  } catch (err) {
    console.error('Failed to update previews:', err)
  }
}

let updatePreviewsTimer = null
watch([
  () => articleForm.value.content,
  selectedTheme,
  showSplitView,
  showMobilePreview,
  isAddFootnote
], () => {
  if (updatePreviewsTimer) clearTimeout(updatePreviewsTimer)
  updatePreviewsTimer = setTimeout(() => {
    nextTick(() => {
      updatePreviews()
    })
  }, 300)
})

let handleKeyDown = null
let unlistenPiStream = null

onMounted(async () => {
  
  await loadPathsInfo()
  await loadArticles()
  loadFolders()
  loadWechatSettings()
  loadAiSessions()
  try {
    wenyan.value = await createWenyanCore({
      isConvertMathJax: false,
      isWechat: true
    })
    nextTick(() => {
      updatePreviews()
    })
  } catch (err) {
    console.error('Failed to initialize wenyan-core:', err)
  }

  // Register shortcut for manual save (Cmd+S / Ctrl+S)
  handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      saveActiveArticle()
    }
  }
  window.addEventListener('keydown', handleKeyDown)

  // Listen to Pi stream output
  try {
    unlistenPiStream = await listen('pi-stream-output', (event) => {
      const line = event.payload
      if (!line) return

      // Clean ANSI control characters
      const cleanLine = line.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '').trim()
      if (!cleanLine) return

      // Use component level active generating message reference
      const activeMsg = activeGeneratingMsg
      if (!activeMsg) return

      if (!activeMsg.agentLogs) {
        activeMsg.agentLogs = []
      }
      activeMsg.agentLogs.push(cleanLine)

      if (cleanLine.startsWith('ERR:')) {
        // 来自 stderr 的日志：解析智能体内部步骤 (思维/工具/真实错误)
        const actualLine = cleanLine.substring(4).trim()
        if (!actualLine) return

        let type = ''
        let message = actualLine

        if (actualLine.startsWith('Thinking:')) {
          type = 'thinking'
          message = actualLine.substring(9).trim()
        } else if (actualLine.startsWith('Tool:') || actualLine.includes('Executed tool') || actualLine.includes('Calling tool')) {
          type = 'success'
        } else if (actualLine.toLowerCase().includes('error:') || actualLine.toLowerCase().includes('failed')) {
          type = 'error'
        } else if (actualLine.toLowerCase().includes('success') || actualLine.toLowerCase().includes('completed') || actualLine.toLowerCase().includes('applied')) {
          type = 'success'
        }

        // 只有匹配到有意义的内部步骤时才推入时间轴，避免琐碎/普通的控制台日志污染 UI
        if (type) {
          const lastStep = activeMsg.steps[activeMsg.steps.length - 1]
          if (lastStep && lastStep.type === 'thinking' && type === 'thinking') {
            lastStep.message = message
          } else {
            activeMsg.steps.push({ type, message })
          }
        }
      } else {
        // 尝试解析为 JSON 事件
        let isJson = false
        try {
          const eventObj = JSON.parse(cleanLine)
          isJson = true
          
          if (eventObj.type === 'message_start') {
            activeMsg.content = ''
          } else if (eventObj.type === 'message_update') {
            if (eventObj.assistantMessageEvent) {
              const ev = eventObj.assistantMessageEvent
              if (ev.type === 'text_delta' && ev.delta) {
                activeMsg.content = (activeMsg.content || '') + ev.delta
              } else if (ev.type === 'thinking_delta' && ev.delta) {
                let lastStep = activeMsg.steps[activeMsg.steps.length - 1]
                if (lastStep && lastStep.type === 'thinking' && !lastStep.id) {
                  lastStep.message = (lastStep.message || '') + ev.delta
                } else {
                  activeMsg.steps.push({ type: 'thinking', message: ev.delta })
                }
              }
            }
          } else if (eventObj.type === 'tool_execution_start') {
            // 工具开始执行，添加一个带ID的步骤
            activeMsg.steps.push({
              id: eventObj.toolCallId,
              type: 'thinking',
              message: `正在执行工具 ${eventObj.toolName}...`
            })
          } else if (eventObj.type === 'tool_execution_end') {
            // 工具执行完毕，更新步骤状态
            const toolStep = activeMsg.steps.find(s => s.id === eventObj.toolCallId)
            if (toolStep) {
              if (eventObj.isError) {
                 toolStep.type = 'error'
                 toolStep.message = `执行工具 ${eventObj.toolName} 失败`
              } else {
                 toolStep.type = 'success'
                 if (eventObj.toolName === 'fetch_webpage') {
                   toolStep.message = `成功获取网页内容 (fetch_webpage)`
                 } else if (eventObj.toolName === 'bash') {
                   toolStep.message = `成功执行终端命令 (bash)`
                 } else if (eventObj.toolName === 'write') {
                   toolStep.message = `成功创建并保存新文档 (write)`
                 } else if (eventObj.toolName === 'edit') {
                   toolStep.message = `成功修改文档内容 (edit)`
                 } else {
                   toolStep.message = `成功执行工具 ${eventObj.toolName}`
                 }
              }
            }
          }
        } catch (e) {
          // 如果解析失败，说明是普通的非 JSON 文本行
        }
        
        if (!isJson) {
          // 来自 stdout 的普通日志：为模型输出的回答正文，进行实时流式渲染，不推入步骤时间轴，避免重复显示
          activeMsg.content = activeMsg.content 
            ? activeMsg.content + '\n' + cleanLine 
            : cleanLine
        }
      }

      // Auto-save progress
      if (activeGeneratingSessionId && activeGeneratingChatHistory) {
        const cleanHistory = activeGeneratingChatHistory.map(msg => {
          const { agentLogs, ...rest } = msg
          return rest
        })
        localStorage.setItem(`oneink-ai-session-messages-${activeGeneratingSessionId}`, JSON.stringify(cleanHistory))
      }

      // Scroll to bottom
      nextTick(() => {
        if (aiChatMessagesRef.value) {
          if (aiPanelRef.value) {
        aiPanelRef.value.scrollToBottom()
      }
        }
      })
    })
  } catch (err) {
    console.error('Failed to setup pi-stream-output listener:', err)
  }
})

onUnmounted(() => {
  if (updatePreviewsTimer) {
    clearTimeout(updatePreviewsTimer)
  }
  if (handleKeyDown) {
    window.removeEventListener('keydown', handleKeyDown)
  }
  if (unlistenPiStream) {
    unlistenPiStream()
  }
})
</script>

<template>
  <div class="wechat-workspace-view">
    <!-- Column 1: Articles list -->
    <SidebarExplorer
      v-model:searchQuery="searchQuery"
      v-model:editingFolderName="editingFolderName"
      :visibleTreeItems="visibleTreeItems"
      :filteredArticles="filteredArticles"
      :activeFolderId="activeFolderId"
      :activeArticleId="activeArticleId"
      :editingFolderId="editingFolderId"
      :dragOverFolderId="dragOverFolderId"
      :t="t"
      @create-article="createNewArticle"
      @create-folder="createNewFolder"
      @toggle-folder="toggleFolder"
      @finish-rename-folder="finishRenameFolder"
      @cancel-rename-folder="cancelRenameFolder"
      @start-rename-folder="startRenameFolder"
      @create-article-in-folder="createArticleInFolder"
      @open-folder-in-explorer="openFolderInExplorer"
      @delete-folder="triggerDeleteFolder"
      @select-article="selectArticle"
      @delete-article="triggerDeleteArticle"
      @drag-start="handleDragStart"
      @drag-end="handleDragEnd"
      @drag-over="handleDragOver"
      @drag-leave="handleDragLeave"
      @drop="handleDrop"
      @drop-root="handleDropToRoot"
    />

    <!-- Main Workspace (Editor + Split screen Preview + Mobile phone Mockup) -->
    <main class="editor-main-canvas">
      <!-- Top Actions Bar -->
      <div class="editor-top-actions">
        <div class="top-actions-left">
          <div class="menu-bar">
            <div class="menu-item-group dropdown">
              <span class="menu-title">{{ t('menu_file') }}</span>
              <div class="dropdown-content">
                <a @click="createNewArticle">{{ t('menu_new') }}</a>
                <a @click="saveActiveArticle">{{ t('menu_save') }}</a>
                <a @click="downloadMarkdown">{{ t('menu_export') }}</a>
              </div>
            </div>
            <div class="menu-item-group">
              <span class="menu-title">{{ t('menu_format') }}</span>
            </div>
            <div class="menu-item-group dropdown">
              <span class="menu-title">{{ t('menu_theme') }}</span>
              <div class="dropdown-content">
                <a 
                  v-for="th in themesList" 
                  :key="th.id" 
                  @click="selectedTheme = th.id"
                  :class="{ active: selectedTheme === th.id }"
                >
                  {{ th.name }}
                </a>
              </div>
            </div>
          </div>

          <!-- Autosave Status Indicator -->
          <div class="autosave-status" :class="saveStatus">
            <span class="status-dot"></span>
            <span class="status-text">{{ t('autosave_' + saveStatus) }}</span>
          </div>

          <!-- Publish Status Indicator -->
          <div v-if="activePublishMeta" class="publish-status-pill" :title="'微信 Draft ID: ' + activePublishMeta.mediaId">
            <svg class="wechat-pill-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path>
              <path d="M22 12A10 10 0 0 0 12 2v10z"></path>
            </svg>
            <span>已同步微信草稿 ({{ activePublishMeta.time }})</span>
          </div>
        </div>

        <div class="action-controls">
          <!-- Switches and buttons -->
          <label class="control-item control-sync-scroll">
            <span class="switch-container">
              <input type="checkbox" v-model="syncScroll">
              <span class="switch-slider"></span>
            </span>
            <span class="control-label">{{ t('sync_scroll') }}</span>
          </label>
          <label class="control-item control-footnote">
            <span class="switch-container">
              <input type="checkbox" v-model="isAddFootnote">
              <span class="switch-slider"></span>
            </span>
            <span class="control-label">{{ t('add_footnote') }}</span>
          </label>
          <div class="toolbar-separator"></div>
          <button 
            :class="['btn-toggle-view', { active: showSplitView }]" 
            @click="showSplitView = !showSplitView"
            :title="t('split_view')"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="1.5" width="13" height="12" rx="2" stroke="currentColor" stroke-width="1.4"/>
              <path d="M7.5 1.5V13.5" stroke="currentColor" stroke-width="1.4"/>
              <rect x="8.5" y="2.5" width="4.5" height="10" fill="currentColor" fill-opacity="0.15"/>
            </svg>
          </button>
          <button 
            :class="['btn-toggle-view', { active: showMobilePreview }]" 
            @click="showMobilePreview = !showMobilePreview"
            :title="t('mobile_preview')"
          >
            <svg width="11" height="16" viewBox="0 0 11 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="0.75" width="9" height="14.5" rx="2" stroke="currentColor" stroke-width="1.4"/>
              <circle cx="5.5" cy="12.75" r="0.85" fill="currentColor"/>
              <line x1="3.5" y1="2.75" x2="7.5" y2="2.75" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
            </svg>
          </button>
          <button 
            :class="['btn-toggle-view', 'btn-ai-toggle', { active: showAiPanel }]" 
            @click="showAiPanel = !showAiPanel"
            :title="t('ai_assistant')"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6.5 1.5Q6.5 6 11 6Q6.5 6 6.5 10.5Q6.5 6 2 6Q6.5 6 6.5 1.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" fill="currentColor" fill-opacity="0.15"/>
              <path d="M10.5 8.5Q10.5 10.5 12.5 10.5Q10.5 10.5 10.5 12.5Q10.5 10.5 8.5 10.5Q10.5 10.5 10.5 8.5Z" fill="currentColor"/>
            </svg><span class="btn-text"> AI 助手</span>
          </button>
          <div class="toolbar-separator"></div>
          <div :class="['dropdown', 'copy-dropdown', { loading: isCopying }]">
            <button class="btn-copy-rich-text" :disabled="isCopying">
              <template v-if="isCopying">
                <svg class="spinner-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.3" stroke-dasharray="20 10" stroke-linecap="round"/>
                </svg>
                <span class="btn-text"> {{ copyingStatus || t('copy_btn') }}</span>
              </template>
              <template v-else>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" class="btn-icon">
                  <path d="M9.5 2.5H11C11.5523 2.5 12 2.94772 12 3.5V11.5C12 12.0523 11.5523 12.5 11 12.5H3C2.44772 12.5 2 12.0523 2 11.5V3.5C2 2.94772 2.44772 2.5 3 2.5H4.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
                  <rect x="5" y="1" width="4" height="2.5" rx="0.75" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" fill="currentColor" fill-opacity="0.1"/>
                </svg>
                <span class="btn-text"> {{ t('copy_btn') }}</span>
              </template>
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" xmlns="http://www.w3.org/2000/svg" class="chevron-icon">
                <path d="M1.5 3L4 5.5L6.5 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <div class="dropdown-content copy-dropdown-content">
              <a @click="copyPlatform('wechat')">
                <svg class="dropdown-item-icon color-wechat" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 7.5C12 9.985 9.761 12 7 12C6.104 12 5.263 11.785 4.524 11.4L1.5 12.5L2.376 9.684C1.815 8.973 1.5 8.113 1.5 7.5C1.5 5.015 3.739 3 7 3C10.261 3 12 5.015 12 7.5Z"/>
                </svg>
                <span>微信公众号 (富文本)</span>
              </a>
              <a @click="copyPlatform('zhihu')">
                <svg class="dropdown-item-icon color-zhihu" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M2.5 11.5V2.5C2.5 1.94772 2.94772 1.5 3.5 1.5H10.5C11.0523 1.5 11.5 1.94772 11.5 2.5V11.5M2.5 11.5C2.5 12.0523 2.94772 12.5 3.5 12.5H10.5C11.0523 12.5 11.5 12.0523 11.5 11.5M2.5 11.5H11.5M4.5 4.5H9.5M4.5 7.5H9.5"/>
                </svg>
                <span>知乎/简书 (富文本)</span>
              </a>
              <a @click="copyPlatform('markdown')">
                <svg class="dropdown-item-icon color-markdown" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="1.5" y="2" width="11" height="10" rx="1.5"/>
                  <path d="M4 5V9M4 5L5.5 6.5L7 5V9M10 5V9M9 5H11"/>
                </svg>
                <span>掘金/CSDN (Markdown)</span>
              </a>
              <a @click="copyPlatform('html')">
                <svg class="dropdown-item-icon color-html" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4.5 4L2 7L4.5 10M9.5 4L12 7L9.5 10M8 2.5L6 11.5"/>
                </svg>
                <span>常规 HTML (富文本)</span>
              </a>
            </div>
          </div>
          <button 
            class="btn-publish-wechat" 
            @click="publishToWechatDraft" 
            :disabled="isPublishing"
            :title="t('publish_wechat')"
          >
            <template v-if="isPublishing">
              <svg class="spinner-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.3" stroke-dasharray="20 10" stroke-linecap="round"/>
              </svg>
              <span class="btn-text"> {{ publishingStatus }}</span>
            </template>
            <template v-else>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" class="btn-icon">
                <path d="M12.5 1.5L1.5 6.5L5.5 8.5L7.5 12.5L12.5 1.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
                <path d="M5.5 8.5L12.5 1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
              </svg>
              <span class="btn-text"> 一键推送</span>
            </template>
          </button>
        </div>
      </div>

      <!-- Editor Content Workspace Area -->
      <div class="editor-content-workspace">
        <!-- AI Review Banner -->
        <div v-if="isReviewingAi" class="ai-review-banner">
          <div class="banner-info">
            <span class="banner-icon">✨</span>
            <span class="banner-text">正在预览 AI 智能体修改建议，右侧已高亮对比差异。点击右侧的“接受修改”以应用到左侧编辑器。</span>
          </div>
          <div class="banner-actions">
            <button class="btn-review-accept" @click="acceptAiChanges">接受修改</button>
            <button class="btn-review-discard" @click="discardAiChanges">还原内容</button>
          </div>
        </div>

        <!-- Title Input Strip / Image Title Strip -->
        <div v-if="articleForm.theme === 'image'" class="article-title-strip image-title-strip">
          <span class="image-title-text">{{ articleForm.title }}</span>
          <span class="image-badge">图片文件</span>
        </div>
        <div v-else class="article-title-strip">
          <input v-model="articleForm.title" class="title-input-text" :placeholder="t('wiki_title_placeholder')">
        </div>

        <!-- Layout splitscreen -->
        <div class="layout-flex-workspace">
          <!-- Premium Image Viewer Panel -->
          <div v-if="articleForm.theme === 'image'" class="image-viewer-container">
            <div class="image-viewer-card">
              <div class="image-preview-wrapper">
                <img :src="resolveImagePath(articleForm.id)" class="previewed-image" alt="Image preview" />
              </div>
              <div class="image-info-panel">
                <div class="info-row">
                  <span class="info-label">文件名</span>
                  <span class="info-value font-semibold">{{ articleForm.title }}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">相对路径</span>
                  <span class="info-value font-mono">{{ articleForm.id }}</span>
                </div>
                <div class="info-row">
                  <span class="info-label">绝对路径</span>
                  <span class="info-value font-mono text-xs">{{ pathsInfo.workspace_path }}/公众号文章/{{ articleForm.id }}</span>
                </div>
                <div class="info-actions">
                  <button class="btn-info-action-primary" @click="copyRelativePath(articleForm.id)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="action-icon">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                    复制相对路径
                  </button>
                  <button class="btn-info-action-primary" @click="copyMarkdownRef(articleForm.id)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="action-icon">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <line x1="16" y1="13" x2="8" y2="13"/>
                      <line x1="16" y1="17" x2="8" y2="17"/>
                      <polyline points="10 9 9 9 8 9"/>
                    </svg>
                    复制 Markdown 引用
                  </button>
                  <button class="btn-info-action-secondary" @click="openImageFolder(articleForm.id)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="action-icon">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    </svg>
                    在文件管理器中定位
                  </button>
                </div>
              </div>
            </div>
            <!-- Custom Copy Floating Toast Notice -->
            <transition name="fade">
              <div v-if="showCopyNotice" class="copy-toast-notice">
                <span>{{ copyNoticeText }}</span>
              </div>
            </transition>
          </div>

          <!-- Standard Markdown Editor (else) -->
          <template v-else>
            <!-- Textarea Editor with Line numbers -->
            <div class="text-editor-container">
              <!-- Line Numbers Left Bar -->
              <div ref="lineNumbersRef" class="editor-line-numbers">
                <span v-for="l in lineNumbers" :key="l">{{ l }}</span>
              </div>
              <!-- Editor Textarea -->
              <textarea
                ref="textareaRef"
                v-model="articleForm.content"
                class="editor-textarea-field"
                :placeholder="t('markdown_hint')"
                :readonly="isReviewingAi"
                @scroll="handleEditorScroll"
                @mouseup="checkSelection"
                @keyup="checkSelection"
                @focus="checkSelection"
              ></textarea>
            </div>

            <!-- Standard Split Preview -->
            <div 
              v-if="showSplitView" 
              ref="previewRef" 
              class="markdown-preview-pane"
            ></div>

            <!-- iPhone Mockup Preview -->
            <div v-if="showMobilePreview" class="iphone-mockup-wrapper">
              <div class="iphone-shell">
                <!-- Notch Bar -->
                <div class="iphone-notch-bar">
                  <div class="iphone-time">19:06</div>
                  <div class="iphone-notch"></div>
                  <div class="iphone-status-icons">
                    <svg class="status-signal-svg" width="12" height="9" viewBox="0 0 12 9" fill="currentColor">
                      <rect x="0" y="6" width="2" height="3" rx="0.5" />
                      <rect x="3" y="4" width="2" height="5" rx="0.5" />
                      <rect x="6" y="2" width="2" height="7" rx="0.5" />
                      <rect x="9" y="0" width="2" height="9" rx="0.5" />
                    </svg>
                    <svg class="status-wifi-svg" width="12" height="9" viewBox="0 0 12 9" fill="currentColor">
                      <path d="M6 7.5c.41 0 .75-.34.75-.75S6.41 6 6 6s-.75.34-.75.75.34.75.75.75z" />
                      <path d="M6 1.5C3.89 1.5 2.16 2.72 1.34 4.51c-.13.28-.01.62.27.75.28.13.62.01.75-.27.65-1.42 2.03-2.39 3.64-2.39 1.61 0 2.99.97 3.64 2.39.09.2.29.31.49.31.09 0 .17-.02.26-.06.28-.13.4-.47.27-.75C10.84 2.72 9.11 1.5 6 1.5z" fill-rule="evenodd" clip-rule="evenodd" />
                      <path d="M6 3.75c-1.25 0-2.29.74-2.73 1.83-.11.29.03.61.32.73.29.11.61-.03.73-.32.27-.67.92-1.14 1.68-1.14.76 0 1.41.47 1.68 1.14.09.22.3.34.52.34.07 0 .14-.01.21-.04.29-.12.43-.44.32-.73-.44-1.09-1.48-1.83-2.73-1.83z" fill-rule="evenodd" clip-rule="evenodd" />
                    </svg>
                    <svg class="status-battery-svg" width="17" height="9" viewBox="0 0 17 9" fill="none" stroke="currentColor" stroke-width="1.2">
                      <rect x="0.6" y="0.6" width="13.8" height="7.8" rx="2" />
                      <rect x="2.5" y="2.5" width="8" height="4" rx="0.5" fill="currentColor" stroke="none" />
                      <path d="M15.5 3V6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                    </svg>
                  </div>
                </div>
                <!-- Simulated App Navbar -->
                <div class="iphone-app-navbar">
                  <svg width="9" height="15" viewBox="0 0 9 15" fill="none" xmlns="http://www.w3.org/2000/svg" class="back-arrow-svg">
                    <path d="M8 1L1.5 7.5L8 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                  <span class="navbar-title">{{ articleForm.title || t('untitled') }}</span>
                  <svg width="16" height="4" viewBox="0 0 16 4" fill="currentColor" class="more-dots-svg">
                    <circle cx="2" cy="2" r="1.8" />
                    <circle cx="8" cy="2" r="1.8" />
                    <circle cx="14" cy="2" r="1.8" />
                  </svg>
                </div>
                <!-- Scrolling Content Area -->
                <div 
                  ref="mobilePreviewRef" 
                  class="iphone-screen-content"
                ></div>
              </div>
            </div>
          </template>

          <!-- AI Assistant Drawer Panel -->
          <AiPanel
            v-if="showAiPanel"
            ref="aiPanelRef"
            v-model:customInstruction="customInstruction"
            :showAiPanel="showAiPanel"
            :aiSessions="aiSessions"
            :activeSessionId="activeSessionId"
            :currentSession="currentSession"
            :chatHistory="chatHistory"
            :isGenerating="isGenerating"
            :isSelectionActive="isSelectionActive"
            :selectedTextLength="selectedTextLength"
            :articles="articles"
            :activeArticleTitle="articleForm.title"
            :t="t"
            @create-session="createNewAiSession"
            @clear-chat="clearChatHistory"
            @select-session="selectSession"
            @rename-session="renameSession"
            @delete-session="deleteSession"
            @run-action="handleAiAction"
            @apply-output="({ mode, content }) => applyAiOutput(mode, content)"
            @restore-changes="restoreAiChangesForMsg"
            @stop-generating="stopAiGeneration"
          />
        </div>
      </div>

      <!-- Status Info Bottom Strip -->
      <div class="editor-status-bar">
        <span>{{ wordCount }} {{ t('word_count') }}</span>
        <span>{{ lineCount }} {{ t('line_count') }}</span>
        <span>{{ t('theme_label') }} <strong class="theme-text-highlight">{{ currentThemeName }}</strong></span>
      </div>

      <!-- Custom Delete Confirmation Modal -->
      <div v-if="showDeleteConfirm" class="custom-delete-modal-overlay" @click.self="showDeleteConfirm = false">
        <div class="custom-delete-modal-content">
          <div class="modal-header">
            <h3>⚠️ 确认删除{{ deleteType === 'folder' ? '文件夹' : '文章' }}</h3>
            <button class="btn-close-modal" @click="showDeleteConfirm = false">×</button>
          </div>
          
          <div class="modal-body">
            <p class="delete-warning-text">
              您确定要永久删除名为 <strong class="target-name-highlight">“{{ deleteTargetName }}”</strong> 的{{ deleteType === 'folder' ? '文件夹' : '文章' }}吗？
            </p>
            <p v-if="deleteType === 'folder'" class="folder-danger-notice">
              ⚠️ <strong>警告：</strong>删除该文件夹会连同删除它底下的所有子文件夹和文章，且无法恢复！
            </p>
            
            <div class="storage-paths-box">
              <div class="path-item">
                <span class="path-label">📂 本地数据库存储：</span>
                <span class="path-value" :title="pathsInfo.db_path">{{ pathsInfo.db_path || '获取中...' }}</span>
                <button v-if="pathsInfo.db_path" class="btn-path-action" @click="openDbFolder">
                  打开所在目录
                </button>
              </div>
              <div class="path-item">
                <span class="path-label">🏠 项目工作区路径：</span>
                <span class="path-value" :title="pathsInfo.workspace_path">{{ pathsInfo.workspace_path || '获取中...' }}</span>
                <button v-if="pathsInfo.workspace_path" class="btn-path-action" @click="openWorkspaceFolder">
                  打开工作区目录
                </button>
              </div>
            </div>
          </div>
          
          <div class="modal-footer">
            <button class="btn-modal-cancel" @click="showDeleteConfirm = false">取消</button>
            <button class="btn-modal-confirm" @click="confirmDelete">确认删除</button>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style src="./wechat-editor/WechatEditorGlobal.css"></style>
<style scoped src="./wechat-editor/WechatEditor.css"></style>
