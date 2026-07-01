import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'
import { currentLang } from './i18n'

export const md = new MarkdownIt({
  html: true,
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
