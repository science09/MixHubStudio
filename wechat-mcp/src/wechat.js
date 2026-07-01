import fetch from "node-fetch";
import { WechatPublisher } from "@wenyan-md/core/publish";
import { createWenyanCore } from "@wenyan-md/core";
import { JSDOM } from "jsdom";
import FormData from "form-data";
import crypto from "crypto";
import { resolveThemeCss } from "./wechatThemeResolver.js";
import {
  adaptWechatBullets,
  adaptWechatFootnotes,
  adaptWechatTables,
  adaptWechatCodeBlocks,
  adaptWechatBlockquotes,
  propagateWechatStyles,
  adaptWechatLinks,
  cleanWechatHtml,
  getCodeThemeId
} from "./wechatHtmlAdapter.js";

// JSDOM setup for DOM/document emulation in Node.js
const jsdom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
const { window } = jsdom;
const { document, DOMParser, XMLSerializer, Node } = window;

global.window = window;
global.document = document;
global.DOMParser = DOMParser;
global.XMLSerializer = XMLSerializer;
global.Node = Node;

// Initialize Wenyan compiler core
const wenyanCore = createWenyanCore();

// Simple memory-based cache for WeChat Access Token
let tokenCache = { token: "", expires: 0 };

async function getAccessToken(appId, appSecret) {
  const now = Date.now();
  if (tokenCache.token && tokenCache.expires > now) {
    return tokenCache.token;
  }
  
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`;
  const res = await fetch(url);
  const data = await res.json();
  
  if (!data.access_token) {
    throw new Error(`获取 Access Token 失败: ${JSON.stringify(data)}`);
  }
  
  tokenCache = {
    token: data.access_token,
    expires: now + (data.expires_in - 300) * 1000 // Cache token, expire 5 minutes early
  };
  return tokenCache.token;
}

// Memory-based cache adapters for WeChat uploading caches
let tokenInMemory = null;
const memoryTokenAdapter = {
  async loadToken() {
    return tokenInMemory;
  },
  async saveToken(tokenCache) {
    tokenInMemory = tokenCache;
  },
  async clearToken() {
    tokenInMemory = null;
  }
};

let cacheInMemory = {};
const memoryCacheAdapter = {
  async loadCache() {
    return cacheInMemory;
  },
  async saveCache(cache) {
    cacheInMemory = cache;
  },
  async clearCache() {
    cacheInMemory = {};
  },
  async calcHash(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }
};

// Node.js native fetch & multi-part adapter for WechatPublisher
const nodeHttpAdapter = {
  async fetch(url, options = {}) {
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body
    });
    
    return {
      ok: res.ok,
      status: res.status,
      async text() { return await res.text() },
      async json() { return await res.json() }
    };
  },
  
  createMultipart(field, fileBuffer, filename) {
    const form = new FormData();
    form.append(field, fileBuffer, { filename });
    return {
      body: form,
      headers: form.getHeaders()
    };
  }
};

// Download helper to fetch online images or fetch local images from transferred base64 map
async function downloadUrl(url, imagesMap = {}) {
  let cleanUrl = url;
  try {
    cleanUrl = decodeURIComponent(url);
  } catch (_) {}

  // Find exact key or key with stripped relative prefixes
  const key = Object.keys(imagesMap).find(k => {
    const kClean = k.replace(/^\.?\//, '');
    const uClean = cleanUrl.replace(/^\.?\//, '');
    return kClean === uClean || k === cleanUrl;
  });

  if (key && imagesMap[key]) {
    const base64Data = imagesMap[key].replace(/^data:image\/\w+;base64,/, "");
    return Buffer.from(base64Data, 'base64');
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download remote image: ${res.statusText}`);
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  throw new Error(`无法下载/获取本地图片内容，请检查该图片是否包含在 images 参数中: ${url}`);
}

// Automatically extract and upload images referenced in HTML
async function uploadImages({
  content,
  accessToken,
  appId,
  imagesMap,
  publisher
}) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/html');
  const images = Array.from(doc.querySelectorAll('img'));
  
  const mediaIds = [];
  let firstImageId = '';

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const src = img.getAttribute('src');
    if (src) {
      if (src.startsWith('https://mmbiz.qpic.cn')) {
        continue;
      }
      
      try {
        const buffer = await downloadUrl(src, imagesMap);
        
        let filename = `image_${i}.jpg`;
        try {
          const urlObj = new URL(src, 'http://localhost');
          const pathSegments = urlObj.pathname.split('/');
          const lastSeg = pathSegments[pathSegments.length - 1];
          if (lastSeg && lastSeg.includes('.')) {
            filename = lastSeg;
          }
        } catch (_) {}
        
        const data = await publisher.uploadImage(buffer, filename, accessToken, appId);
        img.setAttribute('src', data.url);
        mediaIds.push(data.media_id);
        if (!firstImageId) {
          firstImageId = data.media_id;
        }
      } catch (err) {
        console.error(`Failed to upload image ${src}:`, err);
        throw new Error(`图片上传失败 [${src}]：${err.message || err}`);
      }
    }
  }
  
  return { html: doc.body.innerHTML, firstImageId: firstImageId || mediaIds[0] || '' };
}

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

