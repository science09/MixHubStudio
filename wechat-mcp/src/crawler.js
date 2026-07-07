import fetch from 'node-fetch';

const PLATFORM_URLS = {
  weibo: 'https://api.vvhan.com/api/hotlist/wbHot',
  douyin: 'https://api.vvhan.com/api/hotlist/dyHot',
  zhihu: 'https://api.vvhan.com/api/hotlist/zhihuHot',
  bilibili: 'https://api.vvhan.com/api/hotlist/bili',
};

/**
 * Fetch trending topics for a specific platform.
 * @param {string} platform - The platform ID ('weibo', 'douyin', 'zhihu', 'bilibili')
 * @returns {Promise<Array<{title: string, hot: string, url: string}>>}
 */
export async function fetchTrendingTopics(platform) {
  const url = PLATFORM_URLS[platform.toLowerCase()];
  if (!url) {
    throw new Error(`Unsupported platform: ${platform}. Supported platforms are: weibo, douyin, zhihu, bilibili.`);
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      timeout: 10000, // 10 seconds timeout
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const json = await response.json();
    if (!json.success || !Array.isArray(json.data)) {
      throw new Error(`Invalid response format from hotlist API`);
    }

    return json.data.map(item => ({
      title: item.title || '',
      hot: item.hot || item.heat || '',
      url: item.url || '',
    }));
  } catch (error) {
    console.error(`Failed to fetch trending topics for ${platform}:`, error);
    throw new Error(`抓取 ${platform} 热搜失败: ${error.message}`);
  }
}
