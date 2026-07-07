import { getTheme } from '@wenyan-md/core'

// Themes list matching the official wenyan themes
export const themesList = [
  { id: 'fresh-green', name: '默认' },
  { id: 'aurora', name: '极光简约' },
  { id: 'orangeheart', name: 'Orange Heart' },
  { id: 'rainbow', name: 'Rainbow' },
  { id: 'lapis', name: 'Lapis' },
  { id: 'pie', name: 'Pie' },
  { id: 'maize', name: 'Maize' },
  { id: 'purple', name: 'Purple' },
  { id: 'phycat', name: '物理猫-薄荷' },
  { id: 'sports', name: '运动风' },
  { id: 'chinese', name: '中国风' }
]

export const resolveThemeCss = async (themeId) => {
  let css = ''
  if (themeId === 'sports') {
    css = `
    #wenyan {
      --theme-primary: #00A968;
      max-width: 677px;
      margin: 0 auto;
      padding: 12px;
      background-color: #ffffff;
      font-family: 'Titillium Web', 'SF Pro Display', -apple-system-font, BlinkMacSystemFont, 'Helvetica Neue', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
      color: #2c2c2c;
      line-height: 1.7;
      font-size: 16px;
      border-radius: 16px;
    }
    #wenyan p {
      margin: 1.3em 0;
      letter-spacing: 0.02em;
      color: #2c2c2c;
      text-align: justify;
      line-height: 1.8;
      font-size: 16px;
    }
    #wenyan h1 {
      padding: 0.6em 1.5em;
      margin: 2.2em 0 1.2em;
      color: #ffffff;
      font-size: 22px;
      font-weight: 700;
      text-align: center;
      letter-spacing: 0.12em;
      line-height: 1.4;
      background: linear-gradient(120deg, #00A968, #008A56, #00A968, #00A968);
      border-radius: 50px;
      box-shadow: 0 8px 20px rgba(0, 169, 104, 0.3);
      text-transform: uppercase;
      font-family: 'Titillium Web', sans-serif;
    }
    #wenyan h2 {
      padding: 0.4em 1em 0.5em 1em;
      margin: 1.6em 0 0.8em;
      font-size: 20px;
      font-weight: 600;
      text-align: left;
      letter-spacing: 0.06em;
      line-height: 1.4;
      color: #00A968;
      background: linear-gradient(to right, rgba(0, 169, 104, 0.05), rgba(56, 198, 244, 0.05));
      border-left: 4px solid;
      border-image: linear-gradient(to bottom, #FF6600, #00A968, #38C6F4) 1;
      border-radius: 0 12px 12px 0;
      box-shadow: 0 3px 8px rgba(0, 169, 104, 0.12);
      text-transform: uppercase;
      font-family: 'Titillium Web', sans-serif;
    }
    #wenyan h3 {
      padding: 0.6em 1.2em;
      margin: 1.8em 0 1em;
      color: #00A968;
      font-size: 18px;
      font-weight: 600;
      text-align: left;
      letter-spacing: 0.08em;
      border-left: 4px solid;
      border-image: linear-gradient(to bottom, #FF6600, #00A968, #38C6F4) 1;
      background: linear-gradient(to right, rgba(255, 102, 0, 0.05), rgba(0, 169, 104, 0.05));
      border-radius: 0 25px 25px 0;
      font-family: 'Titillium Web', sans-serif;
    }
    #wenyan h4 {
      padding: 0.3em 1em;
      margin: 1.6em 0 0.8em;
      color: #00A968;
      font-size: 16px;
      font-weight: 600;
      text-align: left;
      letter-spacing: 0.06em;
      border-left: 3px solid;
      border-image: linear-gradient(to bottom, #FF6600, #00A968, #38C6F4) 1;
      background: rgba(56, 198, 244, 0.08);
      border-radius: 0 20px 20px 0;
      font-family: 'Titillium Web', sans-serif;
    }
    #wenyan h5 {
      padding: 0.2em 0.8em;
      margin: 1.4em 0 0.6em;
      color: #00A968;
      font-size: 15px;
      font-weight: 600;
      text-align: left;
      letter-spacing: 0.04em;
      border-left: 2px solid;
      border-image: linear-gradient(to bottom, #FF6600, #00A968, #38C6F4) 1;
      font-family: 'Titillium Web', sans-serif;
    }
    #wenyan h6 {
      padding: 0.1em 0.6em;
      margin: 1.2em 0 0.5em;
      color: #00A968;
      font-size: 14px;
      font-weight: 600;
      text-align: left;
      border-left: 2px solid;
      border-image: linear-gradient(to bottom, #FF6600, #00A968, #38C6F4) 1;
      font-family: 'Titillium Web', sans-serif;
    }
    #wenyan blockquote {
      font-style: normal;
      padding: 1.2em 1.5em;
      border-left: 5px solid;
      border-image: linear-gradient(to bottom, #FF6600, #00A968, #38C6F4) 1;
      color: #3c3c3e;
      background: #f8f8f8;
      border-radius: 0 8px 8px 0;
      margin: 1.8em 0;
    }
    #wenyan blockquote p {
      margin: 0;
      color: #3c3c3e;
      line-height: 1.8;
    }
    #wenyan blockquote.note {
      margin: 1.5em 0 2em;
      padding: 1.2em 1.5em;
      background: linear-gradient(135deg, rgba(56, 198, 244, 0.08), rgba(255, 255, 255, 0.95));
      border-left: 4px solid #38C6F4;
      border: 1px solid rgba(56, 198, 244, 0.3);
      border-radius: 0 12px 12px 0;
      color: rgb(60, 60, 60);
    }
    #wenyan blockquote.tip {
      margin: 1.5em 0 2em;
      padding: 1.2em 1.5em;
      background: linear-gradient(135deg, rgba(0, 169, 104, 0.08), rgba(255, 255, 255, 0.95));
      border-left: 4px solid #00A968;
      border: 1px solid rgba(0, 169, 104, 0.3);
      border-radius: 0 12px 12px 0;
      color: rgb(60, 60, 60);
    }
    #wenyan blockquote.important {
      margin: 1.5em 0 2em;
      padding: 1.2em 1.5em;
      background: linear-gradient(135deg, rgba(255, 102, 0, 0.08), rgba(255, 255, 255, 0.95));
      border-left: 4px solid;
      border-image: linear-gradient(to bottom, #FF6600, #00A968) 1;
      border-radius: 0 12px 12px 0;
      color: rgb(60, 60, 60);
    }
    #wenyan blockquote.warning {
      margin: 1.5em 0 2em;
      padding: 1.2em 1.5em;
      background: linear-gradient(135deg, rgba(255, 102, 0, 0.08), rgba(255, 255, 255, 0.95));
      border-left: 4px solid #FF6600;
      border: 1px solid rgba(255, 102, 0, 0.3);
      border-radius: 0 12px 12px 0;
      color: rgb(60, 60, 60);
    }
    #wenyan blockquote.caution {
      margin: 1.5em 0 2em;
      padding: 1.2em 1.5em;
      background: linear-gradient(135deg, rgba(255, 102, 0, 0.08), rgba(255, 255, 255, 0.95));
      border-left: 4px solid #FF6600;
      border: 1px solid rgba(255, 102, 0, 0.3);
      border-radius: 0 12px 12px 0;
      color: rgb(60, 60, 60);
    }
    #wenyan strong {
      font-weight: 700;
      background: linear-gradient(135deg, #00A968, #008A56, #00A968, #00A968);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      text-shadow: none;
    }
    #wenyan em {
      color: #00A968;
      font-style: italic;
      font-weight: 500;
    }
    #wenyan a {
      color: #00A968;
      text-decoration: none;
      border-bottom: 1px solid #00A968;
      background: linear-gradient(135deg, #00A968, #008A56, #00A968, #00A968);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      border-image: linear-gradient(to right, rgba(255, 102, 0, 0), #FF6600, #00A968, #38C6F4, rgba(56, 198, 244, 0)) 1;
      transition: all 0.3s ease;
    }
    #wenyan hr {
      height: 3px;
      border: none;
      margin: 3em 0;
      background-image: linear-gradient(to right, rgba(255, 102, 0, 0), #FF6600, #00A968, #38C6F4, rgba(56, 198, 244, 0));
    }
    #wenyan code {
      display: inline-block;
      font-size: 90%;
      color: #008a56;
      background: linear-gradient(135deg, rgba(255, 102, 0, 0.12), rgba(0, 169, 104, 0.12), rgba(56, 198, 244, 0.12));
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid rgba(0, 169, 104, 0.16);
      font-family: 'JetBrains Mono', 'SFMono-Regular', Consolas, Menlo, monospace;
      line-height: 1.4;
      font-weight: 600;
    }
    #wenyan pre {
      display: block;
      box-sizing: border-box;
      font-size: 14px;
      overflow-x: auto;
      border-radius: 18px 28px 18px 28px;
      padding: 1.15em 1.2em 1.2em;
      line-height: 1.65;
      margin: 1.5em 0;
      background: linear-gradient(135deg, rgba(255, 102, 0, 0.16) 0px, rgba(0, 169, 104, 0.14) 16px, rgba(56, 198, 244, 0.12) 32px, #ffffff 32px, #ffffff 100%);
      border: 1px solid rgba(0, 169, 104, 0.16);
      box-shadow: 0 14px 30px rgba(0, 0, 0, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.9);
    }
    #wenyan pre code {
      background: none;
      padding: 0;
      font-family: 'JetBrains Mono', 'SFMono-Regular', Consolas, Menlo, monospace;
      font-size: 14px;
      color: #1f2937;
      line-height: 1.65;
    }
    #wenyan ul {
      list-style: none;
      padding: 0;
      margin: 1.5em 0;
      color: #2c2c2c;
      font-size: 16px;
    }
    #wenyan ul li {
      margin: 0.3em 0;
      padding: 0 0 0 1.2em;
      line-height: 1.8;
      font-size: 16px;
      position: relative;
    }
    #wenyan ul li::before {
      content: "·";
      color: #00A968;
      font-size: 1.4em;
      font-weight: bold;
      position: absolute;
      left: 0.2em;
      top: -0.15em;
    }
    #wenyan ul li:has(h1),
    #wenyan ul li:has(h2),
    #wenyan ul li:has(h3),
    #wenyan ul li:has(h4),
    #wenyan ul li:has(h5),
    #wenyan ul li:has(h6) {
      display: flex !important;
      align-items: center !important;
      padding-left: 0 !important;
    }
    #wenyan ul li:has(h1)::before,
    #wenyan ul li:has(h2)::before,
    #wenyan ul li:has(h3)::before,
    #wenyan ul li:has(h4)::before,
    #wenyan ul li:has(h5)::before,
    #wenyan ul li:has(h6)::before {
      position: static !important;
      margin-right: 8px !important;
      margin-left: 4px !important;
      transform: none !important;
      display: inline-block !important;
      flex-shrink: 0 !important;
    }
    #wenyan ul li:has(h1) .wechat-custom-bullet,
    #wenyan ul li:has(h2) .wechat-custom-bullet,
    #wenyan ul li:has(h3) .wechat-custom-bullet,
    #wenyan ul li:has(h4) .wechat-custom-bullet,
    #wenyan ul li:has(h5) .wechat-custom-bullet,
    #wenyan ul li:has(h6) .wechat-custom-bullet {
      margin-left: 4px !important;
      margin-right: 8px !important;
      width: auto !important;
      padding-right: 0 !important;
      flex-shrink: 0 !important;
      display: inline-block !important;
    }
    #wenyan ol {
      padding-left: 2.2em;
      margin: 1.5em 0;
      color: #2c2c2c;
      font-size: 16px;
    }
    #wenyan ol li {
      margin: 0.2em 0;
      line-height: 1.3;
      font-size: 16px;
    }
    #wenyan li h1,
    #wenyan li h2,
    #wenyan li h3,
    #wenyan li h4,
    #wenyan li h5,
    #wenyan li h6,
    #wenyan li p {
      margin-top: 0.15em !important;
      margin-bottom: 0.15em !important;
    }
    #wenyan table {
      width: 100%;
      border-collapse: collapse;
      margin: 1.8em 0;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 8px 25px rgba(0, 0, 0, 0.1);
      border: 2px solid transparent;
      background: linear-gradient(white, white) padding-box, linear-gradient(135deg, #FF6600, #00A968, #38C6F4) border-box;
    }
    #wenyan table th {
      padding: 12px 16px;
      text-align: left;
      font-weight: 700;
      background: linear-gradient(135deg, rgba(255, 102, 0, 0.1), rgba(0, 169, 104, 0.1));
      color: #00A968;
      border-bottom: 2px solid rgba(255, 102, 0, 0.2);
      font-family: 'Titillium Web', sans-serif;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-size: 15px !important;
    }
    #wenyan table td {
      padding: 10px 16px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.08);
      color: #2c2c2c;
      font-size: 15px !important;
    }
    #wenyan img {
      max-width: 100%;
      border-radius: 16px;
      margin: 1.8em auto;
      display: block;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.15), 0 4px 8px rgba(255, 102, 0, 0.1);
      border: 2px solid transparent;
      background: linear-gradient(white, white) padding-box, linear-gradient(135deg, #FF6600, #00A968, #38C6F4) border-box;
    }
    #wenyan figure {
      margin: 1.8em 0;
      text-align: center;
      line-height: 1.6;
      font-size: 16px;
      color: #555555;
    }
    #wenyan figcaption {
      text-align: center;
      font-size: 0.9em;
      color: #777777;
      margin-top: 1em;
      font-style: italic;
    }
    #wenyan .footnotes {
      margin-top: 2.5em;
      padding-top: 1.8em;
      border-top: 2px solid transparent;
      border-image: linear-gradient(to right, #FF6600, #00A968, #38C6F4) 1;
    }
    #wenyan .footnote-item {
      font-size: 0.9em;
      color: #00A968;
      line-height: 1.6;
      margin-bottom: 0.4em;
    }
    `;
  } else if (themeId === 'fresh-green') {
    css = `
    #wenyan {
      --theme-primary: #00b96b;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 16px;
      color: #2b303b;
      line-height: 1.8;
      letter-spacing: 0.03em;
      padding: 20px 15px;
    }
    #wenyan p {
      margin: 1.5em 0;
      line-height: 1.8;
      color: #3f4a56;
    }
    #wenyan h1 {
      font-size: 24px;
      font-weight: bold;
      text-align: center;
      color: #2b303b;
      margin: 0.5em 0 1em;
    }
    #wenyan h2 {
      border-bottom: 2px solid #00b96b !important;
      margin: 2.5em 0 1.2em !important;
      padding: 0 !important;
      display: block !important;
      text-align: left !important;
    }
    #wenyan h2 span {
      display: inline-block !important;
      background-color: #00b96b !important;
      color: #ffffff !important;
      padding: 6px 16px !important;
      border-radius: 4px 4px 0 0 !important;
      font-size: 18px !important;
      font-weight: bold !important;
      margin-bottom: -2px !important;
      line-height: 1.5 !important;
      box-sizing: border-box !important;
    }
    #wenyan h3 {
      background: none !important;
      border: none !important;
      border-left: 4px solid #00b96b !important;
      padding: 6px 0 6px 12px !important;
      color: #00b96b !important;
      font-size: 17px !important;
      font-weight: bold !important;
      margin: 1.8em 0 1em !important;
      line-height: 1.4 !important;
      display: block !important;
    }
    #wenyan h3 span {
      color: #00b96b !important;
    }
    #wenyan blockquote {
      font-style: normal;
      padding: 0.8em 1.2em;
      border-left: 4px solid #00b96b;
      border-radius: 4px;
      color: #505e6b;
      background: #f8fafc;
      margin: 1em 0;
    }
    #wenyan blockquote p {
      margin: 0;
      color: #505e6b;
      line-height: 1.8;
    }
    #wenyan ul {
      padding-left: 1.5em;
      margin: 1.5em 0;
      color: #3f4a56;
    }
    #wenyan ul li {
      margin: 0.6em 0;
      line-height: 1.6;
      font-size: 16px;
    }
    #wenyan ol {
      padding-left: 1.5em;
      margin: 1.5em 0;
      color: #3f4a56;
    }
    #wenyan ol li {
      margin: 0.6em 0;
      line-height: 1.6;
      font-size: 16px;
    }
    #wenyan pre {
      display: block;
      box-sizing: border-box;
      font-size: 14px;
      overflow-x: auto;
      border-radius: 8px;
      padding: 1.25em 1.5em;
      line-height: 1.6;
      margin: 1.5em 0;
      background-color: #282c34;
      color: #abb2bf;
    }
    #wenyan code {
      font-family: 'SFMono-Regular', Consolas, Menlo, monospace;
      font-size: 14px;
      background-color: #f0f3f6;
      color: #d1335a;
      padding: 2px 6px;
      border-radius: 4px;
    }
    #wenyan pre code {
      background: none;
      padding: 0;
      color: inherit;
      border-radius: 0;
    }
    #wenyan table {
      width: 100%;
      border-collapse: collapse;
      margin: 1.5em 0;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid #e1e4e8;
    }
    #wenyan table th {
      padding: 12px 16px;
      text-align: center !important;
      font-weight: bold !important;
      background-color: #f6f8fa;
      border-bottom: 2px solid #e1e4e8;
      color: #24292e;
      font-size: 14px !important;
    }
    #wenyan table td {
      padding: 10px 16px;
      border-bottom: 1px solid #e1e4e8;
      color: #3f4a56;
      font-size: 14px !important;
    }
    #wenyan table tr:nth-child(even) td {
      background-color: #fcfcfc;
    }
    #wenyan strong {
      color: #00b96b;
      font-weight: 600;
    }
    #wenyan em {
      color: #00b96b;
      font-style: italic;
    }
    #wenyan a {
      color: #00b96b;
      text-decoration: none;
      border-bottom: 1px dashed #00b96b;
    }
    `;
  } else if (themeId === 'aurora') {
    css = `
    #wenyan {
      --theme-primary: #1677ff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 16px;
      color: #1d2129;
      line-height: 1.8;
      letter-spacing: 0.03em;
      padding: 20px 15px;
    }
    #wenyan p {
      margin: 1.5em 0;
      line-height: 1.8;
      color: #4e5969;
    }
    #wenyan h1 {
      padding: 0.6em 1.5em;
      margin: 1.5em 0 1.5em;
      color: #1d2129;
      font-size: 22px;
      font-weight: 600;
      text-align: center;
      background: linear-gradient(to right, rgba(22, 119, 255, 0.02), rgba(5, 212, 205, 0.05), rgba(22, 119, 255, 0.02));
      border-radius: 4px;
      border-top: 3px solid #1677ff;
      border-bottom: 1px solid rgba(5, 212, 205, 0.5);
    }
    #wenyan h2 {
      padding: 0.5em 1.4em;
      margin: 2.5em 0 1.2em;
      color: #ffffff;
      background: linear-gradient(135deg, #1677ff, #05d4cd);
      font-size: 20px;
      font-weight: 600;
      text-align: center;
      border-radius: 8px 24px 8px 24px;
      box-shadow: 0 4px 12px rgba(5, 212, 205, 0.15);
      letter-spacing: 0.1em;
      display: block;
    }
    #wenyan h3 {
      padding: 0.5em 1em 0.5em 12px;
      font-size: 18px;
      border-radius: 6px;
      line-height: 1.6;
      border-left: 4px solid #1677ff;
      border-right: 1px solid rgba(22, 119, 255, 0.1);
      border-bottom: 1px solid rgba(22, 119, 255, 0.1);
      border-top: 1px solid rgba(22, 119, 255, 0.1);
      background: linear-gradient(to right, rgba(22, 119, 255, 0.08), rgba(5, 212, 205, 0.03));
      color: #1677ff;
      margin: 2em 0 0.75em;
      font-weight: 600;
    }
    #wenyan blockquote {
      font-style: normal;
      padding: 0.8em 1.2em 0.8em 2em;
      border-left: 4px solid #05d4cd;
      border-radius: 6px;
      color: #4e5969;
      background: #f2f3f5;
      margin: 1em 0;
      position: relative;
      border-bottom: 0.2px solid rgba(5, 212, 205, 0.1);
      border-top: 0.2px solid rgba(5, 212, 205, 0.1);
      border-right: 0.2px solid rgba(5, 212, 205, 0.1);
    }
    #wenyan blockquote::before {
      content: "“";
      float: left;
      font-size: 2.2em;
      color: rgba(5, 212, 205, 0.25);
      font-family: Georgia, serif;
      line-height: 1;
      margin-left: -0.6em;
      margin-top: -0.25em;
    }
    #wenyan blockquote p {
      margin: 0;
      color: #4e5969;
      line-height: 1.8;
    }
    #wenyan ul {
      padding-left: 1.5em;
      margin: 1.5em 0;
      color: #4e5969;
    }
    #wenyan ul li {
      margin: 0.6em 0;
      color: #1677ff;
      line-height: 1.6;
      font-size: 16px;
    }
    #wenyan ul li::marker {
      color: #1677ff;
    }
    #wenyan ol {
      padding-left: 1.5em;
      margin: 1.5em 0;
      color: #4e5969;
    }
    #wenyan ol li {
      margin: 0.6em 0;
      line-height: 1.6;
      font-size: 16px;
    }
    #wenyan pre {
      display: block;
      box-sizing: border-box;
      font-size: 14px;
      overflow-x: auto;
      border-radius: 12px 24px 12px 24px;
      padding: 1.15em 1.2em 1.2em;
      line-height: 1.6;
      margin: 1.5em 0;
      background: linear-gradient(180deg, rgba(22, 119, 255, 0.14) 0px, rgba(5, 212, 205, 0.12) 14px, #f7f8fa 14px, #f7f8fa 100%);
      border: 1px solid rgba(22, 119, 255, 0.14);
      border-bottom: 2px solid rgba(5, 212, 205, 0.24);
      box-shadow: 0 10px 24px rgba(22, 119, 255, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.85);
    }
    #wenyan code {
      font-family: 'SFMono-Regular', Consolas, Menlo, monospace;
      font-size: 14px;
      background-color: #f2f3f5;
      color: #1d2129;
      padding: 2px 6px;
      border-radius: 4px;
    }
    #wenyan pre code {
      background: none;
      padding: 0;
      color: inherit;
      border-radius: 0;
    }
    #wenyan table {
      width: 100%;
      border-collapse: collapse;
      margin: 1.5em 0;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
    }
    #wenyan table th {
      padding: 12px 16px;
      text-align: center !important;
      font-weight: bold !important;
      border-bottom: 1px solid rgba(5, 212, 205, 0.1);
      background: linear-gradient(to right, rgba(22, 119, 255, 0.05), rgba(5, 212, 205, 0.05));
      color: #05d4cd;
      font-size: 14px !important;
    }
    #wenyan table td {
      padding: 10px 16px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.05);
      color: #4e5969;
      font-size: 14px !important;
    }
    #wenyan table tr:nth-child(even) td {
      background: rgba(247, 248, 250, 0.7);
    }
    #wenyan strong {
      color: #1677ff;
      font-weight: 600;
    }
    #wenyan em {
      color: #05d4cd;
      font-style: italic;
    }
    #wenyan a {
      color: #1677ff;
      text-decoration: none;
      border-bottom: 1px dashed #1677ff;
    }
    `;
  } else if (themeId === 'chinese') {
    css = `
    #wenyan {
      --theme-primary: #8b1e22;
      max-width: 677px;
      margin: 0 auto;
      padding: 12px;
      background-color: #ffffff;
      font-family: Georgia, Cambria, 'Times New Roman', 'Noto Serif SC', 'Source Han Serif SC', 'Source Han Serif CN', serif;
      color: #3e3a35;
      line-height: 1.85;
      font-size: 16px;
    }
    #wenyan p {
      margin: 1.5em 0;
      letter-spacing: 0.03em;
      color: #3e3a35;
      text-align: justify;
      line-height: 1.85;
      font-size: 16px;
    }
    #wenyan h1 {
      font-size: 24px;
      font-weight: 800;
      color: #8b1e22;
      text-align: center;
      margin: 1.8em 0 1.2em;
      letter-spacing: 0.05em;
    }
    #wenyan h2 {
      margin: 2em 0 1.1em !important;
      padding: 4px 0 8px 14px !important;
      font-size: 22px !important;
      font-weight: 700 !important;
      color: #8b1e22 !important;
      border-left: 5px solid #8b1e22 !important;
      border-bottom: 2px dashed #e3dad2 !important;
      display: block !important;
      text-align: left !important;
      background: none !important;
      border-top: none !important;
      border-right: none !important;
    }
    #wenyan h3 {
      margin: 1.8em 0 1em !important;
      padding: 3px 0 7px 12px !important;
      font-size: 20px !important;
      font-weight: 700 !important;
      color: #8b1e22 !important;
      border-left: 4px solid #8b1e22 !important;
      border-bottom: 2px dashed #e3dad2 !important;
      display: block !important;
      text-align: left !important;
      background: none !important;
      border-top: none !important;
      border-right: none !important;
    }
    #wenyan h4 {
      margin: 1.6em 0 0.8em !important;
      padding: 2px 0 6px 10px !important;
      font-size: 18px !important;
      font-weight: 700 !important;
      color: #8b1e22 !important;
      border-left: 3px solid #8b1e22 !important;
      border-bottom: 2px dashed #e3dad2 !important;
      display: block !important;
      text-align: left !important;
      background: none !important;
      border-top: none !important;
      border-right: none !important;
    }
    #wenyan h5 {
      font-size: 15px !important;
      font-weight: 700 !important;
      color: #3e3a35 !important;
      margin: 1.4em 0 0.6em !important;
      line-height: 1.4 !important;
    }
    #wenyan h6 {
      font-size: 14px !important;
      font-weight: 700 !important;
      color: #6e675f !important;
      margin: 1.2em 0 0.5em !important;
      line-height: 1.4 !important;
    }
    #wenyan blockquote {
      font-style: normal;
      padding: 1.2em 1.5em;
      border-left: 4.5px solid #8b1e22;
      background-color: #fcfaf7;
      color: #5e564d;
      margin: 1.6em 0;
      border-top: none;
      border-right: none;
      border-bottom: none;
      border-radius: 0;
    }
    #wenyan blockquote p {
      margin: 0;
      color: #5e564d;
      line-height: 1.8;
      font-size: 16px;
    }
    #wenyan strong {
      color: #8b1e22;
      font-weight: 700;
    }
    #wenyan em {
      color: #8b1e22;
      font-style: italic;
    }
    #wenyan a {
      color: #8b1e22;
      text-decoration: underline;
      text-decoration-color: #c48f90;
      text-underline-offset: 3px;
    }
    #wenyan hr {
      height: 1px;
      border: none;
      border-top: 1.5px dashed #ebdcd0;
      margin: 2.5em 0;
    }
    #wenyan code {
      font-family: Menlo, Monaco, Consolas, 'Courier New', monospace;
      font-size: 14px;
      background-color: #faf6f3;
      color: #8b1e22;
      padding: 3px 5px;
      border-radius: 3px;
      border: 1px solid #ebdcd0;
      margin: 0 2px;
    }
    #wenyan pre {
      display: block;
      box-sizing: border-box;
      font-size: 14px;
      overflow-x: auto;
      border-radius: 12px;
      padding: 1.25em 1.5em 0.95em;
      line-height: 1.6;
      margin: 1.2em 0 0.6em;
      background: repeating-linear-gradient(45deg, #faf7f5, #faf7f5 12px, #f5eee8 12px, #f5eee8 16px);
      color: #3e3a35;
      border: 1px solid #d2beb2;
    }
    #wenyan pre code {
      background: none;
      padding: 0;
      color: inherit;
      border-radius: 0;
    }
    #wenyan ul {
      list-style: none;
      padding: 0;
      margin: 1.5em 0;
      color: #3e3a35;
      font-size: 16px;
    }
    #wenyan ul li {
      margin: 0.5em 0;
      padding: 0 0 0 1.2em;
      line-height: 1.8;
      font-size: 16px;
      position: relative;
    }
    #wenyan ul li::before {
      content: "•";
      color: #8b1e22;
      font-size: 1.2em;
      position: absolute;
      left: 0;
      top: -0.05em;
    }
    #wenyan ol {
      padding-left: 1.5em;
      margin: 1.5em 0;
      color: #3e3a35;
      font-size: 16px;
    }
    #wenyan ol li {
      margin: 0.5em 0;
      line-height: 1.8;
      font-size: 16px;
    }
    #wenyan table {
      width: 100%;
      border-collapse: collapse;
      margin: 1.8em 0;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #ebdcd0;
      background-color: #ffffff;
    }
    #wenyan table th {
      padding: 12px 16px;
      text-align: left !important;
      font-weight: bold !important;
      background-color: #f3eae1;
      color: #8b1e22;
      border-bottom: 1.5px solid #ebdcd0;
      font-size: 15px !important;
    }
    #wenyan table td {
      padding: 12px 16px;
      border-bottom: 1px solid #ebdcd0;
      color: #3e3a35;
      font-size: 14px !important;
    }
    #wenyan table tr td:first-child {
      color: #8b1e22 !important;
      font-weight: bold !important;
    }
    #wenyan table tr:nth-child(even) td {
      background-color: #faf9f6;
    }
    #wenyan img {
      max-width: 100%;
      border-radius: 8px;
      margin: 1.5em auto;
      display: block;
      border: 1px solid #ebdcd0;
      padding: 4px;
      background-color: #ffffff;
    }
    `;
  } else {
    const themeObj = getTheme(themeId)
    if (themeObj) {
      css = await themeObj.getCss()
    }
  }

  if (!css) return ''
  
  // Custom fix to ensure h2 vertical text alignment & orange heart wedge alignment
  if (themeId === 'orangeheart') {
    css += `
    #wenyan {
      --theme-primary: rgb(239, 112, 96);
    }
    #wenyan h2 span {
      display: inline-block !important;
      min-height: 36px !important;
      line-height: 1.2 !important;
      padding: 7px 10px 7px !important;
      box-sizing: border-box !important;
    }
    #wenyan blockquote {
      padding: 8px 16px 8px 14px !important;
      margin: 0.8em 0 !important;
      line-height: 1.7 !important;
      font-size: 14px !important;
    }
    #wenyan blockquote p {
      margin: 4px 0 !important;
      line-height: 1.7 !important;
    }
    `
  } else if (themeId === 'rainbow') {
    css += `
    #wenyan h2 {
      padding: 0.3em 1em !important;
      line-height: 1.4 !important;
    }
    `
  } else if (themeId === 'lapis' || themeId === 'phycat') {
    css += `
    #wenyan h2 {
      padding: 0.35em 12.5px !important;
      line-height: 1.4 !important;
    }
    `
    if (themeId === 'phycat') {
      css += `
      #wenyan h1 {
        text-align: center !important;
        font-size: 1.5em !important;
        font-weight: bold !important;
        color: #089ba3 !important;
        position: relative !important;
        padding: 0.5em 0.5em 0.6em !important;
        margin: 1em 0 1.2em !important;
        line-height: 1.4 !important;
      }
      #wenyan h1 span {
        display: inline !important;
        background: linear-gradient(to bottom, transparent 65%, rgba(61, 184, 191, 0.25) 65%) !important;
        border-radius: 2px !important;
      }
      #wenyan h3 {
        display: flex !important;
        align-items: center !important;
        border-left: 5px solid #3db8bf !important;
        padding: 4px 0 4px 10px !important;
        line-height: 1.4 !important;
        font-size: 1.3em !important;
        margin: 1.5em 0 0.8em !important;
        width: fit-content !important;
        color: #3db8bf !important;
      }
      #wenyan h3 section {
        align-self: center !important;
        line-height: 1.4 !important;
        margin-top: 0 !important;
        margin-bottom: 0 !important;
      }
      #wenyan blockquote {
        padding: 8px 16px 8px 12px !important;
        margin: 0.8em 0 !important;
        line-height: 1.7 !important;
        font-size: 14px !important;
      }
      #wenyan blockquote p {
        margin: 4px 0 !important;
        line-height: 1.7 !important;
      }
      `
    }
  } else if (themeId === 'maize') {
    css += `
    #wenyan h1 {
      text-align: center !important;
      font-size: 1.5em !important;
      font-weight: bold !important;
      color: #c97d0a !important;
      padding: 0.5em 0.5em 0.6em !important;
      margin: 1em 0 1.2em !important;
      line-height: 1.4 !important;
    }
    #wenyan h1 span {
      display: inline !important;
      background: linear-gradient(to bottom, transparent 65%, rgba(255, 177, 27, 0.3) 65%) !important;
      border-radius: 2px !important;
    }
    #wenyan h2 {
      display: flex !important;
      align-items: center !important;
    }
    #wenyan h2::before {
      display: inline-block !important;
      width: 20px !important;
      height: 20px !important;
      background-position: center !important;
      background-size: 20px 20px !important;
      vertical-align: middle !important;
      margin-top: 0 !important;
      margin-bottom: 0 !important;
    }
    #wenyan h2 span {
      display: inline-block !important;
      vertical-align: middle !important;
      line-height: 1.4 !important;
      padding: 5px 10px !important;
    }
    #wenyan blockquote {
      padding: 8px 16px 8px 14px !important;
      margin: 0.8em 0 !important;
      line-height: 1.7 !important;
      font-size: 14px !important;
    }
    #wenyan blockquote p {
      margin: 4px 0 !important;
      line-height: 1.7 !important;
    }
    `
  } else if (themeId === 'pie') {
    css += `
    #wenyan h1 {
      text-align: center !important;
      font-size: 1.5em !important;
      font-weight: bold !important;
      color: #da282a !important;
      padding: 0.5em 0.5em 0.6em !important;
      margin: 1em 0 1.2em !important;
      line-height: 1.4 !important;
    }
    #wenyan h1 span {
      display: inline !important;
      background: linear-gradient(to bottom, transparent 65%, rgba(218, 40, 42, 0.18) 65%) !important;
      border-radius: 2px !important;
    }
    #wenyan blockquote {
      padding: 8px 16px 8px 14px !important;
      margin: 0.8em 0 !important;
      line-height: 1.7 !important;
      font-size: 14px !important;
    }
    #wenyan blockquote p {
      margin: 4px 0 !important;
      line-height: 1.7 !important;
    }
    `
  }
  
  if (themeId === 'lapis') {
    css += `
    #wenyan {
      --theme-primary: #4870ac;
    }
    #wenyan blockquote {
      padding: 8px 16px 8px 14px !important;
      margin: 0.8em 0 !important;
      line-height: 1.7 !important;
      font-size: 14px !important;
    }
    #wenyan blockquote p {
      margin: 4px 0 !important;
      line-height: 1.7 !important;
    }
    `
  }

  // Custom fix to ensure tables fit without overflowing and support horizontal scrolling
  css += `
  #wenyan table {
    table-layout: auto !important;
    width: auto !important;
    min-width: 100% !important;
    border-collapse: collapse !important;
  }
  #wenyan table th {
    word-break: keep-all !important;
    white-space: nowrap !important;
    text-align: center !important;
    font-weight: bold !important;
  }
  #wenyan table td {
    word-break: normal !important;
  }
  `

  // Custom fix to ensure footnotes look modern, clean, and perfectly aligned
  css += `
  #wenyan h3:has(+ #footnotes) {
    margin-top: 2.5em !important;
    border-bottom: 1px solid #e1e4e8 !important;
    padding-bottom: 8px !important;
    color: #333 !important;
    font-size: 16px !important;
    font-weight: bold !important;
    background: none !important;
    border-left: none !important;
    padding-left: 0 !important;
  }
  #wenyan #footnotes {
    margin-top: 1.5em !important;
  }
  #wenyan #footnotes p {
    display: flex !important;
    align-items: flex-start !important;
    margin: 12px 0 !important;
    font-size: 13px !important;
    line-height: 1.6 !important;
    color: #555 !important;
  }
  #wenyan .footnote-num {
    display: inline-block !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
    font-weight: bold !important;
    color: #8c8c8c !important;
    min-width: 32px !important;
    margin-right: 8px !important;
    flex-shrink: 0 !important;
    text-align: left !important;
  }
  #wenyan .footnote-txt {
    flex: 1 !important;
    word-break: break-all !important;
    word-wrap: break-word !important;
    color: #333 !important;
  }
  #wenyan .footnote-txt i {
    display: block !important;
    font-style: normal !important;
    color: var(--theme-primary, #0069c2) !important;
    font-size: 12px !important;
    margin-top: 4px !important;
    word-break: break-all !important;
  }
  `
  
  // Map themeId to its primary color variable and ensure --theme-primary is set
  let primaryColor = '#00b96b'
  let rgbColor = '0, 185, 107'
  let h4Color = '#00b96b'
  let rgbH4Color = '0, 185, 107'
  if (themeId === 'sports') {
    primaryColor = '#00A968'
    rgbColor = '0, 169, 104'
    h4Color = '#00A968'
    rgbH4Color = '0, 169, 104'
  } else if (themeId === 'fresh-green') {
    primaryColor = '#00b96b'
    rgbColor = '0, 185, 107'
    h4Color = '#00b96b'
    rgbH4Color = '0, 185, 107'
  } else if (themeId === 'aurora') {
    primaryColor = '#1677ff'
    rgbColor = '22, 119, 255'
    h4Color = '#05d4cd'
    rgbH4Color = '5, 212, 205'
  } else if (themeId === 'orangeheart') {
    primaryColor = 'rgb(239, 112, 96)'
    rgbColor = '239, 112, 96'
    h4Color = 'rgb(239, 112, 96)'
    rgbH4Color = '239, 112, 96'
  } else if (themeId === 'rainbow') {
    primaryColor = 'rgb(250, 84, 28)'
    rgbColor = '250, 84, 28'
    h4Color = 'rgb(250, 84, 28)'
    rgbH4Color = '250, 84, 28'
  } else if (themeId === 'lapis') {
    primaryColor = '#4870ac'
    rgbColor = '72, 112, 172'
    h4Color = '#4870ac'
    rgbH4Color = '72, 112, 172'
  } else if (themeId === 'pie') {
    primaryColor = '#da282a'
    rgbColor = '218, 40, 42'
    h4Color = '#da282a'
    rgbH4Color = '218, 40, 42'
  } else if (themeId === 'maize') {
    primaryColor = 'rgb(228, 145, 35)'
    rgbColor = '228, 145, 35'
    h4Color = 'rgb(228, 145, 35)'
    rgbH4Color = '228, 145, 35'
  } else if (themeId === 'purple') {
    primaryColor = '#8064a9'
    rgbColor = '128, 100, 169'
    h4Color = '#8064a9'
    rgbH4Color = '128, 100, 169'
  } else if (themeId === 'phycat') {
    primaryColor = '#3db8bf'
    rgbColor = '61, 184, 191'
    h4Color = '#3db8bf'
    rgbH4Color = '61, 184, 191'
  } else if (themeId === 'chinese') {
    primaryColor = '#8b1e22'
    rgbColor = '139, 30, 34'
    h4Color = '#b89058'
    rgbH4Color = '184, 144, 88'
  }

  css += `
  #wenyan {
    --theme-primary: ${primaryColor};
    --theme-h4-color: ${h4Color};
  }
  `

  if (themeId !== 'sports' && themeId !== 'chinese') {
    css += `
    #wenyan h4 {
      display: flex !important;
      align-items: center !important;
      font-size: 16px !important;
      font-weight: 500 !important;
      color: var(--theme-h4-color) !important;
      border-left: 3px solid var(--theme-h4-color) !important;
      border-bottom: 1px dashed rgba(${rgbH4Color}, 0.3) !important;
      background: linear-gradient(to right, rgba(${rgbH4Color}, 0.06), rgba(${rgbColor}, 0.02)) !important;
      border-radius: 6px !important;
      padding: 8px 12px 8px 10px !important;
      margin: 2em 0 0.8em !important;
      line-height: 1.4 !important;
      border-top: none !important;
      border-right: none !important;
    }
    #wenyan h4::before {
      content: "◆";
      display: inline-block !important;
      color: var(--theme-h4-color) !important;
      width: auto !important;
      height: auto !important;
      background: none !important;
      background-color: transparent !important;
      margin-left: 0px !important;
      margin-right: 8px !important;
      font-size: 14px !important;
      line-height: 1 !important;
      vertical-align: middle !important;
    }
    #wenyan h5 {
      display: block !important;
      font-size: 15px !important;
      font-weight: bold !important;
      color: var(--theme-primary) !important;
      border-left: 3px solid var(--theme-primary) !important;
      padding: 6px 12px 6px 10px !important;
      margin: 1.5em 0 0.8em !important;
      line-height: 1.4 !important;
      background: linear-gradient(to right, rgba(${rgbColor}, 0.07), rgba(${rgbColor}, 0.01)) !important;
      border-top: none !important;
      border-right: none !important;
      border-bottom: none !important;
    }
    #wenyan hr {
      height: 2px !important;
      border: none !important;
      margin: 2em auto !important;
      background: linear-gradient(to right, rgba(${rgbColor}, 0) 0%, rgba(${rgbColor}, 0.9) 30%, rgba(${rgbH4Color}, 0.9) 70%, rgba(${rgbH4Color}, 0) 100%) !important;
    }
    `
    // Force consistent font-size for paragraphs, lists, and general text to resolve the inconsistency
    css += `
    #wenyan,
    #wenyan p,
    #wenyan li,
    #wenyan ul,
    #wenyan ol {
      font-size: 16px !important;
    }
    `
  }
  
  return css
}
