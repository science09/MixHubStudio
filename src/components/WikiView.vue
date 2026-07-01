<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import * as d3 from 'd3'
import { t } from '../utils/i18n'
import { md } from '../utils/markdown'

const props = defineProps({
  showModal: Function
})

// --- 核心状态 ---
const activeSubTab = ref('explorer') // explorer, library, timeline
const wikiEntries = ref([])
const rawSources = ref([])
const localFiles = ref([])
const selectedFolderPath = ref('')
const activeWiki = ref(null)
const activeSource = ref(null)
const searchWiki = ref('')
const filterCategory = ref('All')
const isCompiling = ref(false)
const compilationProgress = ref(0)
const isEditingWiki = ref(false)
const showWikiGraph = ref(false)
const isSaving = ref(false)
const isAuditing = ref(false)
const auditIssues = ref([])
const graphContainer = ref(null)
const graphData = ref({ nodes: [], links: [] })

// --- 文件夹管理逻辑 ---
const selectFolder = async () => {
  try {
    const selected = await open({ directory: true, multiple: false })
    if (selected) {
      selectedFolderPath.value = selected
      await loadFolderFiles()
    }
  } catch (e) { console.error('Select folder failed:', e) }
}

const loadFolderFiles = async () => {
  if (!selectedFolderPath.value) return
  try {
    localFiles.value = await invoke('list_knowledge_files', { path: selectedFolderPath.value })
  } catch (e) { console.error('Load folder files failed:', e) }
}

const ingestLocalFile = async (file) => {
  isCompiling.value = true
  try {
    const text = await invoke('ingest_content', { pathOrUrl: file.path })
    const entries = await invoke('compile_wiki', { rawText: text })
    for (const entry of entries) {
      await invoke('save_wiki', { payload: { 
        id: crypto.randomUUID(),
        title: entry.title,
        content: entry.content,
        category: entry.category,
        tags: entry.tags,
        source_text: entry.source_text,
        sources: [file.name]
      }})
    }
    await loadData()
    await loadFolderFiles()
    props.showModal(t('compilation_success'), `${file.name} ingested successfully`, "success")
  } catch (e) {
    props.showModal(t('compilation_failed'), e, "error")
  } finally {
    isCompiling.value = false
  }
}

// Wiki 表单
const wikiForm = ref({ 
  id: '', 
  title: '', 
  content: '', 
  category: 'General', 
  tags: '', 
  source_text: '',
  sources: [] // 关联的原始资料 ID 列表
})

// --- 计算属性 ---
const categories = computed(() => {
  const cats = new Set(wikiEntries.value.map(e => e.category || 'General'))
  return ['All', ...Array.from(cats).sort()]
})

const filteredWikis = computed(() => {
  const q = (searchWiki.value || '').toLowerCase()
  let list = wikiEntries.value.filter(w => {
    const title = (w.title || '').toLowerCase()
    const cat = (w.category || '').toLowerCase()
    return title.includes(q) || cat.includes(q)
  })
  if (filterCategory.value !== 'All') {
    list = list.filter(w => (w.category || 'General') === filterCategory.value)
  }
  return list.sort((a, b) => (a.category || 'General').localeCompare(b.category || 'General'))
})

// --- 逻辑函数 ---
const loadData = async () => {
  try {
    const [wikis, sources] = await Promise.all([
      invoke('get_wiki'),
      invoke('get_raw_sources') // 假设后端有此接口，若无则模拟
    ])
    wikiEntries.value = wikis || []
    rawSources.value = sources || []
  } catch (e) { console.error('Load data failed:', e) }
}

const selectWiki = (entry) => {
  activeWiki.value = entry
  activeSource.value = null
  isEditingWiki.value = false
}

const selectSource = (source) => {
  activeSource.value = source
  activeWiki.value = null
}

const processAllSources = async () => {
  if (rawSources.value.length === 0) return
  isCompiling.value = true
  compilationProgress.value = 0
  
  try {
    let count = 0
    for (const source of rawSources.value) {
      // 模拟逐个处理
      const entries = await invoke('compile_wiki', { rawText: source.content })
      for (const entry of entries) {
        await invoke('save_wiki', { payload: { 
          id: crypto.randomUUID(),
          title: entry.title,
          content: entry.content,
          category: entry.category,
          tags: entry.tags,
          source_text: entry.source_text,
          sources: [source.name]
        }})
      }
      count++
      compilationProgress.value = (count / rawSources.value.length) * 100
    }
    await loadData()
    props.showModal(t('compilation_success'), `Successfully processed ${count} sources`, "success")
  } catch (e) {
    props.showModal(t('compilation_failed'), e, "error")
  } finally {
    isCompiling.value = false
    compilationProgress.value = 0
  }
}

