import { invoke } from '@tauri-apps/api/core'
import { WechatPublisher } from '@wenyan-md/core/publish'
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
} from './wechatHtmlAdapter'
import { resolveThemeCss } from './wechatThemeResolver'

// Preprocess markdown: strip ignored blocks and extract first H1 as title
export const preprocessMarkdown = (content, stripFirstH1 = true) => {
  if (!content) return { title: '', content: '' };

  let processed = content;

  // 1. Strip blocks wrapped in <!-- wechat-ignore-start --> ... <!-- wechat-ignore-end -->
  processed = processed.replace(/<!--\s*wechat-ignore-start\s*-->[\s\S]*?<!--\s*wechat-ignore-end\s*-->/gi, '');
  processed = processed.replace(/<!--\s*wechat-hide-start\s*-->[\s\S]*?<!--\s*wechat-hide-end\s*-->/gi, '');

  // 2. Skip YAML frontmatter to find the first H1
  let extractedTitle = '';
  if (stripFirstH1) {
    const lines = processed.split('\n');
    let inFrontmatter = false;
    let frontmatterChecked = false;
    let firstH1Index = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Check for frontmatter markers
      if (line === '---') {
        if (!inFrontmatter && !frontmatterChecked) {
          inFrontmatter = true;
          continue;
        } else if (inFrontmatter) {
          inFrontmatter = false;
          frontmatterChecked = true;
          continue;
        }
      }

      if (inFrontmatter) {
        continue;
      }

      if (line.startsWith('# ')) {
        firstH1Index = i;
        extractedTitle = line.substring(2).trim();
        break;
      } else if (line !== '' && !line.startsWith('<!--') && !line.endsWith('-->')) {
        // Found actual content before H1, so H1 is not the first element
        break;
      }
    }

    if (firstH1Index !== -1) {
      lines.splice(firstH1Index, 1);
      processed = lines.join('\n');
    }
  }

  return {
    title: extractedTitle,
    content: processed
  };
};

// Helper to parse frontmatter (cloned from original codebase)
export const parseFrontmatter = (content) => {
  const result = { attributes: {}, body: content || '' }
  if (!content) return result

  const lines = content.split(/\r?\n/)
  let inFrontmatter = false
  let frontmatterChecked = false
  let frontmatterLines = []
  let contentLines = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed === '---') {
      if (!inFrontmatter && !frontmatterChecked) {
        inFrontmatter = true
        continue
      } else if (inFrontmatter) {
        inFrontmatter = false
        frontmatterChecked = true
        continue
      }
    }

    if (inFrontmatter) {
      frontmatterLines.push(line)
    } else {
      if (!frontmatterChecked && trimmed !== '') {
        frontmatterChecked = true
      }
      if (frontmatterChecked) {
        contentLines.push(line)
      }
    }
  }

  frontmatterLines.forEach(line => {
    const parts = line.split(':')
    if (parts.length >= 2) {
      const key = parts[0].trim()
      const value = parts.slice(1).join(':').trim()
      result.attributes[key] = value
    }
  })

  if (frontmatterChecked && frontmatterLines.length > 0) {
    result.body = contentLines.join('\n')
  }

  return result
}

// Custom HttpAdapter that handles binary and form data proxying through Rust Tauri backend to bypass CORS
export const tauriHttpAdapter = {
  async fetch(url, options = {}) {
    let body = options.body
    let isMultipart = false
    let files = []

    if (body instanceof FormData) {
      isMultipart = true
      const formDataEntries = []
      for (const [key, value] of body.entries()) {
        if (value instanceof File || value instanceof Blob) {
          const arrayBuffer = await value.arrayBuffer()
          const bytes = new Uint8Array(arrayBuffer)
          const binaryArray = Array.from(bytes)
          files.push({
            field: key,
            name: value.name || 'file.jpg',
            data: binaryArray,
            mime: value.type || 'image/jpeg'
          })
        } else {
          formDataEntries.push({ key, value: String(value) })
        }
      }
      body = JSON.stringify({ fields: formDataEntries })
    }

    const response = await invoke('wechat_http_request', {
      url,
      method: options.method || 'GET',
      headers: options.headers || {},
      body: body || '',
      isMultipart,
      files
    })

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      async text() { return response.text },
      async json() { return JSON.parse(response.text) }
    }
  },

  createMultipart(field, file, filename) {
    const form = new FormData()
    form.append(field, file, filename)
    return { body: form }
  }
}

