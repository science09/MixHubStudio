<script setup>
import { computed, ref, watch, nextTick } from 'vue'

const props = defineProps({
  visibleTreeItems: {
    type: Array,
    required: true
  },
  filteredArticles: {
    type: Array,
    required: true
  },
  activeFolderId: {
    type: [Number, String, null],
    default: null
  },
  activeArticleId: {
    type: [Number, String, null],
    default: null
  },
  editingFolderId: {
    type: [Number, String, null],
    default: null
  },
  dragOverFolderId: {
    type: [Number, String, null],
    default: null
  },
  searchQuery: {
    type: String,
    default: ''
  },
  editingFolderName: {
    type: String,
    default: ''
  },
  t: {
    type: Function,
    required: true
  }
})

const emit = defineEmits([
  'update:searchQuery',
  'update:editingFolderName',
  'create-article',
  'create-folder',
  'toggle-folder',
  'finish-rename-folder',
  'cancel-rename-folder',
  'start-rename-folder',
  'create-article-in-folder',
  'open-folder-in-explorer',
  'delete-folder',
  'select-article',
  'delete-article',
  'drag-start',
  'drag-end',
  'drag-over',
  'drag-leave',
  'drop',
  'drop-root'
])

// Two-way computed bindings for parent integration
const localSearchQuery = computed({
  get: () => props.searchQuery,
  set: (val) => emit('update:searchQuery', val)
})

const localEditingFolderName = computed({
  get: () => props.editingFolderName,
  set: (val) => emit('update:editingFolderName', val)
})

const folderRenameInput = ref(null)

// Focus and select the input text automatically inside the sub-component
watch(() => props.editingFolderId, (newId) => {
  if (newId) {
    nextTick(() => {
      const el = Array.isArray(folderRenameInput.value)
        ? folderRenameInput.value[0]
        : folderRenameInput.value
      if (el) {
        el.focus()
        el.select()
      }
    })
  }
})
</script>