const createNewWiki = () => {
  activeWiki.value = null
  isEditingWiki.value = true
  wikiForm.value = { 
    id: crypto.randomUUID(), 
    title: '', 
    content: '', 
    category: 'General', 
    tags: '', 
    source_text: '',
    sources: []
  }
}

const editWiki = () => {
  if (!activeWiki.value) return
  wikiForm.value = { ...activeWiki.value }
  isEditingWiki.value = true
}

const saveWikiEntry = async () => {
  isSaving.value = true
  try {
    await invoke('save_wiki', { payload: wikiForm.value })
    isEditingWiki.value = false
    await loadData()
    activeWiki.value = wikiEntries.value.find(e => e.id === wikiForm.value.id)
  } catch (e) { console.error('Save failed:', e) }
  finally { isSaving.value = false }
}

const deleteWikiEntry = async (id) => {
  if (!confirm(t('purge_confirm'))) return
  try {
    await invoke('delete_wiki', { id })
    activeWiki.value = null
    await loadData()
  } catch (e) { console.error('Delete failed:', e) }
}

const importRawData = async () => {
  try {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Knowledge', extensions: ['pdf', 'txt', 'md'] }]
    });
    if (selected) {
      isCompiling.value = true
      compilationProgress.value = 10
      const text = await invoke('ingest_content', { pathOrUrl: selected })
      compilationProgress.value = 40
      const entries = await invoke('compile_wiki', { rawText: text })
      compilationProgress.value = 80
      for (const entry of entries) {
        await invoke('save_wiki', { payload: { 
          id: crypto.randomUUID(),
          title: entry.title,
          content: entry.content,
          category: entry.category,
          tags: entry.tags,
          source_text: entry.source_text,
          sources: [selected]
        }})
      }
      compilationProgress.value = 100
      await loadData()
      props.showModal(t('compilation_success'), t('compilation_success_msg'), "success")
    }
  } catch (e) {
    props.showModal(t('compilation_failed'), e, "error")
  } finally {
    isCompiling.value = false
    setTimeout(() => { compilationProgress.value = 0 }, 1000)
  }
}

const runAudit = async () => {
  isAuditing.value = true
  auditIssues.value = []
  try {
    const issues = await invoke('run_knowledge_audit')
    auditIssues.value = issues
  } catch (error) {
    console.error('Audit failed:', error)
  } finally {
    isAuditing.value = false
  }
}

const renderGraph = (data) => {
  const container = document.getElementById('graphContainerLarge')
  if (!container) return
  
  container.innerHTML = ''
  const width = container.clientWidth || 800
  const height = container.clientHeight || 600
  console.log('Graph dimensions:', width, height)

  if (!data.nodes || data.nodes.length === 0) {
    console.warn('No nodes to render')
    container.innerHTML = '<div style="padding:20px;color:#999;text-align:center">暂无节点数据</div>'
    return
  }

  const svg = d3.select(container).append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', [0, 0, width, height])
    .attr('style', 'max-width: 100%; height: auto;')

  // 再次确保连线的目标节点都存在，防止 D3 报错
  const validLinks = data.links.filter(l => 
    data.nodes.find(n => n.id === (l.source.id || l.source)) && 
    data.nodes.find(n => n.id === (l.target.id || l.target))
  )

  const simulation = d3.forceSimulation(data.nodes)
    .force('link', d3.forceLink(validLinks).id(d => d.id).distance(80))
    .force('charge', d3.forceManyBody().strength(-200)) // 增加排斥力
    .force('collision', d3.forceCollide().radius(30)) // 防止重叠
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('x', d3.forceX(width / 2).strength(0.05))
    .force('y', d3.forceY(height / 2).strength(0.05))

  const link = svg.append('g')
    .attr('stroke', 'oklch(0% 0 0 / 10%)')
    .attr('stroke-opacity', 0.6)
    .selectAll('line')
    .data(data.links)
    .join('line')
    .attr('stroke-width', 1.5)

  const node = svg.append('g')
    .selectAll('g')
    .data(data.nodes)
    .join('g')
    .attr('cursor', 'pointer')
    .on('click', (event, d) => {
      console.log('Node clicked:', d)
      if (event.defaultPrevented) return; // 忽略拖拽产生的点击事件
      
      const wiki = wikis.value.find(w => w.id === d.id)
      if (wiki) {
        selectWiki(wiki)
        activeSubTab.value = 'explorer'
      } else {
        invoke('get_wiki', { id: d.id }).then(w => {
           if (w) {
             selectWiki(w)
             activeSubTab.value = 'explorer'
           }
        })
      }
    })
    .call(d3.drag()
      .on('start', dragstarted)
      .on('drag', dragged)
      .on('end', dragended))
    .on('click', (event, d) => {
      // 这里的 click 放在 drag 之后，有时能更好地处理冲突
      if (event.defaultPrevented) return;
      
      console.log('Final Node Clicked:', d.id);
      
      const wiki = wikiEntries.value.find(w => w.id === d.id);
      if (wiki) {
        selectWiki(wiki);
        activeSubTab.value = 'explorer';
      } else {
        // 如果 wikis 还没加载完，尝试直接通过 ID 跳转
        invoke('get_wiki', { id: d.id }).then(w => {
          if (w) {
            selectWiki(w);
            activeSubTab.value = 'explorer';
          }
        });
      }
    });

  node.append('circle')
    .attr('r', 12) // 进一步增大点击区域
    .attr('fill', d => d.category === 'Entity' ? 'oklch(60% 0.18 255)' : 'oklch(60% 0.18 150)')
    .attr('stroke', 'white')
    .attr('stroke-width', 2)
    .style('pointer-events', 'all')

  node.append('text')
    .text(d => d.title)
    .attr('x', 14)
    .attr('y', 4)
    .style('font-size', '11px')
    .style('font-weight', '600')
    .style('fill', 'oklch(20% 0.01 255)')
    .style('pointer-events', 'none')

  simulation.on('tick', () => {
    link
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y)
    node.attr('transform', d => `translate(${d.x},${d.y})`)
  })

  function dragstarted(event) {
    if (!event.active) simulation.alphaTarget(0.3).restart()
    event.subject.fx = event.subject.x
    event.subject.fy = event.subject.y
  }
  function dragged(event) {
    event.subject.fx = event.x
    event.subject.fy = event.y
  }
  function dragended(event) {
    if (!event.active) simulation.alphaTarget(0)
    event.subject.fx = null
    event.subject.fy = null
  }
}