export const localStorageTokenAdapter = {
  async loadToken() {
    const data = localStorage.getItem('wechat_token_cache')
    return data ? JSON.parse(data) : null
  },
  async saveToken(tokenCache) {
    localStorage.setItem('wechat_token_cache', JSON.stringify(tokenCache))
  },
  async clearToken() {
    localStorage.removeItem('wechat_token_cache')
  }
}

export const localStorageCacheAdapter = {
  async loadCache() {
    const data = localStorage.getItem('wechat_upload_cache')
    return data ? JSON.parse(data) : {}
  },
  async saveCache(cache) {
    localStorage.setItem('wechat_upload_cache', JSON.stringify(cache))
  },
  async clearCache() {
    localStorage.removeItem('wechat_upload_cache')
  },
  async calcHash(buffer) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }
}

// Convert SVG blob to PNG raster via Canvas API
export const svgBlobToPng = (svgBlob) => new Promise((resolve, reject) => {
  const typedBlob = (svgBlob.type && svgBlob.type.includes('svg'))
    ? svgBlob
    : new Blob([svgBlob], { type: 'image/svg+xml' })
  const objectUrl = URL.createObjectURL(typedBlob)
  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || 900
    canvas.height = img.naturalHeight || 500
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0)
    URL.revokeObjectURL(objectUrl)
    canvas.toBlob(
      (pngBlob) => pngBlob ? resolve(pngBlob) : reject(new Error('canvas.toBlob returned null')),
      'image/png'
    )
  }
  img.onerror = () => {
    URL.revokeObjectURL(objectUrl)
    reject(new Error('无法将 SVG 加载到 Image 元素'))
  }
  img.src = objectUrl
})

// Detect if binary bytes match WebP format (RIFF at offset 0, WEBP at offset 8)
export const isWebpBytes = (bytes) => {
  if (bytes.length < 12) return false
  const riff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
  const webp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  return riff && webp
}

// Convert any image blob to PNG raster via Canvas API
export const convertToPngBlob = (imageBlob) => new Promise((resolve, reject) => {
  const objectUrl = URL.createObjectURL(imageBlob)
  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || img.width || 800
    canvas.height = img.naturalHeight || img.height || 600
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    URL.revokeObjectURL(objectUrl)
    canvas.toBlob(
      (pngBlob) => pngBlob ? resolve(pngBlob) : reject(new Error('canvas.toBlob returned null')),
      'image/png'
    )
  }
  img.onerror = () => {
    URL.revokeObjectURL(objectUrl)
    reject(new Error('无法将图片加载到 Image 元素进行转换'))
  }
  img.src = objectUrl
})

export const getMimeTypeFromUrl = (url) => {
  if (!url) return 'image/png'
  try {
    const pathname = new URL(url, window.location.href).pathname
    const ext = pathname.split('.').pop().toLowerCase()
    const mimeMap = {
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'svg': 'image/svg+xml'
    }
    return mimeMap[ext] || 'image/png'
  } catch (_) {
    const ext = url.split('.').pop().split('?')[0].toLowerCase()
    const mimeMap = {
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'svg': 'image/svg+xml'
    }
    return mimeMap[ext] || 'image/png'
  }
}

export const getFilenameFromUrl = (url) => {
  if (!url) return 'file.png'
  try {
    const pathname = new URL(url, window.location.href).pathname
    const filename = pathname.split('/').pop()
    return filename || 'file.png'
  } catch (_) {
    const filename = url.split('/').pop().split('?')[0]
    return filename || 'file.png'
  }
}