<template>
  <aside class="articles-sidebar">
    <div class="sidebar-header">
      <h3>{{ t('article_list') }}</h3>
      <div style="display: flex; gap: 6px; align-items: center;">
        <button class="btn-new-article" @click="emit('create-article')">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" class="btn-icon">
            <path d="M8.5 1.5H3C2.17157 1.5 1.5 2.17157 1.5 3V11C1.5 11.8284 2.17157 12.5 3 12.5H11C11.8284 12.5 12.5 11.8284 12.5 11V5.5L8.5 1.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
            <path d="M8.5 1.5V5.5H12.5" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
            <path d="M7 7.5V10.5M5.5 9H8.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
          <span>{{ t('new_article') }}</span>
        </button>
        <button class="btn-new-folder" @click="() => emit('create-folder', null)" :title="t('new_folder')">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1 3.5C1 2.67157 1.67157 2 2.5 2H5.5L7 3.5H11.5C12.3284 3.5 13 4.17157 13 5V11.5C13 12.3284 12.3284 13 11.5 13H2.5C1.67157 13 1 12.3284 1 11.5V3.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" fill="currentColor" fill-opacity="0.1"/>
            <path d="M7 6.5V10.5M5 8.5H9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="search-box-wechat">
      <div class="search-input-wrapper">
        <svg class="search-icon-svg" width="12" height="12" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.3"/>
          <path d="M9.5 9.5L13 13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
        </svg>
        <input v-model="localSearchQuery" :placeholder="t('search_placeholder')">
      </div>
    </div>
    <div class="articles-list" @dragover.prevent @drop.self="emit('drop-root', $event)">
      <!-- Folder Tree Mode -->
      <template v-if="!localSearchQuery.trim()">
        <template v-for="item in visibleTreeItems">
          <!-- Render Folder -->
          <div
            v-if="item.type === 'folder'"
            :key="'folder-' + item.id"
            :class="['tree-item', 'folder-item', { active: activeFolderId === item.id, 'drag-over': dragOverFolderId === item.id }]"
            :style="{ paddingLeft: (item.depth * 14 + 10) + 'px' }"
            @click="emit('toggle-folder', item.id)"
            draggable="true"
            @dragstart="emit('drag-start', item, $event)"
            @dragend="emit('drag-end')"
            @dragover.prevent="emit('drag-over', item, $event)"
            @dragleave="emit('drag-leave')"
            @drop="emit('drop', item, $event)"
          >
            <span :class="['folder-toggle-icon', { expanded: item.isExpanded }]">
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2.5 1.5L5 4L2.5 6.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" class="item-icon-svg color-folder">
              <path d="M1 3.5C1 2.67157 1.67157 2 2.5 2H5.5L7 3.5H11.5C12.3284 3.5 13 4.17157 13 5V11.5C13 12.3284 12.3284 13 11.5 13H2.5C1.67157 13 1 12.3284 1 11.5V3.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" fill="currentColor" fill-opacity="0.1"/>
            </svg>
            
            <div v-if="editingFolderId === item.id" class="folder-name-input-container" @click.stop>
              <input 
                v-model="localEditingFolderName"
                @blur="emit('finish-rename-folder', item.id)"
                @keyup.enter="emit('finish-rename-folder', item.id)"
                @keyup.esc="emit('cancel-rename-folder')"
                ref="folderRenameInput"
                class="folder-rename-input"
              >
            </div>
            <span v-else class="item-name" @dblclick.stop="emit('start-rename-folder', item.id, item.name)">
              {{ item.name }}
            </span>
            
            <div class="item-actions">
              <button class="btn-item-action" @click.stop="emit('create-article-in-folder', item.id)" title="新建文章">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M5 1V9M1 5H9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                </svg>
              </button>
              <button class="btn-item-action" @click.stop="emit('create-folder', item.id)" :title="t('new_subfolder')">
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1 3C1 2.2 1.6 1.6 2.4 1.6H4.8L6 3H9.6C10.4 3 11 3.6 11 4.4V9.6C11 10.4 10.4 11 9.6 11H2.4C1.6 11 1 10.4 1 9.6V3Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
                  <path d="M6 5.5V8.5M4.5 7H7.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                </svg>
              </button>
              <button class="btn-item-action" @click.stop="emit('open-folder-in-explorer', item.id)" title="在文件管理器中打开">
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1.5 4.5V2.5C1.5 2 2 1.5 2.5 1.5H5L6.2 3H9.5C10 3 10.5 3.5 10.5 4V4.5M1.5 4.5H10.5M1.5 4.5L2.7 9.5C2.8 10 3.2 10.5 3.8 10.5H10.2C10.8 10.5 11.2 10 11.3 9.5L12 6C12.1 5.2 11.4 4.5 10.5 4.5H1.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
                </svg>
              </button>
              <button class="btn-item-action" @click.stop="emit('start-rename-folder', item.id, item.name)" title="重命名">
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M7.5 1.5L10.5 4.5M1.5 10.5H4L10 4.5C10.5 4 10.5 3 10 2.5L9.5 2C9 1.5 8 1.5 7.5 2L1.5 8V10.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
                </svg>
              </button>
              <button class="btn-item-action" @click.stop="emit('delete-folder', item.id, item.name)" title="删除">
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1 3H11M3.5 3V1.5C3.5 1.2 3.7 1 4 1H8C8.3 1 8.5 1.2 8.5 1.5V3M2 3V9.5C2 10.3 2.7 11 3.5 11H8.5C9.3 11 10 10.3 10 9.5V3" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
          </div>

          <!-- Render Article -->
          <div
            v-else
            :key="'article-' + item.id"
            :class="['tree-item', 'article-item', { active: activeArticleId === item.id }]"
            :style="{ paddingLeft: (item.depth * 14 + 24) + 'px' }"
            @click="emit('select-article', item.id)"
            draggable="true"
            @dragstart="emit('drag-start', item, $event)"
            @dragend="emit('drag-end')"
          >
            <svg v-if="item.theme === 'image'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" class="item-icon-svg color-image">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            <svg v-else width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" class="item-icon-svg color-file">
              <path d="M8.5 1.5H3C2.17157 1.5 1.5 2.17157 1.5 3V11C1.5 11.8284 2.17157 12.5 3 12.5H11C11.8284 12.5 12.5 11.8284 12.5 11V5.5L8.5 1.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
              <path d="M8.5 1.5V5.5H12.5" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
            </svg>
            <span class="item-name">{{ item.name }}</span>
            <span v-if="item.publishStatus === 'draft'" class="publish-badge" title="已推送至微信公众号草稿箱">已同步</span>
            <button class="btn-delete-article" @click.stop="emit('delete-article', item.id, item.name)">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 3H11M3.5 3V1.5C3.5 1.2 3.7 1 4 1H8C8.3 1 8.5 1.2 8.5 1.5V3M2 3V9.5C2 10.3 2.7 11 3.5 11H8.5C9.3 11 10 10.3 10 9.5V3" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        </template>

        <div v-if="visibleTreeItems.length === 0" class="empty-list-placeholder">
          {{ t('no_articles') }}
        </div>
      </template>

      <!-- Search Mode (Flat matching list) -->
      <template v-else>
        <div 
          v-for="a in filteredArticles" 
          :key="a.id"
          :class="['tree-item', 'article-item', { active: activeArticleId === a.id }]"
          style="padding-left: 12px;"
          @click="emit('select-article', a.id)"
        >
          <svg v-if="a.theme === 'image'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" class="item-icon-svg color-image">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          <svg v-else width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" class="item-icon-svg color-file">
            <path d="M8.5 1.5H3C2.17157 1.5 1.5 2.17157 1.5 3V11C1.5 11.8284 2.17157 12.5 3 12.5H11C11.8284 12.5 12.5 11.8284 12.5 11V5.5L8.5 1.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
            <path d="M8.5 1.5V5.5H12.5" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
          </svg>
          <span class="item-name">{{ a.title || t('untitled') }}</span>
          <span v-if="a.publishStatus === 'draft'" class="publish-badge" title="已推送至微信公众号草稿箱">已同步</span>
          <button class="btn-delete-article" @click.stop="emit('delete-article', a.id, a.title)">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1 3H11M3.5 3V1.5C3.5 1.2 3.7 1 4 1H8C8.3 1 8.5 1.2 8.5 1.5V3M2 3V9.5C2 10.3 2.7 11 3.5 11H8.5C9.3 11 10 10.3 10 9.5V3" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
        <div v-if="filteredArticles.length === 0" class="empty-list-placeholder">
          {{ t('no_articles') }}
        </div>
      </template>
    </div>
  </aside>
