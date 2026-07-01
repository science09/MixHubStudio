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

// --- Wiki 逻辑 ---
const wikiEntries = ref([])
const activeWiki = ref(null)
const searchWiki = ref('')
const filterCategory = ref('All')
const isCompiling = ref(false)
const compilationProgress = ref(0)
const isEditingWiki = ref(false)
const showWikiGraph = ref(false)
const isSaving = ref(false)
const wikiForm = ref({ id: '', title: '', content: '', category: 'General', tags: '', source_text: '' })

const categories = computed(() => {
  const cats = new Set(wikiEntries.value.map(e => e.category || 'General'))
  const sortedCats = Array.from(cats).sort((a, b) => a.localeCompare(b))
  return ['All', ...sortedCats]
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

const graphData = computed(() => {
  const nodes = wikiEntries.value.map(e => ({
    id: e.id,
    title: e.title,
    category: e.category || 'General',
    group: e.category || 'General'
  }))

  const links = []
  wikiEntries.value.forEach(source => {
    if (!source.content) return
    const matches = source.content.matchAll(/\[\[(.*?)\]\]/g)
    for (const match of matches) {
      const targetTitle = match[1]
      const target = wikiEntries.value.find(e => e.title === targetTitle)
      if (target && target.id !== source.id) {
        links.push({ source: source.id, target: target.id })
      }
    }
  })

  return { nodes, links }
})

let simulation = null

const renderGraph = () => {
  const container = document.getElementById('wiki-graph-container')
  if (!container) return
  
  const width = container.clientWidth
  const height = container.clientHeight
  
  d3.select('#wiki-graph-container svg').remove()
  const svg = d3.select('#wiki-graph-container')
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', [0, 0, width, height])

  const g = svg.append('g')
  svg.call(d3.zoom().on('zoom', (e) => g.attr('transform', e.transform)))

  const { nodes, links } = JSON.parse(JSON.stringify(graphData.value))

  simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(100))
    .force('charge', d3.forceManyBody().strength(-300))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(50))

  const link = g.append('g')
    .attr('stroke', 'var(--border)')
    .attr('stroke-opacity', 0.4)
    .selectAll('line')
    .data(links)
    .join('line')
    .attr('stroke-width', 1.5)

  const node = g.append('g')
    .selectAll('.node')
    .data(nodes)
    .join('g')
    .attr('class', 'node')
    .call(d3.drag()
      .on('start', dragstarted)
      .on('drag', dragged)
      .on('end', dragended))
    .on('click', (e, d) => {
      const entry = wikiEntries.value.find(e => e.id === d.id)
      if (entry) selectWiki(entry)
    })

  node.append('circle')
    .attr('r', 8)
    .attr('fill', d => d.id === activeWiki.value?.id ? 'var(--primary)' : 'var(--bg-tertiary)')
    .attr('stroke', 'var(--primary)')
    .attr('stroke-width', 2)

  node.append('text')
    .text(d => d.title)
    .attr('x', 12)
    .attr('y', 4)
    .attr('font-size', '11px')
    .attr('font-weight', '700')
    .attr('fill', 'var(--text)')

  simulation.on('tick', () => {
    link.attr('x1', d => d.source.x).attr('y1', d => d.source.y).attr('x2', d => d.target.x).attr('y2', d => d.target.y)
    node.attr('transform', d => `translate(${d.x},${d.y})`)
  })

  function dragstarted(event) {
    if (!event.active) simulation.alphaTarget(0.3).restart()
    event.subject.fx = event.subject.x
    event.subject.fy = event.subject.y
  }
  function dragged(event) { event.subject.fx = event.x; event.subject.fy = event.y; }
  function dragended(event) {
    if (!event.active) simulation.alphaTarget(0)
    event.subject.fx = null; event.subject.fy = null;
  }
}

watch(showWikiGraph, (val) => { if (val) nextTick(() => renderGraph()) })
watch(activeWiki, () => { if (showWikiGraph.value) renderGraph() })

const loadWiki = async () => {
  try {
    const data = await invoke('get_wiki')
    if (data) wikiEntries.value = data
  } catch (e) { console.error('loadWiki failed:', e) }
}

const selectWiki = (entry) => {
  activeWiki.value = entry
  isEditingWiki.value = false
}