// Download remote URL bytes via Tauri backend or local fetch fallback
export const downloadUrl = async (url) => {
  if (!url) throw new Error('URL is empty')

  const isAssetUrl = url.includes('asset.localhost') || url.includes('asset.tauri.localhost') || url.startsWith('asset:') || url.startsWith('tauri:')
  const isDirectLocalPath = url.startsWith('/') || /^[a-zA-Z]:/.test(url)

  if (isAssetUrl || isDirectLocalPath) {
    try {
      let localPath = url
      if (isAssetUrl) {
        const urlObj = new URL(url)
        localPath = decodeURIComponent(urlObj.pathname)
        if (/^\/[a-zA-Z]:/.test(localPath)) {
          localPath = localPath.substring(1)
        }
      }
      const bytes = await invoke('read_local_file', { path: localPath })
      const mime = getMimeTypeFromUrl(localPath)
      const filename = getFilenameFromUrl(localPath)
      return new File([new Uint8Array(bytes)], filename, { type: mime })
    } catch (err) {
      console.error('Failed to read local file bytes:', url, err)
    }
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      const bytes = await invoke('download_remote_file', { url })
      const mime = getMimeTypeFromUrl(url)
      const filename = getFilenameFromUrl(url)
      return new File([new Uint8Array(bytes)], filename, { type: mime })
    } catch (e) {
      console.warn('Tauri remote download failed, falling back to browser fetch:', e)
    }
  }

  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP status ${res.status}`)
  const blob = await res.blob()
  const mime = blob.type || getMimeTypeFromUrl(url)
  const filename = getFilenameFromUrl(url)
  return new File([blob], filename, { type: mime })
}

// Auto extract and upload all images to WeChat CDN
export const uploadImages = async ({
  content,
  accessToken,
  appId,
  resolveLocalPath,
  onProgress = null
}) => {
  const parser = new DOMParser()
  const doc = parser.parseFromString(content, 'text/html')
  const images = Array.from(doc.querySelectorAll('img'))

  const mediaIds = []
  let firstImageId = ''

  const publisher = new WechatPublisher(
    tauriHttpAdapter,
    localStorageTokenAdapter,
    localStorageCacheAdapter
  )

  for (let i = 0; i < images.length; i++) {
    const img = images[i]
    const src = img.getAttribute('src')
    if (src) {
      if (src.startsWith('https://mmbiz.qpic.cn')) {
        continue
      }

      try {
        if (onProgress) {
          onProgress(`上传图片 (${i + 1}/${images.length})...`)
        }

        const resolvedSrc = resolveLocalPath(src)
        const blob = await downloadUrl(resolvedSrc)

        let filename = `image_${i}.jpg`
        try {
          const urlObj = new URL(src, window.location.href)
          const pathSegments = urlObj.pathname.split('/')
          const lastSeg = pathSegments[pathSegments.length - 1]
          if (lastSeg && lastSeg.includes('.')) {
            filename = lastSeg
          }
        } catch (_) { }

        let uploadBlob = blob
        let uploadFilename = filename
        
        const arrayBuffer = await blob.arrayBuffer()
        const uint8Bytes = new Uint8Array(arrayBuffer)
        const isWebp = isWebpBytes(uint8Bytes)
        const isSvg = /\.svg(\?.*)?$/i.test(src) || (blob.type && blob.type.includes('svg'))

        if (isWebp || isSvg) {
          try {
            const reason = isWebp ? 'WebP 转 PNG' : 'SVG 转 PNG'
            if (onProgress) {
              onProgress(`${reason} (${i + 1}/${images.length})...`)
            }
            if (isWebp) {
              uploadBlob = await convertToPngBlob(blob)
              uploadFilename = filename.replace(/\.(webp|png|jpg|jpeg)$/i, '.png')
            } else {
              uploadBlob = await svgBlobToPng(blob)
              uploadFilename = filename.replace(/\.svg$/i, '.png')
            }
          } catch (convErr) {
            console.warn('图片转换失败，上传原图:', convErr)
          }
        }

        const data = await publisher.uploadImage(uploadBlob, uploadFilename, accessToken, appId)
        img.setAttribute('src', data.url)
        mediaIds.push(data.media_id)
        if (!firstImageId) {
          firstImageId = data.media_id
        }
      } catch (err) {
        console.error(`Failed to upload image ${src}:`, err)
        throw new Error(`图片上传失败 [${src}]：${err.message || err}。请检查网络或更换图片。`)
      }
    }
  }

  return { html: doc.body.innerHTML, firstImageId: firstImageId || mediaIds[0] || '' }
}

// Publish to WeChat Draft Box
export const publishToWechatDraft = async ({
  title,
  content,
  selectedTheme,
  isAddFootnote,
  wenyanCore,
  wechatSettings,
  resolveLocalPath,
  onProgress,
  alert
}) => {
  if (!wechatSettings.WECHAT_APP_ID || !wechatSettings.WECHAT_APP_SECRET) {
    alert('请先在“系统设置”页面配置微信公众号的 AppID 和 AppSecret！')
    return false
  }

  onProgress('正在获取 Access Token...')
  const publisher = new WechatPublisher(
    tauriHttpAdapter,
    localStorageTokenAdapter,
    localStorageCacheAdapter
  )

  const token = await publisher.getAccessTokenWithCache(
    wechatSettings.WECHAT_APP_ID,
    wechatSettings.WECHAT_APP_SECRET
  )

  onProgress('渲染文章内容...')
  const { title: extractedTitle, content: preprocessedMarkdown } = preprocessMarkdown(content, true)
  const { attributes, body } = parseFrontmatter(preprocessedMarkdown)
  const rawHtml = await wenyanCore.renderMarkdown(body)
  const themeCss = await resolveThemeCss(selectedTheme)

  const container = document.createElement('div')
  container.innerHTML = `<div id="wenyan">${rawHtml}</div>`
  await wenyanCore.applyStylesWithTheme(container, {
    themeCss: themeCss,
    hlThemeId: getCodeThemeId(themeCss),
    isAddFootnote: isAddFootnote,
    isMacStyle: true
  })

  adaptWechatBullets(container, themeCss)
  adaptWechatFootnotes(container, themeCss)
  adaptWechatTables(container)
  adaptWechatCodeBlocks(container, themeCss)
  adaptWechatBlockquotes(container)
  propagateWechatStyles(container)
  adaptWechatLinks(container)

  onProgress('自动上传文章图片...')
  const { html, firstImageId } = await uploadImages({
    content: container.innerHTML,
    accessToken: token,
    appId: wechatSettings.WECHAT_APP_ID,
    resolveLocalPath,
    onProgress
  })

  let coverMediaId = ''
  const publishCover = attributes.cover || ''
  if (publishCover) {
    onProgress('上传封面图...')
    try {
      const resolvedCover = resolveLocalPath(publishCover)
      const coverBlob = await downloadUrl(resolvedCover)
      let coverFilename = 'cover.jpg'
      try {
        const urlObj = new URL(publishCover)
        const lastSeg = urlObj.pathname.split('/').pop()
        if (lastSeg && lastSeg.includes('.')) coverFilename = lastSeg
      } catch (_) { }

      let uploadCoverBlob = coverBlob
      let uploadCoverFilename = coverFilename
      const isCoverSvg = /\.svg(\?.*)?$/i.test(publishCover) || (coverBlob.type && coverBlob.type.includes('svg'))
      if (isCoverSvg) {
        onProgress('封面 SVG 转 PNG...')
        uploadCoverBlob = await svgBlobToPng(coverBlob)
        uploadCoverFilename = coverFilename.replace(/\.svg$/i, '.png')
      }

      const coverData = await publisher.uploadImage(uploadCoverBlob, uploadCoverFilename, token, wechatSettings.WECHAT_APP_ID)
      coverMediaId = coverData.media_id
    } catch (err) {
      console.error('Failed to upload cover from frontmatter:', err)
      throw new Error(`封面图片上传失败 [${publishCover}]：${err.message || err}。请检查网络或更换封面图。`)
    }
  }

  const thumbMediaId = coverMediaId || firstImageId
  if (!thumbMediaId) {
    throw new Error('微信公众平台草稿箱发布要求：文章必须包含至少一张图片作为封面。请配置封面图或在正文中插入图片。')
  }

  onProgress('正在推送草稿箱...')
  const publishTitle = attributes.title || title || extractedTitle || '无标题文章'
  const cleanedHtml = cleanWechatHtml(html)
  const res = await publisher.publishToDraft(token, {
    title: publishTitle,
    content: cleanedHtml,
    thumb_media_id: thumbMediaId,
    author: 'MixHub Studio'
  })

  if (res.media_id) {
    alert('🎉 成功推送至微信公众号草稿箱！你可以登录微信公众平台后台查看和群发。')
    return { success: true, media_id: res.media_id }
  } else {
    throw new Error(JSON.stringify(res))
  }
}

// WeChat Formatted copy utility
export const copyPlatform = async (platform, {
  content,
  title,
  selectedTheme,
  isAddFootnote,
  wenyanCore,
  wechatSettings,
  t,
  resolveLocalPath,
  onProgressStart,
  onProgressUpdate,
  onProgressEnd,
  alert,
  copyWithEvent,
  lastRenderedWechatHtml
}) => {
  if (platform === 'markdown') {
    try {
      await navigator.clipboard.writeText(content)
      alert('Markdown ' + t('copy_success'))
    } catch (err) {
      console.error('Failed to copy Markdown:', err)
    }
    return
  }

  if (!wenyanCore) {
    alert('编辑器仍在初始化中，请稍候...')
    return
  }

  let styledHtml = ''
  let uploadStatusStr = ''
  let hasSvgs = false

  try {
    const { content: preprocessedMarkdown } = preprocessMarkdown(content, true)
    const { body } = parseFrontmatter(preprocessedMarkdown)
    const rawHtml = await wenyanCore.renderMarkdown(body)

    const container = document.createElement('div')
    container.innerHTML = `<div id="wenyan">${rawHtml}</div>`

    let themeId = selectedTheme
    if (platform === 'zhihu') {
      themeId = 'lapis'
    }

    const themeCss = await resolveThemeCss(themeId)

    await wenyanCore.applyStylesWithTheme(container, {
      themeCss: themeCss,
      hlThemeId: getCodeThemeId(themeCss),
      isAddFootnote: isAddFootnote,
      isMacStyle: true
    })

    adaptWechatBullets(container, themeCss)
    adaptWechatFootnotes(container, themeCss)
    adaptWechatTables(container)
    adaptWechatCodeBlocks(container, themeCss)
    adaptWechatBlockquotes(container)
    propagateWechatStyles(container)
    if (platform === 'wechat') {
      adaptWechatLinks(container)
    }

    hasSvgs = Array.from(container.querySelectorAll('img')).some(img => {
      const src = img.getAttribute('src') || ''
      return /\.svg(\?.*)?$/i.test(src) || src.includes('image/svg+xml')
    })

    if (platform === 'wechat') {
      try {
        if (wechatSettings.WECHAT_APP_ID && wechatSettings.WECHAT_APP_SECRET) {
          onProgressStart('检测到微信配置，正在自动上传图片至微信 CDN...')

          const publisher = new WechatPublisher(
            tauriHttpAdapter,
            localStorageTokenAdapter,
            localStorageCacheAdapter
          )
          const token = await publisher.getAccessTokenWithCache(
            wechatSettings.WECHAT_APP_ID,
            wechatSettings.WECHAT_APP_SECRET
          )
          if (token) {
            const { html } = await uploadImages({
              content: container.innerHTML,
              accessToken: token,
              appId: wechatSettings.WECHAT_APP_ID,
              resolveLocalPath,
              onProgress: onProgressUpdate
            })
            container.innerHTML = html
            uploadStatusStr = '（已自动将图片及 SVG 转换并上传至微信 CDN）'
          }
        }
      } catch (uploadErr) {
        console.warn('Auto image upload on copy failed:', uploadErr)
      } finally {
        onProgressEnd()
      }
    }

    styledHtml = platform === 'wechat' ? cleanWechatHtml(container.innerHTML) : container.innerHTML
  } catch (err) {
    console.error('Failed to render rich text for copy:', err)
    onProgressEnd()
  }

  if (styledHtml) {
    let successMsg = t('copy_success')
    if (platform === 'wechat') {
      if (uploadStatusStr) {
        successMsg += '\n' + uploadStatusStr
      } else if (hasSvgs) {
        successMsg += '\n\n⚠️ 检测到文章包含 SVG 矢量图，直接粘贴可能在微信中显示为黑块。建议您：\n1. 直接使用底部的“推送草稿”功能发布（会自动将 SVG 转换为 PNG 并上传）；\n2. 或在微信公众号后台【设置】-【公众号设置】-【功能设置】里，将“图片水印”设为【不添加】后重新复制粘贴。'
      }
    }

    const plainText = platform === 'html' ? styledHtml : content

    try {
      await invoke('copy_html_to_clipboard', { html: styledHtml, plain: plainText })
      alert(successMsg)
      return
    } catch (nativeErr) {
      console.warn('Native clipboard copy failed or not supported, falling back to browser copy:', nativeErr)
    }

    const success = copyWithEvent(styledHtml, plainText)
    if (success) {
      alert(successMsg)
      return
    }

    try {
      const type = "text/html"
      const blob = new Blob([styledHtml], { type })
      const data = [new ClipboardItem({ [type]: blob, "text/plain": new Blob([plainText], { type: "text/plain" }) })]
      await navigator.clipboard.write(data)
      alert(successMsg)
      return
    } catch (err) {
      console.error('Fallback navigator.clipboard.write failed:', err)
    }
  }

  try {
    const fallbackHtml = lastRenderedWechatHtml || content
    const success = copyWithEvent(fallbackHtml, content)
    if (success) {
      alert(t('copy_success'))
    } else {
      throw new Error('Fallback copy failed')
    }
  } catch (fallbackErr) {
    navigator.clipboard.writeText(content)
    alert(t('copy_btn') + ' ' + t('copied'))
  }
}
