import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  // 1. Register fetch_webpage tool with redirect following support
  pi.registerTool({
    name: "fetch_webpage",
    label: "Fetch Webpage Content",
    description: "Fetch the content of a public webpage and convert it to clean readable markdown/text. Use this tool when requested to scrape, fetch, view, translate, or analyze a URL.",
    parameters: Type.Object({
      url: Type.String({ description: "The URL of the webpage to fetch" }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const controller = new AbortController();
      if (signal) {
        if (signal.aborted) {
          controller.abort();
        } else {
          signal.addEventListener("abort", () => controller.abort());
        }
      }
      const timeoutId = setTimeout(() => controller.abort(), 20000); // 20 seconds timeout

      try {
        const response = await fetch("http://127.0.0.1:8001/api/fetch-webpage", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ url: params.url }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          const errText = await response.text();
          return {
            content: [{ type: "text", text: `Error: Failed to fetch webpage via backend. ${errText}` }],
            isError: true,
          };
        }

        const data: any = await response.json();
        if (data.error) {
          return {
            content: [{ type: "text", text: `Error: ${data.error}` }],
            isError: true,
          };
        }

        const contentType = data.content_type || "";
        const text = data.body || "";
        const finalUrl = data.url || params.url;

        if (contentType.includes("application/json")) {
          try {
            const parsed = JSON.parse(text);
            const formattedJson = JSON.stringify(parsed, null, 2);
            return {
              content: [{ type: "text", text: `\`\`\`json\n${formattedJson}\n\`\`\`性能` }],
              details: { url: finalUrl, contentType },
            };
          } catch {
            return {
              content: [{ type: "text", text: text }],
              details: { url: finalUrl, contentType },
            };
          }
        }

        if (contentType.includes("text/html")) {
          const markdown = cleanHtmlToMarkdown(text, finalUrl);
          return {
            content: [{ type: "text", text: markdown }],
            details: { url: finalUrl, contentType },
          };
        }

        // Default: return plain text
        return {
          content: [{ type: "text", text: text }],
          details: { url: finalUrl, contentType },
        };
      } catch (error: any) {
        clearTimeout(timeoutId);
        const isTimeout = controller.signal.aborted && (!signal || !signal.aborted);
        const errMsg = isTimeout
          ? `Error: Request timed out after 20 seconds. The target URL is loading too slowly or unreachable.`
          : `Error fetching URL: ${error.message || error}`;
        return {
          content: [{ type: "text", text: errMsg }],
          isError: true,
        };
      }
    },
  });

  // 2. Register web_search tool using 360 Search (unblocked)
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: "Search the web for information using a search engine. Returns a list of matching webpage titles, URLs, and descriptions. Use this when the user asks to research, investigate, find information, lookup details, or check references on the internet.",
    parameters: Type.Object({
      query: Type.String({ description: "The search query to look up on the web" }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const controller = new AbortController();
      if (signal) {
        if (signal.aborted) {
          controller.abort();
        } else {
          signal.addEventListener("abort", () => controller.abort());
        }
      }
      const timeoutId = setTimeout(() => controller.abort(), 12000); // 12 seconds timeout

      try {
        const response = await fetch("http://127.0.0.1:8001/api/web-search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ query: params.query }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          const errText = await response.text();
          return {
            content: [{ type: "text", text: `Error: Search failed via backend. ${errText}` }],
            isError: true,
          };
        }

        const data: any = await response.json();
        if (data.error) {
          return {
            content: [{ type: "text", text: `Error: ${data.error}` }],
            isError: true,
          };
        }

        const html = data.html || "";
        const results: Array<{ title: string; url: string; snippet: string }> = [];
        const blocks = html.split('<li class="res-list">');

        for (let i = 1; i < blocks.length; i++) {
          const block = blocks[i].split('</li>')[0];
          const titleMatch = block.match(/<h3>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i) || 
                             block.match(/<h3[^>]*class="res-title"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
          if (titleMatch) {
            let redirectUrl = titleMatch[1];
            const title = titleMatch[2].replace(/<[^>]+>/g, '').trim();
            if (redirectUrl.startsWith('/link?')) {
              redirectUrl = `https://www.so.com${redirectUrl}`;
            }

            const snippetMatch = block.match(/<p[^>]*class="res-desc"[^>]*>([\s\S]*?)<\/p>/i) || 
                                 block.match(/<div[^>]*class="res-desc"[^>]*>([\s\S]*?)<\/div>/i) ||
                                 block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
            const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';
            results.push({ title, url: redirectUrl, snippet });
          }
        }

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: "No search results found." }],
          };
        }

        // Format search results cleanly for LLM consumption
        const formattedResults = results.slice(0, 8).map((r, idx) => {
          return `[${idx + 1}] Title: ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}\n`;
        }).join("\n");

        return {
          content: [{ type: "text", text: formattedResults }],
        };
      } catch (error: any) {
        clearTimeout(timeoutId);
        const isTimeout = controller.signal.aborted && (!signal || !signal.aborted);
        const errMsg = isTimeout
          ? `Error: Search request timed out after 12 seconds.`
          : `Search failed: ${error.message || error}`;
        return {
          content: [{ type: "text", text: errMsg }],
          isError: true,
        };
      }
    },
  });
}