const createNewWiki = () => {
  activeWiki.value = null
  isEditingWiki.value = true
  wikiForm.value = { id: crypto.randomUUID(), title: '', content: '', category: 'General', tags: '', source_text: '' }
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
    await loadWiki()
    activeWiki.value = wikiEntries.value.find(e => e.id === wikiForm.value.id)
  } catch (e) {
    console.error('saveWikiEntry failed:', e)
  } finally {
    isSaving.value = false
  }
}

const deleteWikiEntry = async (id) => {
  if (!confirm(t('purge_confirm'))) return
  try {
    await invoke('delete_wiki', { id })
    activeWiki.value = null
    await loadWiki()
  } catch (e) { console.error('deleteWikiEntry failed:', e) }
}

const wikiHealthReport = ref(null)
const isAnalyzingHealth = ref(false)
const isEvolving = ref(false)

const runHealthCheck = async () => {
  isAnalyzingHealth.value = true
  try {
    wikiHealthReport.value = await invoke('analyze_wiki_health')
  } catch (e) { console.error('Health check failed:', e) }
  finally { isAnalyzingHealth.value = false }
}

const evolveTopic = async (topic) => {
  isEvolving.value = true
  try {
    await invoke('evolve_wiki_topic', { topic })
    await loadWiki()
    if (wikiHealthReport.value) {
      wikiHealthReport.value.gaps = wikiHealthReport.value.gaps.filter(g => g !== topic)
    }
  } catch (e) { console.error('Evolution failed:', e) }
  finally { isEvolving.value = false }
}

const applyMerge = async (mergeSuggestion) => {
  const targetId = mergeSuggestion.ids[0]
  const sourceIds = mergeSuggestion.ids.slice(1)
  for (const id of sourceIds) { await invoke('delete_wiki', { id }) }
  await loadWiki()
  wikiHealthReport.value.duplicates = wikiHealthReport.value.duplicates.filter(d => d !== mergeSuggestion)
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
          source_text: entry.source_text
        }})
      }
      compilationProgress.value = 100
      await loadWiki()
      props.showModal(t('compilation_success'), t('compilation_success_msg'), "success")
    }
  } catch (e) {
    props.showModal(t('compilation_failed'), e, "error")
  } finally {
    isCompiling.value = false
    setTimeout(() => { compilationProgress.value = 0 }, 1000)
  }
}

onMounted(() => { loadWiki() })

defineExpose({ findWikiContext: (q) => {
  if (!q) return []
  const query = q.toLowerCase()
  return wikiEntries.value.filter(w => {
    const title = (w.title || '').toLowerCase()
    const tags = (w.tags || '').toLowerCase()
    return query.includes(title) || title.includes(query) || tags.includes(query)
  }).slice(0, 3)
}})
</script>

