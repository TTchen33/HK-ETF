/**
 * 第一版发行商采集器：Global X Hong Kong 的公开 ETF 产品页。
 *
 * 运行：
 *   node scripts/ingest-globalx.mjs
 *
 * 输出：
 *   data/raw/globalx-<timestamp>.json      原始页面快照与请求结果
 *   data/processed/globalx-latest.json     供网站/数据库导入的标准化记录
 *
 * 仅抓取在 config/globalx-etfs.json 明确列出的公开产品页面。
 * 它不处理实时行情，也不绕过访问限制。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const projectRoot = process.cwd();
const seedPath = join(projectRoot, 'config', 'globalx-etfs.json');
const discoveryPath = join(projectRoot, 'data', 'discovered-globalx-funds.json');
const outputDirectory = join(projectRoot, 'data');
const baseUrl = 'https://www.globalxetfs.com.hk/funds/';
const now = new Date();
const collectedAt = now.toISOString();
const fileTimestamp = collectedAt.replace(/[:.]/g, '-');
const useDiscoveredCandidates = process.argv.includes('--from-discovery');
const limitArgument = process.argv.find((argument) => argument.startsWith('--limit='));
const requestedLimit = limitArgument ? Number(limitArgument.split('=')[1]) : null;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normaliseWhitespace(value) {
  return value
    ?.replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim() || null;
}

function firstMatch(text, pattern) {
  const match = text.match(pattern);
  return match ? normaliseWhitespace(match[1]) : null;
}

function parseDate(value) {
  if (!value) return null;
  const months = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
  };
  const dayFirst = value.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  const monthFirst = value.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),\s+(\d{4})$/);
  const match = dayFirst || monthFirst;
  if (!match) return null;
  const [, first, second, year] = match;
  const day = dayFirst ? first : second;
  const monthName = dayFirst ? second : first;
  const month = months[monthName.slice(0, 3).toLowerCase()];
  return month ? `${year}-${month}-${day.padStart(2, '0')}` : null;
}

function parseNumber(value) {
  if (!value) return null;
  const numeric = Number(value.replace(/,/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function parseCurrencyAmount(value) {
  if (!value) return { value: null, currency: null };
  const match = value.match(/\b(HKD|USD|RMB)\s*[$¥]?\s*([\d,.]+)/i);
  return match
    ? { currency: match[1].toUpperCase(), value: parseNumber(match[2]) }
    : { value: null, currency: null };
}

function readField(text, label, stopLabels) {
  const stops = stopLabels.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const pattern = new RegExp(`${label}\\s*([\\s\\S]*?)(?=\\s+(?:${stops})\\b|$)`, 'i');
  return firstMatch(text, pattern);
}

function parseProductPage(seed, html) {
  const text = stripHtml(html);
  const pageTitle = (firstMatch(html, /<title[^>]*>([^<]+)<\/title>/i) || '')
    .replace(/\s*(?:\||-)\s*Global X ETFs.*$/i, '')
    .replace(/\s*\|\s*\d{4,5}\s*$/i, '') || null;
  const asOf = firstMatch(text, /Fund Information\s*As of\s*(\d{1,2}\s+[A-Z][a-z]{2,8}\s+\d{4}|[A-Z][a-z]{2,8}\s+\d{1,2},\s+\d{4})/i);
  const navText = firstMatch(text, /NAV Per Share(?:\s*\([^)]*Listed[^)]*\))?\s*(HKD\s*[$¥]?\s*[\d,.]+|USD\s*[$¥]?\s*[\d,.]+|RMB\s*[$¥]?\s*[\d,.]+)/i);
  const aumText = firstMatch(text, /Total Net Asset Value\s*(HKD\s*[$¥]?\s*[\d,.]+|USD\s*[$¥]?\s*[\d,.]+|RMB\s*[$¥]?\s*[\d,.]+)/i);
  const objective = firstMatch(text, /(?:investment objective(?: and strategy)?(?: of the Fund)?\s*(?:is|are|seeks? to)\s*)([\s\S]{20,700}?)(?=\s+(?:Fund Information|Index Information|Trading Information|Distribution Frequency|Important Information|The Fund)\b)/i)
    || firstMatch(text, /ETF Summary\s*([\s\S]{20,700}?)(?=\s+(?:Research|Fund Information|Index Information|Trading Information|Important Information)\b)/i);
  const factSheetMatch = html.match(/href=["']([^"']+)["'][^>]*>\s*(?:<[^>]+>\s*)*Fact\s*Sheet/iu);
  const managementFee = firstMatch(text, /Management Fee[^%]{0,90}?([\d.]+)%/i);
  const ongoingCharges = firstMatch(text, /Ongoing Charges Over A Year[^%]{0,150}?([\d.]+)%/i);
  const listingDate = firstMatch(text, /SEHK Listing Date\s*(\d{1,2}\s+[A-Z][a-z]{2,8}\s+\d{4}|[A-Z][a-z]{2,8}\s+\d{1,2},\s+\d{4})/i);
  const stockCode = firstMatch(text, /Stock Code\s*(\d{4,5})/i) || seed.stockCode;
  const isin = firstMatch(text, /ISIN\s*([A-Z]{2}[A-Z0-9]{10})/i);
  const boardLot = firstMatch(text, /Board Lot Size\s*([\d,]+)\s*(?:Shares|Units)/i);
  const tradingCurrency = firstMatch(text, /Trading Currency\s*(HKD|USD|RMB)/i);
  const baseCurrency = firstMatch(text, /Base Currency\s*(HKD|USD|RMB)/i);
  const totalUnits = firstMatch(text, /Outstanding Units\s*([\d,.]+)/i);
  const distributionText = firstMatch(text, /Distribution Frequency\s*([\s\S]{1,120}?)(?=\s+(?:NAV Per Share|Fact Sheet|Index Information|Trading Information|Fund Information)\b)/i);
  const benchmark = firstMatch(text, /Underlying Index\s*([\s\S]{3,180}?)(?=\s+(?:Index Type|Base Currency|Closing Level|Change|Trading Information|ETF Summary)\b)/i);
  const nav = parseCurrencyAmount(navText);
  const totalNav = parseCurrencyAmount(aumText);

  const warnings = [];
  if (!pageTitle) warnings.push('页面标题无法解析');
  if (!stockCode) warnings.push('股票代码无法解析');
  if (!listingDate) warnings.push('SEHK 上市日期无法解析');
  if (!nav.value) warnings.push('最新每单位净值无法解析');
  if (!managementFee && !ongoingCharges) warnings.push('费率字段无法解析');

  const managementStyle = seed.managementStyle
    || (/\bpassive ETF\b/i.test(text) ? 'passive' : /\bactive ETF\b/i.test(text) ? 'active' : 'unknown');
  return {
    etf: {
      issuer: 'Global X Hong Kong',
      officialNameEn: pageTitle || seed.expectedName,
      issuerProductUrl: `${baseUrl}${seed.slug}/`,
      assetClass: seed.assetClass || 'other',
      investmentRegion: seed.investmentRegion || null,
      managementStyle,
      investmentObjective: normaliseWhitespace(objective),
      underlyingBenchmark: normaliseWhitespace(benchmark),
      baseCurrency,
      distributionDescription: normaliseWhitespace(distributionText),
      listingDate: parseDate(listingDate),
      asOfDate: parseDate(asOf),
      collectedAt
    },
    listingCounter: {
      exchange: 'HKEX',
      stockCode,
      tradingCurrency,
      isin,
      boardLotSize: parseNumber(boardLot),
      status: 'active_unverified'
    },
    snapshot: {
      asOfDate: parseDate(asOf),
      navPerShare: nav.value,
      navCurrency: nav.currency,
      totalNav: totalNav.value,
      totalNavCurrency: totalNav.currency,
      outstandingUnits: parseNumber(totalUnits),
      managementFeePct: parseNumber(managementFee),
      ongoingChargesPct: parseNumber(ongoingCharges),
      sourceUrl: `${baseUrl}${seed.slug}/`,
      collectedAt
    },
    documents: factSheetMatch
      ? [{ type: 'fact_sheet', url: new URL(factSheetMatch[1], `${baseUrl}${seed.slug}/`).href }]
      : [],
    validation: {
      warnings,
      parserVersion: 'globalx-v0.1'
    }
  };
}

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'HK-ETF-Explorer/0.1 (educational project; public-data collector)',
      'accept-language': 'en-HK,en;q=0.9,zh-HK;q=0.8'
    },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function run() {
  const configuredSeeds = JSON.parse(await readFile(seedPath, 'utf8'));
  const discoveredSeeds = useDiscoveredCandidates
    ? (JSON.parse(await readFile(discoveryPath, 'utf8')).candidates || []).map((candidate) => ({
      slug: candidate.slug,
      expectedName: null,
      stockCode: null
    }))
    : [];
  const allSeeds = useDiscoveredCandidates ? discoveredSeeds : configuredSeeds;
  const seeds = Number.isInteger(requestedLimit) && requestedLimit > 0 ? allSeeds.slice(0, requestedLimit) : allSeeds;
  if (!seeds.length) throw new Error('没有可采集的 ETF 产品页。');
  await mkdir(outputDirectory, { recursive: true });
  const raw = [];
  const processed = [];

  for (const [index, seed] of seeds.entries()) {
    const url = `${baseUrl}${seed.slug}/`;
    try {
      const html = await fetchPage(url);
      raw.push({ stockCode: seed.stockCode, url, collectedAt, ok: true, html });
      const record = parseProductPage(seed, html);
      processed.push(record);
      console.log(`✓ ${record.listingCounter.stockCode || seed.slug} ${record.etf.officialNameEn || seed.slug}`);
    } catch (error) {
      raw.push({ stockCode: seed.stockCode, url, collectedAt, ok: false, error: error.message });
      console.error(`✗ ${seed.stockCode} ${error.message}`);
    }
    // 发现模式会读取更多公开页面，留出间隔以降低对来源网站的压力。
    if (useDiscoveredCandidates && index < seeds.length - 1) await delay(700);
  }

  const rawPath = join(outputDirectory, `raw-globalx-${fileTimestamp}.json`);
  const latestPath = join(outputDirectory, 'processed-globalx-latest.json');
  const browserDataPath = join(outputDirectory, 'processed-globalx-latest.js');
  const browserData = {
    collectedAt,
    source: 'Global X Hong Kong public product pages',
    collectionMode: useDiscoveredCandidates ? 'public sitemap discovery' : 'configured pilot list',
    records: processed
  };
  await writeFile(rawPath, JSON.stringify(raw, null, 2), 'utf8');
  await writeFile(latestPath, JSON.stringify(browserData, null, 2), 'utf8');
  await writeFile(browserDataPath, `window.HK_ETF_DATA = ${JSON.stringify(browserData)};\n`, 'utf8');

  const failed = raw.filter((record) => !record.ok).length;
  const warnings = processed.reduce((total, record) => total + record.validation.warnings.length, 0);
  console.log(`完成：${processed.length}/${seeds.length} 条记录，${warnings} 个字段警告，${failed} 个请求失败。`);
  process.exitCode = failed > 0 ? 1 : 0;
}

run();