/**
 * Fetch helper that follows standard HTTP redirects as well as meta/script redirects.
 */
async function fetchWithRedirects(url: string, headers: any, signal: AbortSignal, maxRedirects = 4): Promise<Response> {
  let currentUrl = url;
  for (let i = 0; i < maxRedirects; i++) {
    const response = await fetch(currentUrl, { headers, signal });
    if (!response.ok) return response;

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      const text = await response.clone().text();
      // Check for Javascript-based location replaces or Meta refresh tags (standard in search redirect blocks)
      const redirectMatch = text.match(/window\.location\.replace\("([^"]+)"\)/i) || 
                            text.match(/content="0;\s*URL='([^']+)'"/i) ||
                            text.match(/meta\s+http-equiv="refresh"\s+content="0;\s*url=([^"]+)"/i) ||
                            text.match(/meta\s+http-equiv="refresh"\s+content="0;\s*URL='([^']+)'"/i);
      
      if (redirectMatch && redirectMatch[1]) {
        const resolved = resolveUrl(redirectMatch[1], currentUrl);
        if (resolved !== currentUrl) {
          currentUrl = resolved;
          continue;
        }
      }
    }
    return response;
  }
  return fetch(currentUrl, { headers, signal });
}

function resolveUrl(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

function cleanHtmlToMarkdown(html: string, baseUrl: string): string {
  // 1. Remove style, script, head, svg, nav, footer, iframe, noscript, header tags
  let cleaned = html
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "");

  // 2. Convert headers
  cleaned = cleaned.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n");
  cleaned = cleaned.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n");
  cleaned = cleaned.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n");
  cleaned = cleaned.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n");
  cleaned = cleaned.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n");
  cleaned = cleaned.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n");

  // 3. Convert links, images, lists, blockquotes, and code blocks
  cleaned = cleaned.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, "\n```\n$1\n```\n");
  cleaned = cleaned.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n");
  cleaned = cleaned.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
  cleaned = cleaned.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, "\n> $1\n");

  // Convert links with absolute URL resolution
  cleaned = cleaned.replace(/<a([^>]+)>([\s\S]*?)<\/a>/gi, (match, attrs, content) => {
    const hrefMatch = attrs.match(/href=["']([^"']*)["']/i);
    if (hrefMatch) {
      const href = resolveUrl(hrefMatch[1], baseUrl);
      return `[${content}](${href})`;
    }
    return content;
  });

  // Convert images with absolute URL resolution
  cleaned = cleaned.replace(/<img([^>]+)>/gi, (match, attrs) => {
    const dataSrcMatch = attrs.match(/data-src=["']([^"']*)["']/i);
    const dataActualsrcMatch = attrs.match(/data-actualsrc=["']([^"']*)["']/i);
    const dataOriginalMatch = attrs.match(/data-original-src=["']([^"']*)["']/i) || attrs.match(/data-original=["']([^"']*)["']/i);
    const dataLazyMatch = attrs.match(/data-lazy-src=["']([^"']*)["']/i);
    const srcMatch = attrs.match(/src=["']([^"']*)["']/i);
    
    // Choose the best src available, prioritizing real/high-res source over placeholders
    let rawSrc = "";
    if (dataSrcMatch && dataSrcMatch[1] && !dataSrcMatch[1].startsWith("data:")) {
      rawSrc = dataSrcMatch[1];
    } else if (dataActualsrcMatch && dataActualsrcMatch[1] && !dataActualsrcMatch[1].startsWith("data:")) {
      rawSrc = dataActualsrcMatch[1];
    } else if (dataOriginalMatch && dataOriginalMatch[1] && !dataOriginalMatch[1].startsWith("data:")) {
      rawSrc = dataOriginalMatch[1];
    } else if (dataLazyMatch && dataLazyMatch[1] && !dataLazyMatch[1].startsWith("data:")) {
      rawSrc = dataLazyMatch[1];
    } else if (srcMatch && srcMatch[1]) {
      rawSrc = srcMatch[1];
    } else if (dataSrcMatch && dataSrcMatch[1]) {
      rawSrc = dataSrcMatch[1];
    }
    
    const altMatch = attrs.match(/alt=["']([^"']*)["']/i);
    if (rawSrc) {
      const src = resolveUrl(rawSrc, baseUrl);
      const alt = altMatch ? altMatch[1] : "";
      return `![${alt}](${src})`;
    }
    return "";
  });

  cleaned = cleaned.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n* $1");
  cleaned = cleaned.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n\n");
  cleaned = cleaned.replace(/<br\s*\/?>/gi, "\n");

  // 4. Strip all remaining HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, "");

  // 5. Decode common HTML entities
  cleaned = decodeHtmlEntities(cleaned);

  // 6. Clean up whitespace: replace multiple blank lines with double newlines, trim lines
  cleaned = cleaned
    .split("\n")
    .map(line => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned;
}

function decodeHtmlEntities(str: string): string {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&apos;": "'",
    "&#39;": "'",
    "&nbsp;": " ",
  };
  return str.replace(/&amp;|&lt;|&gt;|&quot;|&apos;|&#39;|&nbsp;/g, (match) => entities[match] || match);
}