// Parse YAML frontmatter metadata
export const parseFrontmatter = (content) => {
  const result = { attributes: {}, body: content || '' };
  if (!content) return result;

  const lines = content.split(/\r?\n/);
  let inFrontmatter = false;
  let frontmatterChecked = false;
  let frontmatterLines = [];
  let contentLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '---') {
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
      frontmatterLines.push(line);
    } else {
      if (!frontmatterChecked && trimmed !== '') {
        frontmatterChecked = true;
      }
      if (frontmatterChecked) {
        contentLines.push(line);
      }
    }
  }

  frontmatterLines.forEach(line => {
    const parts = line.split(':');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const value = parts.slice(1).join(':').trim();
      result.attributes[key] = value;
    }
  });

  if (frontmatterChecked && frontmatterLines.length > 0) {
    result.body = contentLines.join('\n');
  }

  return result;
};

// WeChat publishing entrypoint
export async function publishToWechat(args) {
  const appId = args.app_id || process.env.WECHAT_APP_ID;
  const appSecret = args.app_secret || process.env.WECHAT_APP_SECRET;
  
  if (!appId || !appSecret) {
    throw new Error("缺少微信公众号 AppID 或 AppSecret，请检查输入或环境变量！");
  }
  
  const token = await getAccessToken(appId, appSecret);
  
  const publisher = new WechatPublisher(
    nodeHttpAdapter,
    memoryTokenAdapter,
    memoryCacheAdapter
  );

  const { title: extractedTitle, content: preprocessedMarkdown } = preprocessMarkdown(args.markdown, args.strip_first_h1 !== false);
  const { attributes, body } = parseFrontmatter(preprocessedMarkdown);
  const rawHtml = await wenyanCore.renderMarkdown(body);
  const themeCss = await resolveThemeCss(args.theme || 'fresh-green');
  
  const container = document.createElement('div');
  container.innerHTML = `<div id="wenyan">${rawHtml}</div>`;
  await wenyanCore.applyStylesWithTheme(container, {
    themeCss: themeCss,
    hlThemeId: getCodeThemeId(themeCss),
    isAddFootnote: args.add_footnote !== false,
    isMacStyle: true
  });
  
  adaptWechatBullets(container, themeCss);
  adaptWechatFootnotes(container, themeCss);
  adaptWechatTables(container);
  adaptWechatCodeBlocks(container, themeCss);
  adaptWechatBlockquotes(container);
  propagateWechatStyles(container);
  adaptWechatLinks(container);
  
  const { html, firstImageId } = await uploadImages({
    content: container.innerHTML,
    accessToken: token,
    appId: appId,
    imagesMap: args.images || {},
    publisher
  });
  
  let coverMediaId = '';
  const publishCover = attributes.cover || '';
  if (publishCover) {
    try {
      const coverBuffer = await downloadUrl(publishCover, args.images || {});
      let coverFilename = 'cover.jpg';
      try {
        const urlObj = new URL(publishCover, 'http://localhost');
        const lastSeg = urlObj.pathname.split('/').pop();
        if (lastSeg && lastSeg.includes('.')) coverFilename = lastSeg;
      } catch (_) {}
      
      const coverData = await publisher.uploadImage(coverBuffer, coverFilename, token, appId);
      coverMediaId = coverData.media_id;
    } catch (err) {
      console.error('Failed to upload cover from frontmatter:', err);
      throw new Error(`封面图片上传失败 [${publishCover}]：${err.message || err}`);
    }
  }
  
  const thumbMediaId = coverMediaId || firstImageId || args.cover_media_id;
  if (!thumbMediaId) {
    throw new Error('微信公众平台草稿箱发布要求：文章必须包含至少一张图片作为封面。请在正文中插入图片或配置 frontmatter 中的 cover 图片，或者在参数中提供 cover_media_id！');
  }
  
  const publishTitle = attributes.title || args.title || extractedTitle || '无标题文章';
  const cleanedHtml = cleanWechatHtml(html);
  
  const res = await publisher.publishToDraft(token, {
    title: publishTitle,
    content: cleanedHtml,
    thumb_media_id: thumbMediaId,
    author: attributes.author || 'OneInk MCP'
  });
  
  if (res.media_id) {
    return res;
  } else {
    throw new Error(`微信接口返回错误: ${JSON.stringify(res)}`);
  }
}