const refreshGraphData = async () => {
  try {
    const data = await invoke('get_knowledge_graph')
    console.log('Fetched graph data:', data)
    graphData.value = data
    setTimeout(() => renderGraph(data), 300)
  } catch (error) {
    console.error('Failed to fetch graph data:', error)
  }
}

watch(activeSubTab, async (newTab) => {
  if (newTab === 'graph') {
    await refreshGraphData()
  }
})

onMounted(async () => {
  loadData()
})
</script>

<template>
  <div class="knowledge-os-view">
    <!-- Full Width Graph Overlay -->
    <div v-if="activeSubTab === 'graph'" class="expanded-graph-overlay">
      <div class="overlay-header">
        <h2>{{ t('graph') }}</h2>
        <div class="header-actions">
          <button class="btn-refresh-mini" @click="refreshGraphData">🔄</button>
        </div>
      </div>
      <div id="graphContainerLarge" class="graph-canvas-container-large"></div>
    </div>

    <!-- 第 1 栏：全功能导航 (Navigator) -->
    <aside class="os-sidebar">
      <div class="sidebar-tabs">
        <button :class="{ active: activeSubTab === 'explorer' }" @click="activeSubTab = 'explorer'" :title="t('explorer')">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
        </button>
        <button :class="{ active: activeSubTab === 'library' }" @click="activeSubTab = 'library'" :title="t('library')">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
        </button>
        <button :class="{ active: activeSubTab === 'timeline' }" @click="activeSubTab = 'timeline'" :title="t('timeline')">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        </button>
        <button :class="{ active: activeSubTab === 'health' }" @click="activeSubTab = 'health'" :title="t('health')">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
        </button>
        <button :class="{ active: activeSubTab === 'graph' }" @click="activeSubTab = 'graph'" :title="t('graph')">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
        </button>
      </div>

      <div class="sidebar-content">
        <!-- Explorer View -->
        <div v-if="activeSubTab === 'explorer'" class="view-panel explorer">
          <div class="panel-header">
            <h3>{{ t('wiki') }}</h3>
            <button class="btn-action-icon" @click="createNewWiki">+</button>
          </div>
          <div class="search-box-os">
            <input v-model="searchWiki" :placeholder="t('wiki_search_placeholder')">
          </div>
          <div class="entry-list">
            <div v-for="e in filteredWikis" :key="e.id" 
                 :class="['entry-item', { active: activeWiki?.id === e.id }]" 
                 @click="selectWiki(e)">
              <div class="entry-dot"></div>
              <span class="entry-title">{{ e.title }}</span>
            </div>
          </div>
        </div>

        <!-- Library View -->
        <div v-if="activeSubTab === 'library'" class="view-panel library">
          <div class="panel-header">
            <h3>{{ t('library') }}</h3>
            <div class="header-actions-mini">
              <button class="btn-action-icon" @click="processAllSources" :title="t('bulk_process') || '批量抽取特性'">✨</button>
              <button class="btn-action-icon" @click="selectFolder" title="Select Folder">📂</button>
              <button class="btn-action-icon" @click="importRawData" title="Import File">📥</button>
            </div>
          </div>
          
          <div v-if="selectedFolderPath" class="folder-path-strip">
            <span class="path-text">{{ selectedFolderPath }}</span>
            <button class="btn-refresh-mini" @click="loadFolderFiles">🔄</button>
          </div>

          <div class="source-list">
            <!-- Local Files from Folder -->
            <div v-if="localFiles.length > 0" class="source-group">
              <div class="group-label">{{ t('local_files') }}</div>
              <div v-for="f in localFiles" :key="f.path" class="source-item local">
                <span class="source-icon">📄</span>
                <div class="source-info">
                  <span class="source-name">{{ f.name }}</span>
                  <span class="source-meta">{{ (f.size / 1024).toFixed(1) }} KB</span>
                </div>
                <button class="btn-ingest-mini" @click="ingestLocalFile(f)">Feed</button>
              </div>
            </div>

            <div class="source-group">
              <div class="group-label">{{ t('ingested_sources') }}</div>
              <div v-for="s in rawSources" :key="s.id" 
                   :class="['source-item', { active: activeSource?.id === s.id }]" 
                   @click="selectSource(s)">
                <span class="source-icon">✅</span>
                <span class="source-name">{{ s.name }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Timeline View -->
        <div v-if="activeSubTab === 'timeline'" class="view-panel timeline">
          <div class="panel-header"><h3>{{ t('history') }}</h3></div>
          <div class="timeline-placeholder">{{ t('evolution_logs') }}</div>
        </div>

        <!-- Health View -->
        <div v-if="activeSubTab === 'health'" class="view-panel health">
          <div class="panel-header"><h3>{{ t('health') }}</h3></div>
          <div class="health-container">
            <button class="btn-run-audit" @click="runAudit" :disabled="isAuditing">
              {{ isAuditing ? t('auditing') : t('run_audit') }}
            </button>
            <p class="audit-hint">{{ t('audit_hint') }}</p>

            <div class="audit-results">
              <div v-if="auditIssues.length === 0 && !isAuditing" class="no-issues-state">
                <span class="ok-icon">🛡️</span>
                <p>{{ t('no_issues') }}</p>
              </div>
              
              <div v-for="issue in auditIssues" :key="issue.id" :class="['issue-card', issue.severity]">
                <div class="issue-header">
                  <span class="severity-badge">{{ t(issue.severity + '_severity') }}</span>
                  <span class="issue-type">{{ t(issue.issue_type) || issue.issue_type }}</span>
                </div>
                <h4>{{ issue.title }}</h4>
                <p>{{ issue.description }}</p>
                <div class="related-refs">
                  <span v-for="rid in issue.related_ids" :key="rid" class="ref-id">@{{ rid.slice(0,6) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Graph View Sidebar (Simplified) -->
        <div v-if="activeSubTab === 'graph'" class="view-panel graph-panel">
          <div class="panel-header">
            <h3>{{ t('graph') }}</h3>
            <button class="btn-refresh-mini" @click="refreshGraphData">🔄</button>
          </div>
          <div class="graph-sidebar-hint">
            <p>{{ t('graph_view_active') || '图谱模式已开启' }}</p>
            <p class="sub-hint">{{ t('graph_hint') || '拖动节点探索关联，点击查看详情' }}</p>
          </div>
        </div>
      </div>
    </aside>

    <!-- 第 2 栏：主画布 (Canvas) -->
    <main class="os-main-canvas">
      <div v-if="isEditingWiki" class="os-editor">
        <div class="editor-top-bar">
          <input v-model="wikiForm.title" class="os-title-input" :placeholder="t('wiki_title_placeholder')">
          <div class="editor-actions">
            <button class="btn-save-os" @click="saveWikiEntry" :disabled="isSaving">{{ t('save') }}</button>
            <button class="btn-cancel-os" @click="isEditingWiki = false">{{ t('cancel') }}</button>
          </div>
        </div>
        <div class="editor-meta-strip">
          <div class="meta-item"><span>{{ t('category') }}:</span> <input v-model="wikiForm.category"></div>
          <div class="meta-item"><span>{{ t('tags') }}:</span> <input v-model="wikiForm.tags"></div>
        </div>
        <textarea v-model="wikiForm.content" class="os-textarea" :placeholder="t('markdown_hint')"></textarea>
      </div>

      <div v-else-if="activeWiki" class="os-reader">
        <div class="reader-header">
          <h1>{{ activeWiki.title }}</h1>
          <div class="reader-actions">
            <button @click="editWiki">✎ {{ t('edit') }}</button>
            <button @click="deleteWikiEntry(activeWiki.id)">🗑️</button>
          </div>
        </div>
        <div class="reader-meta">
          <span class="os-chip">{{ activeWiki.category }}</span>
          <span class="os-timestamp">{{ new Date(activeWiki.updated_at * 1000).toLocaleDateString() }}</span>
        </div>
        <div class="os-prose" v-html="md.render(activeWiki.content || '')"></div>
      </div>

      <div v-else-if="activeSource" class="os-source-viewer">
        <div v-if="!activeSource.name.endsWith('.md')" class="reader-header">
          <div class="title-with-tag">
            <h1>{{ activeSource.name }}</h1>
            <span class="source-type-tag">{{ t('raw_source') }}</span>
          </div>
        </div>
        <div v-if="activeSource.name.endsWith('.md')" class="os-prose" v-html="md.render(activeSource.content || '')"></div>
        <div v-else class="source-content-pre">{{ activeSource.content }}</div>
      </div>

      <div v-else class="os-welcome">
        <div class="welcome-card">
          <span class="welcome-icon">🧠</span>
          <h2>{{ t('knowledge_os') }}</h2>
          <p>The compounding brain for your AI workflows.</p>
          <button class="btn-prime" @click="createNewWiki">{{ t('initialize_entry') }}</button>
        </div>
      </div>
    </main>

    <!-- 第 3 栏：上下文检视器 (Context Inspector) -->
    <aside class="os-inspector">
      <!-- Raw Source Context -->
      <template v-if="activeSource">
        <div class="inspector-section">
          <div class="section-label">📋 {{ t('source_metadata') }}</div>
          <div class="source-meta-card">
            <div class="meta-field">
              <span class="label">{{ t('filename') || 'Filename' }}</span>
              <span class="value">{{ activeSource.name }}</span>
            </div>
            <div class="meta-field">
              <span class="label">{{ t('type') || 'Type' }}</span>
              <span class="value">{{ activeSource.name.split('.').pop().toUpperCase() }} File</span>
            </div>
            <div class="meta-field">
              <span class="label">{{ t('status') || 'Status' }}</span>
              <span class="value status-ready">{{ t('ready_for_processing') || 'Ready for Processing' }}</span>
            </div>
          </div>
        </div>

        <div class="inspector-section">
          <div class="section-label">🪄 {{ t('ai_actions') }}</div>
          <button class="btn-compile-ai" @click="compileWiki(activeSource.content)" :disabled="isCompiling">
            {{ isCompiling ? t('analyzing') : t('extract_into_wiki') }}
          </button>
          <p class="ai-hint">{{ t('extraction_hint') }}</p>
        </div>
      </template>

      <!-- Wiki Entry Context (Original) -->
      <template v-else>
        <div class="inspector-section">
          <div class="section-label">🎯 {{ t('purpose') }}</div>
          <div class="purpose-card">
            <div v-if="activeWiki?.purpose" class="purpose-content">
              <p>{{ activeWiki.purpose }}</p>
            </div>
            <div v-else-if="activeWiki" class="purpose-ai-guess">
              <span class="ai-badge">{{ t('ai_prediction') }}</span>
              <p>{{ t('analyzing_wiki') }}</p>
            </div>
            <p v-else class="placeholder-text">{{ t('select_entry_hint') }}</p>
          </div>
        </div>

        <div class="inspector-section">
          <div class="section-label">🔗 {{ t('traceability') }}</div>
          <div class="sources-list-mini">
            <div v-for="src in (activeWiki?.sources || [])" :key="src" class="source-mini-card">
              <span class="mini-icon">📄</span>
              <div class="mini-info">
                <span class="mini-name">{{ src }}</span>
              <span class="mini-meta">{{ t('verified_origin') }}</span>
              </div>
            </div>
            <div v-if="!activeWiki?.sources?.length" class="placeholder-text">{{ t('no_sources_linked') }}</div>
          </div>
        </div>

        <div class="inspector-section">
          <div class="section-label">🧠 {{ t('related_concepts') }}</div>
          <div class="concepts-grid">
            <span v-for="tag in (activeWiki?.tags?.split(',') || [])" :key="tag" class="concept-tag">#{{ tag.trim() }}</span>
            <div v-if="!activeWiki?.tags" class="placeholder-text">{{ t('tagging_progress') }}</div>
          </div>
        </div>
      </template>
    </aside>
  </div>
</template>

<style scoped>
/* Knowledge OS Premium UI - OKLCH Design System */
.knowledge-os-view {
  display: flex;
  height: 100%;
  background: oklch(99.5% 0.002 255);
  overflow: hidden;
  animation: os-fade-in 0.8s cubic-bezier(0.16, 1, 0.3, 1);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

@keyframes os-fade-in {
  from { opacity: 0; transform: translateY(10px); filter: blur(20px); }
  to { opacity: 1; transform: translateY(0); filter: blur(0); }
}

/* Sidebar (Navigator) */
.os-sidebar {
  width: 320px;
  display: flex;
  background: oklch(100% 0 0 / 75%);
  backdrop-filter: blur(40px);
  border-right: 1px solid oklch(0% 0 0 / 6%);
  z-index: 20;
}

.sidebar-tabs {
  width: 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 0;
  gap: 16px;
  border-right: 1px solid oklch(0% 0 0 / 4%);
  background: oklch(100% 0 0 / 30%);
}

.sidebar-tabs button {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: none;
  background: transparent;
  color: oklch(45% 0.02 255);
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.23, 1, 0.32, 1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}

.sidebar-tabs button:hover {
  background: oklch(0% 0 0 / 5%);
  color: var(--primary);
}

.sidebar-tabs button.active {
  background: var(--primary);
  color: white;
  box-shadow: 0 8px 16px oklch(60% 0.18 255 / 20%);
}

.sidebar-content { flex: 1; display: flex; flex-direction: column; padding: 24px 16px; gap: 20px; overflow: hidden; }

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.panel-header h3 { 
  font-family: 'Outfit', sans-serif;
  font-size: 11px; 
  font-weight: 900; 
  color: oklch(40% 0.02 255); 
  text-transform: uppercase; 
  letter-spacing: 0.12em; 
}

.search-box-os input {
  width: 100%;
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid oklch(0% 0 0 / 10%);
  background: oklch(100% 0 0 / 80%);
  outline: none;
  font-size: 13px;
  font-weight: 500;
}

.entry-list { overflow-y: auto; flex: 1; margin: 0 -8px; padding: 0 8px; }
.entry-item {
  padding: 10px 12px;
  border-radius: 10px;
  margin-bottom: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 12px;
  transition: all 0.2s;
  border: 1px solid transparent;
}

.entry-item:hover { 
  background: oklch(0% 0 0 / 3%);
}

.entry-item.active { 
  background: oklch(100% 0 0); 
  box-shadow: 0 4px 12px oklch(0% 0 0 / 6%);
  border-color: oklch(0% 0 0 / 4%);
}

.entry-dot { 
  width: 6px; 
  height: 6px; 
  border-radius: 50%; 
  background: oklch(90% 0.01 255); 
}

.entry-item.active .entry-dot { 
  background: var(--primary); 
  box-shadow: 0 0 8px var(--primary);
}

.entry-title { 
  font-size: 13px; 
  font-weight: 600; 
  color: oklch(30% 0.02 255);
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

/* Main Canvas */
.os-main-canvas {
  flex: 1;
  background: white;
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 10;
}

.os-reader, .os-editor, .os-source-viewer {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 40px 0;
  overflow-y: auto;
  align-items: center;
  background: white;
}

.reader-header, .editor-top_bar, .os-prose {
  width: 100%;
  max-width: 800px;
  padding: 0 40px;
}

.reader-header {
  margin-bottom: 32px;
}

.reader-header h1 {
  font-family: 'Outfit', 'Inter', sans-serif;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: oklch(10% 0.01 255);
  line-height: 1.2;
  margin-bottom: 4px;
}

.source-type-tag {
  font-family: 'Outfit', sans-serif;
  font-size: 9px;
  font-weight: 800;
  color: oklch(50% 0.01 255);
  border: 1px solid oklch(0% 0 0 / 10%);
  padding: 1px 6px;
  border-radius: 4px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.os-prose {
  font-family: "Inter", "PingFang SC", sans-serif;
  font-size: 16px;
  line-height: 1.75;
  color: oklch(20% 0.01 255);
}

/* Markdown Styles Distilled */
.os-prose :deep(h1), .os-prose :deep(h2), .os-prose :deep(h3) {
  font-family: "Outfit", "PingFang SC", sans-serif;
  color: oklch(10% 0.01 255);
  margin-top: 1.25rem;
  margin-bottom: 0.5rem;
  letter-spacing: -0.02em;
  font-weight: 800;
}

.os-prose :deep(h1:first-child), 
.os-prose :deep(h2:first-child), 
.os-prose :deep(h3:first-child) {
  margin-top: 0;
}

.os-prose :deep(h2) { font-size: 24px; border-bottom: 2px solid oklch(0% 0 0 / 3%); padding-bottom: 4px; }
.os-prose :deep(h3) { font-size: 19px; }

.os-prose :deep(p) { margin-bottom: 12px; }

.os-prose :deep(hr) {
  border: none;
  border-top: 2px solid oklch(0% 0 0 / 4%);
  margin: 24px 0;
}

.os-prose :deep(ul), .os-prose :deep(ol) {
  margin-bottom: 12px;
  padding-left: 1.5rem;
}

.os-prose :deep(li) { margin-bottom: 6px; }

.os-prose :deep(pre) { 
  background: oklch(5% 0.01 255); 
  color: oklch(98% 0.005 255); 
  padding: 4px 12px; 
  border-radius: 6px; 
  margin: 6px 0; 
  box-shadow: 0 2px 8px oklch(0% 0 0 / 10%);
  border: 1px solid oklch(100% 0 0 / 6%);
  overflow-x: auto;
}

.os-prose :deep(pre code) {
  font-family: 'JetBrains Mono', 'Menlo', monospace;
  font-size: 14.5px;
  line-height: 1.7;
  background: transparent;
  padding: 0;
  color: inherit;
  border: none;
}

.os-prose :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 12px;
  margin: 32px 0;
  display: block;
  box-shadow: 0 10px 30px oklch(0% 0 0 / 10%);
  border: 1px solid oklch(0% 0 0 / 5%);
}

/* Inspector */
.os-inspector {
  width: 320px;
  background: oklch(99.5% 0.002 255 / 90%);
  backdrop-filter: blur(30px);
  border-left: 1px solid oklch(0% 0 0 / 5%);
  padding: 40px 24px;
  display: flex;
  flex-direction: column;
  gap: 40px;
}

.section-label {
  font-family: 'Outfit', sans-serif;
  font-size: 11px;
  font-weight: 900;
  color: oklch(50% 0.02 255);
  text-transform: uppercase;
  letter-spacing: 0.15em;
  margin-bottom: 16px;
}

.purpose-card {
  padding: 20px;
  background: oklch(60% 0.18 255 / 4%);
  border-radius: 16px;
  border: 1px solid oklch(60% 0.18 255 / 8%);
}

.source-mini-card {
  padding: 12px;
  background: white;
  border-radius: 12px;
  border: 1px solid oklch(0% 0 0 / 6%);
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.mini-name { font-size: 12px; font-weight: 700; color: oklch(30% 0.02 255); }

.folder-path-strip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: oklch(0% 0 0 / 5%);
  border-radius: 10px;
  margin-bottom: 16px;
}

.path-text { font-size: 11px; font-weight: 700; color: oklch(40% 0.02 255); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.source-item {
  padding: 10px 12px;
  border-radius: 12px;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 12px;
  transition: 0.2s;
}

.source-item:hover { background: oklch(0% 0 0 / 3%); }
.source-item.active { background: white; box-shadow: 0 4px 8px oklch(0% 0 0 / 4%); border: 1px solid oklch(0% 0 0 / 4%); }

.source-item .source-icon { font-size: 18px; }
.source-item .source-name { 
  font-size: 13px; 
  font-weight: 700; 
  color: oklch(30% 0.02 255);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.source-content-pre {
  background: oklch(98% 0.005 255);
  padding: 32px;
  border-radius: 16px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  line-height: 1.6;
  color: oklch(25% 0.01 255);
  border: 1px solid oklch(0% 0 0 / 5%);
  white-space: pre-wrap;
}

/* Context Inspector Extras */
.placeholder-text {
  font-size: 13px;
  color: oklch(60% 0.01 255);
  font-style: italic;
}

.source-meta-card {
  background: white;
  border-radius: 12px;
  padding: 16px;
  border: 1px solid oklch(0% 0 0 / 5%);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.meta-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.meta-field .label {
  font-size: 10px;
  font-weight: 700;
  color: oklch(50% 0.01 255);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.meta-field .value {
  font-size: 13px;
  font-weight: 600;
  color: oklch(20% 0.01 255);
  word-break: break-all;
}

.status-ready {
  color: oklch(60% 0.15 150);
}

.btn-compile-ai {
  width: 100%;
  padding: 14px;
  background: oklch(20% 0.01 255);
  color: white;
  border: none;
  border-radius: 12px;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 10px 20px oklch(0% 0 0 / 10%);
  margin-bottom: 12px;
}

.btn-compile-ai:hover:not(:disabled) {
  background: oklch(30% 0.01 255);
  transform: translateY(-2px);
}

.btn-compile-ai:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ai-hint {
  font-size: 12px;
  line-height: 1.5;
  color: oklch(50% 0.02 255);
  margin: 0;
}

/* Health & Audit Styles */
.health-container {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.btn-run-audit {
  width: 100%;
  padding: 12px;
  background: oklch(25% 0.02 255);
  color: white;
  border: none;
  border-radius: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.3s;
}

.btn-run-audit:hover:not(:disabled) {
  background: oklch(35% 0.03 255);
  box-shadow: 0 10px 20px oklch(25% 0.02 255 / 15%);
}

.btn-run-audit:disabled { opacity: 0.6; cursor: wait; }

.audit-hint {
  font-size: 12px;
  color: oklch(50% 0.01 255);
  line-height: 1.4;
  margin: 0;
}

.audit-results {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 8px;
}

.no-issues-state {
  text-align: center;
  padding: 40px 20px;
  background: oklch(98% 0 0);
  border-radius: 16px;
  border: 1px dashed oklch(0% 0 0 / 10%);
}

.no-issues-state .ok-icon { font-size: 32px; display: block; margin-bottom: 12px; }
.no-issues-state p { font-size: 13px; color: oklch(50% 0.01 255); }

.issue-card {
  padding: 16px;
  border-radius: 12px;
  background: white;
  border: 1px solid oklch(0% 0 0 / 5%);
  transition: 0.3s;
}

.issue-card:hover { transform: translateX(4px); }

.issue-card.high { border-left: 4px solid oklch(60% 0.15 20); }
.issue-card.medium { border-left: 4px solid oklch(70% 0.15 60); }
.issue-card.low { border-left: 4px solid oklch(80% 0.1 100); }

.issue-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.severity-badge {
  font-size: 10px;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: 4px;
  background: oklch(0% 0 0 / 5%);
  text-transform: uppercase;
}

.issue-type {
  font-size: 11px;
  font-weight: 600;
  color: oklch(50% 0.01 255);
}

.issue-card h4 {
  font-size: 14px;
  margin: 0 0 4px 0;
  color: oklch(20% 0.01 255);
}

.issue-card p {
  font-size: 12px;
  color: oklch(40% 0.01 255);
  line-height: 1.5;
  margin: 0 0 12px 0;
}

.related-refs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.ref-id {
  font-size: 10px;
  font-family: monospace;
  background: oklch(0% 0 0 / 5%);
  padding: 2px 6px;
  border-radius: 4px;
  color: oklch(40% 0.01 255);
}

/* Graph Styles */
.graph-panel {
  display: flex;
  flex-direction: column;
}

.graph-canvas-container {
  flex: 1;
  background: oklch(98% 0.005 255);
  margin: 12px;
  border-radius: 16px;
  border: 1px solid oklch(0% 0 0 / 5%);
  overflow: hidden;
  position: relative;
}

.graph-canvas-container svg {
  cursor: grab;
}

.graph-canvas-container svg:active {
  cursor: grabbing;
}

/* Expanded Graph */
.expanded-graph-overlay {
  position: absolute;
  top: 0;
  left: 320px;
  right: 0;
  bottom: 0;
  background: white;
  z-index: 100;
  display: flex;
  flex-direction: column;
}

.overlay-header {
  padding: 16px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid oklch(0% 0 0 / 5%);
}

.overlay-header h2 {
  font-size: 18px;
  margin: 0;
  color: oklch(20% 0.01 255);
}

.btn-close-overlay {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: oklch(50% 0.01 255);
  transition: 0.3s;
}

.btn-close-overlay:hover {
  color: oklch(20% 0.01 255);
  transform: rotate(90deg);
}

.graph-canvas-container-large {
  flex: 1;
  background: oklch(99% 0.002 255);
}

.header-actions {
  display: flex;
  gap: 4px;
}

/* Graph Sidebar Hint */
.graph-sidebar-hint {
  padding: 16px;
  background: oklch(0% 0 0 / 3%);
  border-radius: 16px;
  border: 1px dashed oklch(0% 0 0 / 10%);
  margin-top: 12px;
}

.graph-sidebar-hint p {
  font-size: 13px;
  color: oklch(30% 0.02 255);
  margin: 0 0 6px 0;
  font-weight: 600;
}

.graph-sidebar-hint .sub-hint {
  font-size: 11px;
  color: oklch(50% 0.01 255);
  font-weight: 400;
  line-height: 1.5;
}

/* Scrollbar */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-thumb { background: oklch(0% 0 0 / 10%); border-radius: 10px; }

</style>