<template>
  <section class="tab-pane h-full wiki-premium-view">
    <div class="wiki-workspace">
      <div class="wiki-sidebar">
        <div class="wiki-sidebar-inner">
          <div class="wiki-header-distilled">
            <div class="wiki-header-title">
              <h2>{{ t('wiki') }}</h2>
              <div class="wiki-header-actions">
                <button class="btn-icon-premium" @click="showWikiGraph = !showWikiGraph" :class="{ active: showWikiGraph }" title="Graph View">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
                </button>
                <button class="btn-icon-premium" @click="importRawData" :disabled="isCompiling">
                  📥
                </button>
              </div>
            </div>
            <button class="btn-add-wiki-premium" @click="createNewWiki">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              {{ t('new_entry') }}
            </button>
            <div class="wiki-search-premium">
              <svg class="search-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input v-model="searchWiki" :placeholder="t('wiki_search_placeholder')">
            </div>
          </div>
          <div class="wiki-list-scroller">
            <div class="wiki-items-container">
              <template v-for="(e, index) in filteredWikis" :key="e.id">
                <div v-if="index === 0 || e.category !== filteredWikis[index-1].category" class="list-group-label">{{ e.category || 'General' }}</div>
                <div :class="['wiki-card-premium', { active: activeWiki?.id === e.id }]" @click="selectWiki(e)">
                  <div class="card-indicator"></div>
                  <div class="card-content">
                    <span class="card-title">{{ e.title }}</span>
                    <div class="card-meta">
                      <span v-for="tag in (e.tags?.split(',') || [])" :key="tag" class="tag-micro">{{ tag.trim() }}</span>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </div>
          <div class="wiki-sidebar-footer">
            <button class="btn-health-check-premium" @click="runHealthCheck" :class="{ loading: isAnalyzingHealth }">
              <div class="shield-aura"></div>
              <span class="btn-label">🛡️ {{ isAnalyzingHealth ? t('analyzing') : t('health_check') }}</span>
            </button>
          </div>
        </div>
      </div>
      <div class="wiki-main-canvas">
        <div id="wiki-graph-container" class="wiki-graph-background" :class="{ 'full-view': showWikiGraph }"></div>
        <div class="main-content-area" v-if="!showWikiGraph">
          <div v-if="isEditingWiki" class="wiki-editor-premium">
            <div class="wiki-editor-header">
              <div class="header-main-info">
                <input v-model="wikiForm.title" class="wiki-title-input" :placeholder="t('wiki_title_placeholder')">
                <div class="wiki-editor-meta-row">
                  <div class="wiki-meta-field">
                    <span class="wiki-meta-label">{{ t('category') }}:</span>
                    <input v-model="wikiForm.category" class="wiki-meta-input">
                  </div>
                  <div class="wiki-meta-field">
                    <span class="wiki-meta-label">{{ t('tags') }}:</span>
                    <input v-model="wikiForm.tags" class="wiki-meta-input" :placeholder="t('wiki_tags_placeholder')">
                  </div>
                </div>
              </div>
              <div class="wiki-editor-actions">
                <button class="wiki-btn-save" @click="saveWikiEntry">{{ t('save') }}</button>
                <button class="wiki-btn-cancel" @click="isEditingWiki = false">{{ t('cancel') }}</button>
              </div>
            </div>
            <div class="wiki-editor-body">
              <div class="editor-main">
                <textarea v-model="wikiForm.content" class="wiki-textarea" :placeholder="t('markdown_hint')"></textarea>
              </div>
              <div class="editor-footer-meta">
                <div class="source-input-group">
                  <span class="meta-label">🔗 {{ t('source_ref') }}</span>
                  <textarea v-model="wikiForm.source_text" class="source-textarea" placeholder="Paste source snippet here..."></textarea>
                </div>
              </div>
            </div>
          </div>
          <div v-else-if="activeWiki" class="wiki-viewer">
            <div class="viewer-header">
              <h2>{{ activeWiki.title }}</h2>
              <div class="viewer-actions">
                <button class="btn-edit" @click="editWiki">✎ {{ t('edit') }}</button>
                <button class="btn-delete" @click="deleteWikiEntry(activeWiki.id)">🗑️ {{ t('delete') }}</button>
              </div>
            </div>
            <div class="viewer-meta">
              <span class="tag-chip">{{ activeWiki.category }}</span>
              <span v-if="activeWiki.tags" class="tag-chip secondary">{{ activeWiki.tags }}</span>
              <span class="time-meta">{{ new Date(activeWiki.updated_at * 1000).toLocaleString() }}</span>
            </div>
            <div class="wiki-content-scroll">
              <div class="wiki-content-prose" v-html="md.render(activeWiki.content)"></div>
              <div v-if="activeWiki.source_text" class="wiki-source-distilled">
                <div class="source-header"><span class="source-icon">🔗</span>{{ t('source_ref') }}</div>
                <div class="source-body">{{ activeWiki.source_text }}</div>
              </div>
            </div>
          </div>
          <div v-else class="wiki-placeholder">
            <div class="placeholder-content">
              <div class="icon">📚</div>
              <h3>{{ t('wiki') }}</h3>
              <p>{{ t('wiki_desc') }}</p>
              <button class="btn-new-chat" @click="createNewWiki" style="width: auto; padding: 12px 24px; margin-top: 20px;">{{ t('new_entry') }}</button>
            </div>
          </div>
        </div>
        <!-- Health Check Overlay -->
        <div v-if="wikiHealthReport" class="wiki-health-overlay" @click.self="wikiHealthReport = null">
          <div class="health-report-card">
            <div class="viewer-header">
              <h3>🛡️ {{ t('health_report_title') }}</h3>
              <button class="btn-close" @click="wikiHealthReport = null">✕</button>
            </div>
            <div class="wiki-content-scroll">
              <div v-if="wikiHealthReport.duplicates?.length" class="health-section">
                <h4>{{ t('duplicate_found') }}</h4>
                <div v-for="dup in wikiHealthReport.duplicates" :key="dup.ids.join(',')" class="health-item">
                  <p><strong>{{ dup.concept }}</strong> is discussed in multiple entries.</p>
                  <button @click="applyMerge(dup)" class="btn-action-small">{{ t('merge_btn') }}</button>
                </div>
              </div>
              <div v-if="wikiHealthReport.gaps?.length" class="health-section">
                <h4>{{ t('gaps_found') }}</h4>
                <div v-for="gap in wikiHealthReport.gaps" :key="gap" class="health-item">
                  <p>Missing depth in: <strong>{{ gap }}</strong></p>
                  <button @click="evolveTopic(gap)" :disabled="isEvolving" class="btn-action-small">调研补全</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Impeccable Standard: OKLCH Design System */
