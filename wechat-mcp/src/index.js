import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { publishToWechat } from "./wechat.js";
import { fetchTrendingTopics } from "./crawler.js";

const server = new Server(
  {
    name: "wechat-publish-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register the list tools request handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "publish_markdown_to_wechat",
        description: "将 Markdown 内容编译、格式化，并作为草稿发布到微信公众号平台（草稿箱）。支持本地图片上传为微信素材。",
        inputSchema: {
          type: "object",
          properties: {
            markdown: {
              type: "string",
              description: "需要发布的 Markdown 正文内容。支持 YAML frontmatter（可包含 title, cover, author 等字段）"
            },
            title: {
              type: "string",
              description: "文章标题。如果在 Markdown frontmatter 中没有指定，则使用此参数。若两者皆无，默认为'无标题文章'"
            },
            theme: {
              type: "string",
              description: "排版主题，例如: 'fresh-green' (默认), 'aurora', 'orangeheart', 'rainbow', 'lapis', 'sports', 'phycat'"
            },
            add_footnote: {
              type: "boolean",
              description: "是否自动转换并追加 Markdown 脚注到文章末尾（默认为 true）"
            },
            app_id: {
              type: "string",
              description: "微信公众号 AppID。如果未传，会尝试读取环境变量 WECHAT_APP_ID"
            },
            app_secret: {
              type: "string",
              description: "微信公众号 AppSecret。如果未传，会尝试读取环境变量 WECHAT_APP_SECRET"
            },
            cover_media_id: {
              type: "string",
              description: "备用的封面图片微信 media_id。若文章内无图片且 frontmatter 中无 cover 时，微信草稿箱要求必须提供封面"
            },
            images: {
              type: "object",
              description: "文章中所引用本地图片的键值对映射，key 为图片相对路径（如 'images/1.png'），value 为图片的 base64 编码字符串",
              additionalProperties: {
                type: "string"
              }
            }
          },
          required: ["markdown"]
        }
      },
      {
        name: "fetch_trending_topics",
        description: "抓取主流平台（微博、抖音、知乎、Bilibili）的实时热搜/热点榜单。",
        inputSchema: {
          type: "object",
          properties: {
            platform: {
              type: "string",
              enum: ["weibo", "douyin", "zhihu", "bilibili"],
              description: "要抓取的平台标识：weibo (微博), douyin (抖音), zhihu (知乎), bilibili (Bilibili)"
            }
          },
          required: ["platform"]
        }
      }
    ]
  };
});

// Register the call tool request handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "publish_markdown_to_wechat") {
    const args = request.params.arguments;
    try {
      const result = await publishToWechat(args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              media_id: result.media_id,
              message: "文章已成功发布至微信公众号草稿箱！"
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `发布失败: ${error.message || error}`
          }
        ]
      };
    }
  } else if (request.params.name === "fetch_trending_topics") {
    const args = request.params.arguments;
    try {
      const data = await fetchTrendingTopics(args.platform);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              platform: args.platform,
              data: data
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `抓取热搜失败: ${error.message || error}`
          }
        ]
      };
    }
  }
  throw new Error(`Tool not found: ${request.params.name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("WeChat Publish MCP Server running on Stdio transport.");
}

main().catch((error) => {
  console.error("Fatal error in main:", error);
  process.exit(1);
});