</template>

<style scoped>
/* Column 1: Articles list sidebar */
.articles-sidebar {
  width: 260px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  background: #fcfdfe;
  flex-shrink: 0;
}

.sidebar-header {
  padding: 15px;
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.sidebar-header h3 {
  font-size: 13px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-light);
}

.btn-new-article {
  padding: 0 10px;
  height: 28px;
  border-radius: 8px;
  border: 1.5px dashed oklch(80% 0.1 255);
  background: oklch(95% 0.02 255);
  color: oklch(60% 0.18 255);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 5px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.btn-new-article:hover {
  background: oklch(92% 0.05 255);
  border-color: oklch(70% 0.15 255);
  color: oklch(50% 0.2 255);
}

.search-box-wechat {
  padding: 10px 15px;
  border-bottom: 1px solid var(--border);
}

.search-input-wrapper {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
}

.search-icon-svg {
  position: absolute;
  left: 10px;
  color: oklch(60% 0.01 220);
  pointer-events: none;
}

.search-box-wechat input {
  width: 100%;
  padding: 8px 12px 8px 30px;
  border-radius: 8px;
  border: 1px solid oklch(91% 0.01 220);
  font-size: 12px;
  outline: none;
  background: oklch(99% 0 0);
  transition: all 0.2s ease;
}

.search-box-wechat input:focus {
  border-color: oklch(75% 0.12 255);
  box-shadow: 0 0 0 3px oklch(60% 0.18 255 / 0.15);
  background: white;
}

.articles-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
}