.wiki-premium-view { 
  background: radial-gradient(circle at 20% 20%, oklch(99% 0.005 255) 0%, oklch(97% 0.01 255) 100%);
  padding: 0;
  height: 100%;
}

.wiki-workspace { 
  display: flex; 
  height: 100%; 
  gap: 0; 
  animation: view-entrance 0.8s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes view-entrance {
  from { opacity: 0; transform: scale(0.98) translateY(10px); filter: blur(10px); }
  to { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); }
}

.wiki-sidebar { 
  width: 340px; 
  background: oklch(100% 0 0 / 60%);
  backdrop-filter: blur(40px) saturate(180%);
  border-right: 1px solid oklch(0% 0 0 / 5%); 
  display: flex; 
  flex-direction: column; 
  z-index: 10;
  box-shadow: 20px 0 50px oklch(0% 0 0 / 2%);
}

.wiki-sidebar-inner { display: flex; flex-direction: column; height: 100%; }

.wiki-header-distilled { padding: 40px 28px 24px; }

.wiki-header-title { 
  display: flex; 
  align-items: center; 
  justify-content: space-between; 
  margin-bottom: 28px; 
}

.wiki-header-title h2 { 
  font-size: 24px; 
  font-weight: 900; 
  letter-spacing: -0.04em; 
  color: oklch(20% 0.02 255); 
}

.wiki-header-actions { display: flex; gap: 10px; }

.btn-icon-premium { 
  width: 40px; 
  height: 40px; 
  border-radius: 12px; 
  border: 1px solid oklch(0% 0 0 / 8%); 
  background: oklch(100% 0 0); 
  color: oklch(45% 0.02 255); 
  display: flex; 
  align-items: center; 
  justify-content: center; 
  cursor: pointer; 
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 2px 8px oklch(0% 0 0 / 4%);
}

.btn-icon-premium:hover { 
  border-color: var(--primary); 
  color: var(--primary); 
  transform: translateY(-2px);
  box-shadow: 0 8px 16px oklch(60% 0.15 255 / 15%);
}

.btn-icon-premium.active { 
  background: var(--primary); 
  color: white; 
  border-color: var(--primary); 
}

.btn-add-wiki-premium { 
  width: 100%; 
  padding: 14px; 
  border-radius: 16px; 
  background: var(--primary); 
  color: white; 
  border: none; 
  font-size: 15px; 
  font-weight: 800; 
  display: flex; 
  align-items: center; 
  justify-content: center; 
  gap: 12px; 
  cursor: pointer; 
  transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1); 
  margin-bottom: 24px; 
  box-shadow: 0 12px 24px oklch(60% 0.18 255 / 25%); 
}

.btn-add-wiki-premium:hover { 
  transform: translateY(-3px) scale(1.02); 
  box-shadow: 0 20px 40px oklch(60% 0.18 255 / 35%); 
}

.wiki-search-premium { 
  position: relative; 
  background: oklch(0% 0 0 / 4%); 
  border-radius: 14px; 
  padding: 6px 16px; 
  display: flex; 
  align-items: center; 
  gap: 12px; 
  border: 1.5px solid transparent; 
  transition: all 0.3s; 
}

.wiki-search-premium:focus-within { 
  background: oklch(100% 0 0); 
  border-color: oklch(60% 0.15 255 / 30%); 
  box-shadow: 0 8px 20px oklch(0% 0 0 / 4%); 
}

.wiki-search-premium input { 
  border: none; 
  background: transparent; 
  padding: 10px 0; 
  font-size: 14px; 
  font-weight: 600;
  width: 100%; 
  outline: none; 
  color: oklch(20% 0.02 255);
}

.wiki-list-scroller { 
  flex: 1; 
  overflow-y: auto; 
  padding: 12px 16px; 
  mask-image: linear-gradient(to bottom, transparent, black 20px, black calc(100% - 20px), transparent);
}

