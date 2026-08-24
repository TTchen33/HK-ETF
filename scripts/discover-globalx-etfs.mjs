/**
 * 从 Global X Hong Kong 公开 sitemap 自动发现候选产品页。
 *
 * 运行：node scripts/discover-globalx-etfs.mjs
 * 输出：data/discovered-globalx-funds.json
 *
 * 这一步只发现公开 URL，不大规模抓取每个产品页。
 * 候选 URL 会在后续字段校验通过后才进入正式采集范围。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const origin = 'https://www.globalxetfs.com.hk';
const outputPath = join(process.cwd(), 'data', 'discovered-globalx-funds.json');
const collectedAt = new Date().toISOString();
const headers = {
  'user-agent': 'HK-ETF-Explorer/0.1 (educational public-data collector)',
  'accept-language': 'en-HK,en;q=0.9,zh-HK;q=0.8'
};

async function fetchText(url) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

function xmlLocs(xml) {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((match) => match[1].trim());
}

async function sitemapUrls() {
  const robotUrl = `${origin}/robots.txt`;
  const robots = await fetchText(robotUrl);
  const declaredRoots = [...robots.matchAll(/^sitemap:\s*(\S+)\s*$/gim)]
    .map((match) => match[1])
    .filter((url) => {
      try { return new URL(url).origin === origin; } catch { return false; }
    });
  // 个别站点会在 robots.txt 留下示例 sitemap；只接受同一官方域名的声明。
  const roots = declaredRoots.length ? declaredRoots : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  const seen = new Set();
  const urls = new Set();

  for (const root of roots) {
    if (seen.has(root)) continue;
    seen.add(root);
    try {
      const rootXml = await fetchText(root);
      const locs = xmlLocs(rootXml);
      const nestedMaps = locs.filter((url) => /sitemap/i.test(url));
      if (nestedMaps.length) {
        for (const nested of nestedMaps.slice(0, 30)) {
          const nestedXml = await fetchText(nested);
          xmlLocs(nestedXml).forEach((url) => urls.add(url));
        }
      } else {
        locs.forEach((url) => urls.add(url));
      }
    } catch (error) {
      console.warn(`无法读取 sitemap：${root}（${error.message}）`);
    }
  }
  return { robotUrl, sitemapRoots: roots, urls: [...urls] };
}

function isFundProduct(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === origin && /^\/funds\/[^?#]+\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

const discovery = await sitemapUrls();
const productUrls = discovery.urls
  .filter(isFundProduct)
  .sort((a, b) => a.localeCompare(b));
const payload = {
  collectedAt,
  issuer: 'Global X Hong Kong',
  discoveryMethod: 'public robots.txt and sitemap files',
  source: discovery.robotUrl,
  sitemapRoots: discovery.sitemapRoots,
  candidateCount: productUrls.length,
  candidates: productUrls.map((url) => ({
    issuerProductUrl: url,
    slug: new URL(url).pathname.replace(/^\/funds\//, '').replace(/\/$/, ''),
    status: 'discovered_unverified'
  }))
};

await mkdir(join(process.cwd(), 'data'), { recursive: true });
await writeFile(outputPath, JSON.stringify(payload, null, 2), 'utf8');
console.log(`发现 ${productUrls.length} 个候选产品页。`);