/* Sidebar Tree Directory Styles */
.tree-item {
  display: flex;
  align-items: center;
  padding: 8px 10px;
  border-radius: 8px;
  margin-bottom: 2px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  user-select: none;
}

.tree-item:hover {
  background: oklch(96.5% 0.005 220);
}

.tree-item.active {
  background: oklch(95% 0.02 255);
  color: oklch(35% 0.15 255);
  font-weight: 700;
  box-shadow: inset 3px 0 0 oklch(60% 0.18 255);
}

.tree-item .item-icon-svg {
  margin-right: 8px;
  flex-shrink: 0;
}

.color-folder {
  color: oklch(72% 0.13 80); /* warm amber folder color */
}

.color-file {
  color: oklch(55% 0.01 220); /* slate gray-blue file color */
}

.color-image {
  color: oklch(62% 0.16 150); /* premium wechat green image color */
}

.tree-item .item-name {
  font-size: 12.5px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-toggle-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  margin-right: 6px;
  color: oklch(60% 0.01 220);
  cursor: pointer;
  transition: transform 0.2s ease, color 0.2s ease;
  flex-shrink: 0;
}

.folder-toggle-icon.expanded {
  transform: rotate(90deg);
}

.tree-item:hover .folder-toggle-icon {
  color: oklch(35% 0.01 220);
}

.folder-rename-input {
  flex: 1;
  font-size: 13px;
  padding: 2px 6px;
  border: 1.5px solid oklch(60% 0.18 255);
  border-radius: 6px;
  background: white;
  color: var(--text);
  outline: none;
  width: 100%;
  box-sizing: border-box;
}

/* Hover Actions for Folders — hidden by default, shown on hover */
.item-actions {
  display: none;
  align-items: center;
  gap: 4px;
  position: absolute;
  right: 8px;
  background: inherit;
  padding-left: 8px;
}

.tree-item:hover .item-actions {
  display: flex;
}

.btn-item-action {
  background: none;
  border: none;
  color: oklch(55% 0.01 220);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  transition: all 0.2s;
}

.btn-item-action:hover {
  background: oklch(93% 0.01 220);
  color: oklch(40% 0.18 255);
}

.btn-delete-article {
  opacity: 0;
  background: none;
  border: none;
  color: oklch(65% 0.15 25);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: auto;
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.btn-delete-article:hover {
  background: oklch(94% 0.03 25);
  color: oklch(50% 0.18 25);
}

.tree-item:hover .btn-delete-article {
  opacity: 1;
}

/* Rename Folder input layout */
.folder-name-input-container {
  flex: 1;
  display: flex;
  align-items: center;
}

.btn-new-folder {
  background: white;
  border: 1.5px solid oklch(91% 0.01 220);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: oklch(48% 0.02 220);
}

.btn-new-folder:hover {
  background: oklch(97.5% 0.01 255);
  border-color: oklch(84% 0.06 255);
  color: oklch(55% 0.20 255);
}

.tree-item.folder-item.drag-over {
  background: oklch(95% 0.05 145) !important;
  border: 1px dashed var(--success) !important;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}

.publish-badge {
  font-size: 10px;
  color: oklch(50% 0.18 140);
  background: oklch(96% 0.03 140);
  border: 1.2px solid oklch(86% 0.08 140);
  border-radius: 4px;
  padding: 0 4px;
  margin-left: 6px;
  font-weight: 700;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  line-height: 1.4;
}
.empty-list-placeholder {
  padding: 20px 10px;
  text-align: center;
  font-size: 12px;
  color: var(--text-light);
}
</style>