.list-group-label { 
  padding: 24px 16px 12px; 
  font-size: 11px; 
  font-weight: 900; 
  color: oklch(50% 0.02 255); 
  text-transform: uppercase; 
  letter-spacing: 0.15em; 
}

.wiki-card-premium { 
  padding: 20px; 
  border-radius: 18px; 
  margin-bottom: 10px; 
  cursor: pointer; 
  display: flex; 
  gap: 16px; 
  transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1); 
  border: 1px solid transparent; 
  position: relative; 
  overflow: hidden;
}

.wiki-card-premium::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, oklch(100% 0 0 / 80%), oklch(100% 0 0 / 40%));
  opacity: 0;
  transition: 0.4s;
  z-index: -1;
}

.wiki-card-premium:hover { 
  transform: translateX(6px); 
  box-shadow: 0 10px 30px oklch(0% 0 0 / 5%);
}

.wiki-card-premium:hover::before { opacity: 1; }

.wiki-card-premium.active { 
  background: oklch(100% 0 0); 
  border-color: oklch(60% 0.15 255 / 20%); 
  box-shadow: 0 15px 45px oklch(0% 0 0 / 8%); 
}

.card-indicator { 
  width: 5px; 
  height: 0; 
  background: var(--primary); 
  border-radius: 10px; 
  transition: 0.5s cubic-bezier(0.16, 1, 0.3, 1); 
  margin-top: 4px; 
}

.wiki-card-premium.active .card-indicator { height: 24px; }

.card-title { 
  font-size: 15px; 
  font-weight: 800; 
  color: oklch(25% 0.02 255); 
  display: block; 
  margin-bottom: 8px; 
  letter-spacing: -0.01em;
}

.card-meta { display: flex; flex-wrap: wrap; gap: 6px; }

.tag-micro { 
  font-size: 10px; 
  font-weight: 800; 
  color: oklch(45% 0.02 255); 
  background: oklch(0% 0 0 / 5%); 
  padding: 3px 8px; 
  border-radius: 6px; 
  text-transform: uppercase; 
  letter-spacing: 0.05em;
}

.wiki-sidebar-footer { padding: 24px; border-top: 1px solid oklch(0% 0 0 / 5%); }

.btn-health-check-premium { 
  width: 100%; 
  padding: 16px; 
  border-radius: 18px; 
  border: 1px solid oklch(60% 0.15 255 / 20%); 
  background: oklch(100% 0 0 / 80%); 
  color: var(--primary); 
  position: relative; 
  overflow: hidden; 
  cursor: pointer; 
  transition: all 0.4s; 
  display: flex; 
  align-items: center; 
  justify-content: center; 
}

.btn-health-check-premium:hover {
  background: oklch(100% 0 0);
  border-color: var(--primary);
  transform: translateY(-2px);
  box-shadow: 0 12px 24px oklch(60% 0.15 255 / 10%);
}

.wiki-main-canvas { 
  flex: 1; 
  position: relative; 
  overflow: hidden; 
  background: oklch(99% 0 0); 
}

.wiki-graph-background { 
  position: absolute; 
  top: 0; 
  left: 0; 
  width: 100%; 
  height: 100%; 
  z-index: 1; 
  opacity: 0.6; 
  transition: 1s cubic-bezier(0.16, 1, 0.3, 1); 
  pointer-events: none; 
}

.wiki-graph-background.full-view { 
  opacity: 1; 
  z-index: 20; 
  background: oklch(100% 0 0); 
  pointer-events: auto; 
}

.main-content-area { 
  position: relative; 
  z-index: 5; 
  height: 100%; 
  display: flex; 
  flex-direction: column; 
}

.wiki-editor-premium { 
  height: 100%; 
  background: oklch(100% 0 0 / 95%); 
  backdrop-filter: blur(30px); 
  display: flex; 
  flex-direction: column; 
}

