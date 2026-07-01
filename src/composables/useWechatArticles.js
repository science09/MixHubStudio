import { ref, computed, watch, nextTick } from 'vue'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'

export const getPublishStatus = (content) => {
  if (!content) return null
  const match = content.match(/^---\r?\n([\s\S]+?)\r?\n---/)
  if (match) {
    const yaml = match[1]
    const lines = yaml.split(/\r?\n/)
    let status = null
    let time = null
    let mediaId = null
    for (const line of lines) {
      const parts = line.split(':')
      if (parts.length >= 2) {
        const key = parts[0].trim().toLowerCase()
        const val = parts.slice(1).join(':').trim().replace(/^['"]|['"]$/g, '')
        if (key === 'publish_status') {
          status = val
        } else if (key === 'publish_time') {
          time = val
        } else if (key === 'media_id') {
          mediaId = val
        }
      }
    }
    return { status, time, mediaId }
  }
  return null
}

export function useWechatArticles({ t, isReviewingAi, updatePreviews }) {
  // Articles and folders list
  const articles = ref([])
  const folders = ref([])
  const expandedFolders = ref({})
  
  // Current active article model properties (synced with db)
  const articleForm = ref({
    id: '',
    title: '',
    content: '',
    theme: 'fresh-green',
    folder_id: null
  })
  
  const activeArticleId = ref(null)
  const activeFolderId = ref(null)
  const editingFolderId = ref(null)
  const editingFolderName = ref('')
  const folderRenameInput = ref(null)
  const saveStatus = ref('saved') // 'saved', 'saving', 'error'
  const pathsInfo = ref({ db_path: '', workspace_path: '' })
  
  // Custom delete confirmation modal state
  const showDeleteConfirm = ref(false)
  const deleteType = ref('article') // 'article' | 'folder'
  const deleteTargetId = ref(null)
  const deleteTargetName = ref('')
  
  // Theme state
  const selectedTheme = ref('fresh-green')
  
  let saveTimer = null
  let isSwitching = false
  let draggedItem = null
  const dragOverFolderId = ref(null)

  // Local storage save fallback
  const saveToLocalStorage = () => {
    localStorage.setItem('wechat_articles', JSON.stringify(articles.value))
  }

  // Load articles from Rust Backend
  const loadArticles = async () => {
    try {
      const res = await invoke('get_articles')
      articles.value = (res || []).map(a => {
        const meta = getPublishStatus(a.content)
        return {
          ...a,
          publishStatus: meta ? meta.status : null,
          publishTime: meta ? meta.time : null
        }
      })
      if (articles.value.length > 0 && !activeArticleId.value) {
        selectArticle(articles.value[0].id)
      } else if (articles.value.length === 0) {
        createNewArticle()
      }
    } catch (e) {
      console.error('Failed to load articles from DB:', e)
      // Fallback to localStorage
      const local = localStorage.getItem('wechat_articles')
      if (local) {
        articles.value = JSON.parse(local)
        if (articles.value.length > 0) {
          selectArticle(articles.value[0].id)
        } else {
          createNewArticle()
        }
      } else {
        createNewArticle()
      }
    }
  }

  const selectArticle = (id) => {
    isReviewingAi.value = false
    isSwitching = true
    activeArticleId.value = id
    const art = articles.value.find(a => a.id === id)
    if (art) {
      let themeVal = art.theme || 'fresh-green'
      const legacyMap = {
        '清新绿': 'phycat',
        '橙白活泼': 'orangeheart',
        '极简黑灰': 'fresh-green',
        'default': 'fresh-green',
        '典雅蓝': 'lapis'
      }
      if (legacyMap[themeVal]) {
        themeVal = legacyMap[themeVal]
      }
      articleForm.value = {
        id: art.id,
        title: art.title || '',
        content: art.content || '',
        theme: themeVal,
        folder_id: art.folder_id || null
      }
      selectedTheme.value = themeVal
    }
    nextTick(() => {
      isSwitching = false
      saveStatus.value = 'saved'
    })
  }

  const createNewArticle = async () => {
    const newArt = {
      id: Date.now().toString(),
      title: t('untitled'),
      content: `# ${t('untitled')}\n\n在这里开始编写你的公众号内容...`,
      theme: 'fresh-green',
      folder_id: null
    }
    
    try {
      const res = await invoke('save_article', { payload: newArt })
      const selectId = (res && res.id) ? res.id : newArt.id
      await loadArticles()
      selectArticle(selectId)
    } catch (e) {
      console.error('Failed to create article in DB:', e)
      articles.value.unshift(newArt)
      saveToLocalStorage()
      selectArticle(newArt.id)
    }
  }

  const saveActiveArticle = async () => {
    if (!activeArticleId.value) return
    if (articleForm.value.theme === 'image') return // Skip saving image files
    if (saveTimer) clearTimeout(saveTimer)
    
    articleForm.value.theme = selectedTheme.value
    saveStatus.value = 'saving'
    
    try {
      const res = await invoke('save_article', { payload: articleForm.value })
      if (res && res.id && activeArticleId.value !== res.id) {
        const oldHistory = localStorage.getItem(`oneink-chat-history-${activeArticleId.value}`)
        if (oldHistory) {
          localStorage.setItem(`oneink-chat-history-${res.id}`, oldHistory)
          localStorage.removeItem(`oneink-chat-history-${activeArticleId.value}`)
        }
        activeArticleId.value = res.id
        articleForm.value.id = res.id
      }
      const getRes = await invoke('get_articles')
      articles.value = (getRes || []).map(a => {
        const meta = getPublishStatus(a.content)
        return {
          ...a,
          publishStatus: meta ? meta.status : null,
          publishTime: meta ? meta.time : null
        }
      })
      saveStatus.value = 'saved'
    } catch (e) {
      console.error('Failed to save article in DB:', e)
      const idx = articles.value.findIndex(a => a.id === activeArticleId.value)
      if (idx !== -1) {
        const meta = getPublishStatus(articleForm.value.content)
        articles.value[idx] = {
          ...articles.value[idx],
          title: articleForm.value.title,
          content: articleForm.value.content,
          theme: selectedTheme.value,
          folder_id: articleForm.value.folder_id,
          publishStatus: meta ? meta.status : null,
          publishTime: meta ? meta.time : null,
          updated_at: Date.now() / 1000
        }
        saveToLocalStorage()
      }
      saveStatus.value = 'saved'
    }
  }

  const triggerAutosave = () => {
    if (isSwitching) return
    saveStatus.value = 'saving'
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      await saveActiveArticle()
    }, 1000)
  }

  const loadFolders = async () => {
    try {
      const res = await invoke('get_folders')
      folders.value = res || []
    } catch (e) {
      console.error('Failed to load folders:', e)
    }
  }

  const startRenameFolder = (id, currentName) => {
    editingFolderId.value = id
    editingFolderName.value = currentName
    nextTick(() => {
      if (folderRenameInput.value) {
        const el = Array.isArray(folderRenameInput.value) 
          ? folderRenameInput.value[0] 
          : folderRenameInput.value
        if (el) el.focus()
      }
    })
  }

  const createNewFolder = async (parentId = null) => {
    const id = Date.now().toString()
    const name = t('untitled_folder')
    
    const newFolder = {
      id,
      name,
      parent_id: parentId || null
    }
    
    try {
      const res = await invoke('save_folder', { payload: newFolder })
      const realId = (res && res.id) ? res.id : id
      await loadFolders()
      if (parentId) {
        expandedFolders.value[parentId] = true
      }
      startRenameFolder(realId, name)
    } catch (e) {
      console.error('Failed to create folder:', e)
    }
  }

  const loadPathsInfo = async () => {
    try {
      const res = await invoke('get_paths_info')
      pathsInfo.value = res
    } catch (e) {
      console.error('Failed to get paths info:', e)
    }
  }

  const getArticleDir = () => {
    if (!pathsInfo.value || !pathsInfo.value.workspace_path) {
      return ''
    }
    const syncDir = `${pathsInfo.value.workspace_path}/公众号文章`.replace(/\\/g, '/')
    const articleId = articleForm.value.id || ''
    
    if (!articleId) {
      return syncDir
    }
    
    const normalizedId = articleId.replace(/\\/g, '/')
    const lastSlashIndex = normalizedId.lastIndexOf('/')
    
    if (lastSlashIndex === -1) {
      return syncDir
    } else {
      const relativeDir = normalizedId.substring(0, lastSlashIndex)
      return `${syncDir}/${relativeDir}`
    }
  }

  const resolveLocalPath = (src) => {
    if (!src) return ''
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src)) {
      return src
    }
    
    if (!pathsInfo.value || !pathsInfo.value.workspace_path) {
      return src
    }
    
    let decodedSrc = src
    try {
      decodedSrc = decodeURIComponent(src)
    } catch (e) {
      console.error('Failed to decode URI component:', src, e)
    }
    
    const workspacePath = pathsInfo.value.workspace_path.replace(/\\/g, '/')
    const syncDir = `${workspacePath}/公众号文章`
    const articleDir = getArticleDir().replace(/\\/g, '/')
    
    let absolutePath = ''
    
    if (decodedSrc.startsWith('/') && !decodedSrc.startsWith(workspacePath)) {
      absolutePath = `${syncDir}${decodedSrc}`
    } else if (decodedSrc.startsWith(workspacePath)) {
      absolutePath = decodedSrc
    } else {
      absolutePath = `${articleDir}/${decodedSrc}`
    }
    
    const parts = absolutePath.split('/')
    const resolvedParts = []
    for (const part of parts) {
      if (part === '' && resolvedParts.length > 0) {
        continue
      }
      if (part === '.') {
        continue
      }
      if (part === '..') {
        if (resolvedParts.length > 0) {
          resolvedParts.pop()
        }
        continue
      }
      resolvedParts.push(part)
    }
    
    let resolvedPath = resolvedParts.join('/')
    if (absolutePath.startsWith('/') && !resolvedPath.startsWith('/')) {
      resolvedPath = '/' + resolvedPath
    }
    
    return convertFileSrc(resolvedPath)
  }

  const resolveImagePath = (id) => {
    if (!id) return ''
    if (!pathsInfo.value || !pathsInfo.value.workspace_path) return ''
    const workspacePath = pathsInfo.value.workspace_path.replace(/\\/g, '/')
    const syncDir = `${workspacePath}/公众号文章`
    const absolutePath = `${syncDir}/${id}`
    return convertFileSrc(absolutePath)
  }

  const openFolderInExplorer = (folderId) => {
    if (!pathsInfo.value || !pathsInfo.value.workspace_path) {
      return
    }
    const syncDir = `${pathsInfo.value.workspace_path}/公众号文章`
    const folderPath = folderId ? `${syncDir}/${folderId}` : syncDir
    invoke('open_path', { path: folderPath })
  }

  const triggerDeleteFolder = async (id, name) => {
    deleteType.value = 'folder'
    deleteTargetId.value = id
    deleteTargetName.value = name
    try {
      const res = await invoke('get_paths_info')
      pathsInfo.value = res
    } catch (e) {
      console.error('Failed to get paths info:', e)
    }
    showDeleteConfirm.value = true
  }

  const triggerDeleteArticle = async (id, name) => {
    deleteType.value = 'article'
    deleteTargetId.value = id
    deleteTargetName.value = name
    try {
      const res = await invoke('get_paths_info')
      pathsInfo.value = res
    } catch (e) {
      console.error('Failed to get paths info:', e)
    }
    showDeleteConfirm.value = true
  }

  const openDbFolder = () => {
    if (!pathsInfo.value.db_path) return
    const path = pathsInfo.value.db_path
    const dir = path.substring(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')))
    invoke('open_path', { path: dir })
  }

  const openWorkspaceFolder = () => {
    if (!pathsInfo.value.workspace_path) return
    invoke('open_path', { path: pathsInfo.value.workspace_path })
  }

  const confirmDelete = async () => {
    showDeleteConfirm.value = false
    const id = deleteTargetId.value
    if (deleteType.value === 'folder') {
      try {
        await invoke('delete_folder', { id })
        await loadFolders()
        await loadArticles()
        if (articleForm.value.folder_id === id) {
          activeArticleId.value = null
        }
      } catch (e) {
        console.error('Failed to delete folder:', e)
      }
    } else {
      try {
        localStorage.removeItem(`oneink-chat-history-${id}`)
        await invoke('delete_article', { id })
        if (activeArticleId.value === id) {
          activeArticleId.value = null
        }
        await loadArticles()
      } catch (e) {
        console.error('Failed to delete article in DB:', e)
        articles.value = articles.value.filter(a => a.id !== id)
        saveToLocalStorage()
        if (activeArticleId.value === id) {
          if (articles.value.length > 0) {
            selectArticle(articles.value[0].id)
          } else {
            createNewArticle()
          }
        }
      }
    }
  }

  const deleteFolder = async (id) => {
    if (!confirm(t('delete_folder_confirm'))) return
    try {
      await invoke('delete_folder', { id })
      await loadFolders()
      await loadArticles()
      if (articleForm.value.folder_id === id) {
        activeArticleId.value = null
      }
    } catch (e) {
      console.error('Failed to delete folder:', e)
    }
  }

  const finishRenameFolder = async (id) => {
    if (!editingFolderId.value) return
    const name = editingFolderName.value.trim()
    if (!name) {
      editingFolderId.value = null
      return
    }
    
    const folder = folders.value.find(f => f.id === id)
    if (folder) {
      const payload = { ...folder, name }
      try {
        const res = await invoke('save_folder', { payload })
        const newId = (res && res.id) ? res.id : id
        
        if (id !== newId) {
          if (activeArticleId.value) {
            if (activeArticleId.value === id + '/' || activeArticleId.value.startsWith(id + '/')) {
              const oldArtId = activeArticleId.value
              const newArtId = newId + activeArticleId.value.substring(id.length)
              
              const oldHistory = localStorage.getItem(`oneink-chat-history-${oldArtId}`)
              if (oldHistory) {
                localStorage.setItem(`oneink-chat-history-${newArtId}`, oldHistory)
                localStorage.removeItem(`oneink-chat-history-${oldArtId}`)
              }
              
              activeArticleId.value = newArtId
              if (articleForm.value.id === oldArtId) {
                articleForm.value.id = newArtId
              }
            }
          }
          
          articles.value.forEach(art => {
            if (art.id && (art.id.startsWith(id + '/'))) {
              const oldArtId = art.id
              const newArtId = newId + art.id.substring(id.length)
              if (oldArtId !== activeArticleId.value) {
                const oldHistory = localStorage.getItem(`oneink-chat-history-${oldArtId}`)
                if (oldHistory) {
                  localStorage.setItem(`oneink-chat-history-${newArtId}`, oldHistory)
                  localStorage.removeItem(`oneink-chat-history-${oldArtId}`)
                }
              }
            }
          })
          
          const newExpanded = {}
          for (const [key, val] of Object.entries(expandedFolders.value)) {
            if (key === id) {
              newExpanded[newId] = val
            } else if (key.startsWith(id + '/')) {
              const newKey = newId + key.substring(id.length)
              newExpanded[newKey] = val
            } else {
              newExpanded[key] = val
            }
          }
          expandedFolders.value = newExpanded
        }
        
        await loadFolders()
        await loadArticles()
      } catch (e) {
        console.error('Failed to rename folder:', e)
      }
    }
    editingFolderId.value = null
  }

  const cancelRenameFolder = () => {
    editingFolderId.value = null
  }

  const createArticleInFolder = async (folderId) => {
    expandedFolders.value[folderId] = true
    
    const newArt = {
      id: Date.now().toString(),
      title: t('untitled'),
      content: `# ${t('untitled')}\n\n在这里开始编写你的公众号内容...`,
      theme: 'fresh-green',
      folder_id: folderId
    }
    
    try {
      const res = await invoke('save_article', { payload: newArt })
      const selectId = (res && res.id) ? res.id : newArt.id
      await loadArticles()
      selectArticle(selectId)
    } catch (e) {
      console.error('Failed to create article in folder:', e)
    }
  }

  const toggleFolder = (id) => {
    expandedFolders.value[id] = !expandedFolders.value[id]
  }

  const downloadMarkdown = () => {
    const element = document.createElement("a")
    const file = new Blob([articleForm.value.content], {type: 'text/plain'})
    element.href = URL.createObjectURL(file)
    element.download = `${articleForm.value.title || 'untitled'}.md`
    document.body.appendChild(element)
    element.click()
    document.body.removeChild(element)
  }

  // File System drop and import helpers
  const getFileFromEntry = (fileEntry) => {
    return new Promise((resolve, reject) => {
      fileEntry.file(
        (file) => resolve(file),
        (err) => reject(err)
      )
    })
  }

  const getEntriesFromDirectory = (dirEntry) => {
    const reader = dirEntry.createReader()
    return new Promise((resolve, reject) => {
      let allEntries = []
      const readBatch = () => {
        reader.readEntries(
          (entries) => {
            if (entries.length === 0) {
              resolve(allEntries)
            } else {
              allEntries = allEntries.concat(entries)
              readBatch()
            }
          },
          (err) => reject(err)
        )
      }
      readBatch()
    })
  }

  const getFileText = (file) => {
    if (typeof file.text === 'function') {
      return file.text()
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(reader.error)
      reader.readAsText(file)
    })
  }

  let firstImportedArticleId = null

  const importEntry = async (entry, parentId) => {
    if (entry.isFile) {
      const file = await getFileFromEntry(entry)
      const ext = file.name.split('.').pop().toLowerCase()
      if (['md', 'markdown', 'txt', 'html', 'htm'].includes(ext)) {
        const content = await getFileText(file)
        const title = file.name.replace(/\.(md|markdown|txt|html|htm)$/i, '')
        
        const newArtId = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9)
        const newArt = {
          id: newArtId,
          title: title || t('untitled'),
          content: content || '',
          theme: 'fresh-green',
          folder_id: parentId
        }
        
        await invoke('save_article', { payload: newArt })
        if (!firstImportedArticleId) {
          firstImportedArticleId = newArtId
        }
      }
    } else if (entry.isDirectory) {
      const newFolderId = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9)
      const newFolder = {
        id: newFolderId,
        name: entry.name,
        parent_id: parentId
      }
      
      await invoke('save_folder', { payload: newFolder })
      expandedFolders.value[newFolderId] = true
      
      const childEntries = await getEntriesFromDirectory(entry)
      for (const childEntry of childEntries) {
        await importEntry(childEntry, newFolderId)
      }
    }
  }

  const handleImportFiles = async (dataTransfer, parentId) => {
    const items = dataTransfer.items
    if (!items || items.length === 0) return
    
    firstImportedArticleId = null
    
    try {
      const entries = []
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.kind === 'file') {
          const entry = item.webkitGetAsEntry()
          if (entry) {
            entries.push(entry)
          }
        }
      }
      
      if (entries.length > 0) {
        for (const entry of entries) {
          await importEntry(entry, parentId)
        }
      } else {
        const files = dataTransfer.files
        if (files && files.length > 0) {
          for (let i = 0; i < files.length; i++) {
            const file = files[i]
            const ext = file.name.split('.').pop().toLowerCase()
            if (['md', 'markdown', 'txt', 'html', 'htm'].includes(ext)) {
              const content = await getFileText(file)
              const title = file.name.replace(/\.(md|markdown|txt|html|htm)$/i, '')
              const newArtId = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9)
              const newArt = {
                id: newArtId,
                title: title || t('untitled'),
                content: content || '',
                theme: 'fresh-green',
                folder_id: parentId
              }
              await invoke('save_article', { payload: newArt })
              if (!firstImportedArticleId) {
                firstImportedArticleId = newArtId
              }
            }
          }
        }
      }
      
      await loadFolders()
      await loadArticles()
      
      if (firstImportedArticleId) {
        selectArticle(firstImportedArticleId)
      }
    } catch (err) {
      console.error('Failed to import files/folders:', err)
      alert('导入失败: ' + err.message)
    }
  }

  // Drag & Drop operations handlers
  const handleDragStart = (item, event) => {
    draggedItem = item
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', item.id)
    }
  }

  const handleDragEnd = () => {
    draggedItem = null
    dragOverFolderId.value = null
  }

  const handleDragOver = (item, event) => {
    if (item.type === 'folder') {
      if (draggedItem && draggedItem.id === item.id) return
      const isFiles = event.dataTransfer && event.dataTransfer.types.includes('Files')
      if (draggedItem || isFiles) {
        dragOverFolderId.value = item.id
        if (isFiles && event.dataTransfer) {
          event.dataTransfer.dropEffect = 'copy'
        }
      }
    }
  }

  const handleDragLeave = () => {
    dragOverFolderId.value = null
  }

  const handleDrop = async (targetItem, event) => {
    event.preventDefault()
    event.stopPropagation()
    dragOverFolderId.value = null
    
    const isFiles = event.dataTransfer && event.dataTransfer.types.includes('Files')
    if (isFiles) {
      await handleImportFiles(event.dataTransfer, targetItem.id)
      return
    }
    
    if (!draggedItem) return
    
    try {
      const sourceId = draggedItem.id
      const sourceType = draggedItem.type
      
      if (sourceId === targetItem.id && sourceType === targetItem.type) return
      
      let newParentId = null
      if (targetItem.type === 'folder') {
        newParentId = targetItem.id
        
        if (sourceType === 'folder') {
          let curr = newParentId
          let isCycle = false
          while (curr) {
            if (curr === sourceId) {
              isCycle = true
              break
            }
            const folderObj = folders.value.find(f => f.id === curr)
            curr = folderObj ? folderObj.parent_id : null
          }
          if (isCycle) {
            alert('无法将文件夹移动到其子文件夹中！')
            return
          }
        }
      }
      
      if (sourceType === 'article') {
        const art = articles.value.find(a => a.id === sourceId)
        if (art) {
          art.folder_id = newParentId
          const idx = articles.value.findIndex(a => a.id === sourceId)
          if (idx !== -1) {
            articles.value[idx].folder_id = newParentId
          }
          if (activeArticleId.value === sourceId) {
            articleForm.value.folder_id = newParentId
          }
          await invoke('save_article', { payload: art })
          await loadArticles()
        }
      } else if (sourceType === 'folder') {
        const folder = folders.value.find(f => f.id === sourceId)
        if (folder) {
          folder.parent_id = newParentId
          const idx = folders.value.findIndex(f => f.id === sourceId)
          if (idx !== -1) {
            folders.value[idx].parent_id = newParentId
          }
          await invoke('save_folder', { payload: folder })
          await loadFolders()
        }
      }
    } catch (e) {
      console.error('Drag and drop error:', e)
    } finally {
      draggedItem = null
    }
  }

  const handleDropToRoot = async (event) => {
    event.preventDefault()
    event.stopPropagation()
    
    const isFiles = event.dataTransfer && event.dataTransfer.types.includes('Files')
    if (isFiles) {
      await handleImportFiles(event.dataTransfer, null)
      return
    }
    
    if (!draggedItem) return
    
    try {
      const sourceId = draggedItem.id
      const sourceType = draggedItem.type
      
      if (sourceType === 'article') {
        const art = articles.value.find(a => a.id === sourceId)
        if (art && art.folder_id !== null) {
          art.folder_id = null
          const idx = articles.value.findIndex(a => a.id === sourceId)
          if (idx !== -1) {
            articles.value[idx].folder_id = null
          }
          if (activeArticleId.value === sourceId) {
            articleForm.value.folder_id = null
          }
          await invoke('save_article', { payload: art })
          await loadArticles()
        }
      } else if (sourceType === 'folder') {
        const folder = folders.value.find(f => f.id === sourceId)
        if (folder && folder.parent_id !== null) {
          folder.parent_id = null
          const idx = folders.value.findIndex(f => f.id === sourceId)
          if (idx !== -1) {
            folders.value[idx].parent_id = null
          }
          await invoke('save_folder', { payload: folder })
          await loadFolders()
        }
      }
    } catch (e) {
      console.error('Drop to root error:', e)
    } finally {
      draggedItem = null
    }
  }

  // Flat list representing the expanded folder tree
  const visibleTreeItems = computed(() => {
    const items = []
    
    const foldersByParent = {}
    folders.value.forEach(f => {
      const pId = f.parent_id || 'root'
      if (!foldersByParent[pId]) foldersByParent[pId] = []
      foldersByParent[pId].push(f)
    })
    
    Object.keys(foldersByParent).forEach(pId => {
      foldersByParent[pId].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    })
    
    const articlesByFolder = {}
    articles.value.forEach(a => {
      const fId = a.folder_id || 'root'
      if (!articlesByFolder[fId]) articlesByFolder[fId] = []
      articlesByFolder[fId].push(a)
    })
    
    Object.keys(articlesByFolder).forEach(fId => {
      articlesByFolder[fId].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
    })
    
    const traverse = (parentId, depth) => {
      const parentKey = parentId || 'root'
      
      const currentFolders = foldersByParent[parentKey] || []
      currentFolders.forEach(folder => {
        const isExpanded = !!expandedFolders.value[folder.id]
        items.push({
          type: 'folder',
          id: folder.id,
          name: folder.name,
          parentId: folder.parent_id,
          depth,
          isExpanded
        })
        
        if (isExpanded) {
          traverse(folder.id, depth + 1)
        }
      })
      
      const currentArticles = articlesByFolder[parentKey] || []
      currentArticles.forEach(article => {
        items.push({
          type: 'article',
          id: article.id,
          name: article.title || t('untitled'),
          parentId,
          depth,
          theme: article.theme,
          publishStatus: article.publishStatus,
          publishTime: article.publishTime
        })
      })
    }
    
    traverse(null, 0)
    return items
  })

  // Helper to parse the first H1 heading outside code blocks and frontmatter
  const parseH1Heading = (content) => {
    if (!content) return null
    const lines = content.split('\n')
    let inCodeBlock = false
    let inFrontmatter = false
    let frontmatterCount = 0
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()
      
      // Frontmatter check
      if (trimmed === '---') {
        frontmatterCount++
        inFrontmatter = frontmatterCount < 2
        continue
      }
      if (inFrontmatter) continue
      
      // Code block check
      if (trimmed.startsWith('```')) {
        inCodeBlock = !inCodeBlock
        continue
      }
      if (inCodeBlock) continue
      
      // Check if it is a real H1 heading outside frontmatter and code blocks
      if (line.startsWith('# ')) {
        return {
          title: line.substring(2).trim(),
          index: i,
          raw: line
        }
      }
    }
    return null
  }

  // Watchers for autosave and title-heading synchronization
  watch(() => articleForm.value.content, (newContent) => {
    if (articleForm.value.theme === 'image') return
    const h1Info = parseH1Heading(newContent)
    if (h1Info && h1Info.title) {
      if (articleForm.value.title !== h1Info.title) {
        articleForm.value.title = h1Info.title
      }
    }
    triggerAutosave()
  })

  watch(() => articleForm.value.title, (newTitle) => {
    if (articleForm.value.theme === 'image') return
    const content = articleForm.value.content
    const h1Info = parseH1Heading(content)
    if (h1Info) {
      if (h1Info.title !== newTitle) {
        const lines = content.split('\n')
        lines[h1Info.index] = `# ${newTitle}`
        articleForm.value.content = lines.join('\n')
      }
    }
    triggerAutosave()
  })

  watch(selectedTheme, () => {
    triggerAutosave()
  })

  return {
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
  }
}