.wiki-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  animation: viewer-entrance 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes viewer-entrance {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

.viewer-header, .wiki-editor-header { 
  padding: 60px 80px 40px; 
  display: flex; 
  justify-content: space-between; 
  align-items: flex-end; 
  flex-wrap: wrap; 
  gap: 40px; 
}

.viewer-header h2 {
  font-size: 40px;
  font-weight: 900;
  letter-spacing: -0.05em;
  color: oklch(15% 0.02 255);
  line-height: 1.1;
}

.viewer-meta {
  padding: 0 80px 30px;
  display: flex;
  gap: 12px;
  align-items: center;
}

.tag-chip {
  padding: 6px 14px;
  border-radius: 10px;
  background: oklch(96% 0.01 255);
  color: oklch(40% 0.02 255);
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.tag-chip.secondary {
  background: oklch(60% 0.18 255 / 10%);
  color: var(--primary);
}

.time-meta {
  font-size: 12px;
  font-weight: 600;
  color: oklch(60% 0.01 255);
  margin-left: 10px;
}

.wiki-content-scroll { 
  flex: 1; 
  overflow-y: auto; 
  padding: 0 80px 100px; 
}

.wiki-content-prose {
  font-size: 17px;
  line-height: 1.8;
  color: oklch(30% 0.01 255);
  max-width: 80ch;
}

.wiki-source-distilled { 
  margin-top: 80px; 
  padding: 32px; 
  background: oklch(98% 0.005 255); 
  border-radius: 24px; 
  border: 1px solid oklch(0% 0 0 / 3%); 
  box-shadow: inset 0 2px 4px oklch(0% 0 0 / 2%);
}

.source-header { 
  display: flex; 
  align-items: center; 
  gap: 10px; 
  font-size: 12px; 
  font-weight: 900; 
  color: oklch(50% 0.02 255); 
  text-transform: uppercase; 
  letter-spacing: 0.1em; 
  margin-bottom: 16px; 
}

.source-body { 
  font-size: 14px; 
  line-height: 1.7; 
  color: oklch(45% 0.02 255); 
  font-style: italic; 
}

.wiki-placeholder { 
  height: 100%; 
  display: flex; 
  flex-direction: column; 
  align-items: center; 
  justify-content: center; 
  text-align: center; 
  background: radial-gradient(circle at center, oklch(100% 0 0) 0%, oklch(98% 0.01 255) 100%); 
}

.placeholder-content {
  animation: placeholder-entrance 1s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes placeholder-entrance {
  from { opacity: 0; transform: translateY(30px); }
  to { opacity: 1; transform: translateY(0); }
}

.wiki-placeholder .icon { 
  font-size: 120px; 
  margin-bottom: 40px; 
  filter: drop-shadow(0 20px 40px oklch(60% 0.18 255 / 20%)); 
  animation: float 8s ease-in-out infinite; 
}

@keyframes float { 
  0%, 100% { transform: translateY(0) rotate(0deg); } 
  50% { transform: translateY(-30px) rotate(5deg); } 
}

.wiki-placeholder h3 { 
  font-size: 28px; 
  font-weight: 900; 
  color: oklch(20% 0.02 255); 
  margin-bottom: 12px; 
  letter-spacing: -0.03em;
}

.wiki-placeholder p { 
  max-width: 360px; 
  line-height: 1.7; 
  font-size: 16px;
  color: oklch(50% 0.02 255);
}

.wiki-textarea { 
  flex: 1; 
  width: 100%; 
  border: none; 
  padding: 40px 80px; 
  font-size: 17px; 
  line-height: 1.8; 
  color: oklch(25% 0.01 255); 
  background: oklch(99.5% 0.005 80); /* Warm paper feel */
  resize: none; 
  outline: none; 
  font-family: 'JetBrains Mono', 'Fira Code', monospace; 
}

.wiki-health-overlay { 
  position: absolute; 
  top: 0; 
  left: 0; 
  right: 0; 
  bottom: 0; 
  background: oklch(100% 0 0 / 40%); 
  backdrop-filter: blur(25px); 
  z-index: 100; 
  display: flex; 
  align-items: center; 
  justify-content: center; 
  padding: 40px; 
}

.health-report-card { 
  width: 100%; 
  max-width: 680px; 
  max-height: 85%; 
  background: oklch(100% 0 0); 
  border-radius: 36px; 
  border: 1px solid oklch(0% 0 0 / 5%); 
  box-shadow: 0 50px 120px oklch(0% 0 0 / 15%); 
  display: flex; 
  flex-direction: column; 
  overflow: hidden; 
}

.btn-action-small { 
  padding: 8px 18px; 
  font-size: 13px; 
  background: oklch(100% 0 0); 
  border: 1.5px solid var(--primary); 
  color: var(--primary); 
  border-radius: 12px; 
  font-weight: 800; 
  cursor: pointer; 
  transition: all 0.3s;
}

.btn-action-small:hover {
  background: var(--primary);
  color: white;
  transform: translateY(-2px);
  box-shadow: 0 8px 16px oklch(60% 0.18 255 / 20%);
}
</style>
