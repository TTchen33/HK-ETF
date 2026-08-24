/**
 * Value ETF 香港公开产品页采集器。
 *
 * 只读取明确配置的公开页面；不采集交易所实时行情，也不绕过来源访问限制。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const configPath = join(root, 'config', 'value-etfs.json');
const dataDirectory = join(root, 'data');
const baseUrl = 'https://www.valueetf.com.hk/eng/';
const collectedAt = new Date().toISOString();

function clean(value) {
  return value
    ?.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim() || null;
}

function first(text, pattern) {
  const match = text?.match(pattern);
  return match ? clean(match[1]) : null;
}

function fundInfoValue(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return first(html, new RegExp(`<li>\\s*${escaped}(?:\\s|[\\d.]|<[^>]*>)*<\\/li>\\s*<ul>\\s*<li>([\\s\\S]*?)<\\/li>`, 'i'));
}

function number(value) {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function amount(value) {
  const match = value?.match(/\b(HKD|USD|RMB)\s*[$¥]?\s*([\d,.]+)/i);
  return match ? { currency: match[1].toUpperCase(), value: number(match[2]) } : { currency: null, value: null };
}

function date(value) {
  const months = { jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06', jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12' };
  const dayFirst = value?.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  const monthFirst = value?.match(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/);
  const match = dayFirst || monthFirst;
  if (!match) return null;
  const day = dayFirst ? match[1] : match[2];
  const monthName = dayFirst ? match[2] : match[1];
  const month = months[monthName.slice(0, 3).toLowerCase()];
  return month ? `${match[3]}-${month}-${day.padStart(2, '0')}` : null;
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

function parseProductPage(seed, html) {
  const text = clean(html);
  const productUrl = new URL(seed.slug, baseUrl).href;
  const title = (first(html, /<title[^>]*>([^<]+)<\/title>/i) || seed.expectedName)
    .replace(/^Value ETF\s*[-|]\s*/i, '')
    .replace(/\s*[-|]\s*Value ETF.*$/i, '')
    .replace(/\s*\(\d{4,5}\s+HK\)$/i, '')
    .trim();
  const objective = first(html, /Investment Objective[\s\S]{0,500}?<div class=["']p_simple["']>\s*<p>([\s\S]*?)<\/p>/i);
  const manager = fundInfoValue(html, 'Manager');
  const benchmark = fundInfoValue(html, 'Index');
  const listingDate = fundInfoValue(html, 'Listing date');
  const stockCode = first(fundInfoValue(html, 'Exchange ticker'), /(\d{4,5})/) || seed.stockCode;
  const tradingCurrency = first(fundInfoValue(html, 'Trading currency'), /\((HKD|USD|RMB)\)/i);
  const baseCurrency = first(fundInfoValue(html, 'Base currency'), /\((HKD|USD|RMB)\)/i);
  const boardLot = first(fundInfoValue(html, 'Trading lot size'), /([\d,]+)\s*(?:Share|Unit)/i);
  const managementFee = first(fundInfoValue(html, 'Management fee'), /([\d.]+)%/i);
  const ongoingCharges = first(fundInfoValue(html, 'Ongoing charges over a year'), /([\d.]+)%/i);
  const priceAsOf = first(html, /id=["']closingPriceDate["'][^>]*>(\d{1,2}[-/]\d{1,2}[-/]\d{4})<\/span>/i);
  const priceSummary = clean((html.match(/Price summary[\s\S]{0,2200}?<\/table>/i) || [''])[0]);
  const priceValues = priceSummary?.match(/Daily closing price\s+Daily closing NAV\s+Assets under management\s+(HKD\s*[\d,.]+|USD\s*[\d,.]+|RMB\s*[\d,.]+)\s+(HKD\s*[\d,.]+|USD\s*[\d,.]+|RMB\s*[\d,.]+)\s+(HKD\s*[\d,.]+|USD\s*[\d,.]+|RMB\s*[\d,.]+)/i);
  const navText = priceValues?.[2] || null;
  const aumText = priceValues?.[3] || null;
  const distribution = fundInfoValue(html, 'Distribution policy');
  const documentMatches = [...html.matchAll(/href=["']([^"']+)["'][^>]*>[\s\S]{0,100}?(?:Fact\s*sheet|Product Key Facts|Prospectus)/gi)];
  const documentUrls = documentMatches.flatMap((match) => {
    try {
      const url = new URL(match[1], productUrl);
      return /^https?:$/.test(url.protocol) ? [url.href] : [];
    } catch {
      return [];
    }
  });
  const documents = [...new Set(documentUrls)].map((url) => ({ type: 'official_document', url }));
  const nav = amount(navText);
  const totalNav = amount(aumText);
  const warnings = [];
  if (!title) warnings.push('页面标题无法解析');
  if (!stockCode) warnings.push('股票代码无法解析');
  if (!objective) warnings.push('投资目标无法解析');
  if (!managementFee && !ongoingCharges) warnings.push('费率字段无法解析');
  if (!nav.value) warnings.push('最新日终净值无法解析');

  return {
    etf: {
      issuer: 'Value Partners Hong Kong Limited',
      officialNameEn: title,
      issuerProductUrl: productUrl,
      assetClass: seed.assetClass || 'other',
      investmentRegion: seed.investmentRegion || null,
      managementStyle: seed.managementStyle || 'unknown',
      investmentObjective: objective,
      underlyingBenchmark: benchmark,
      baseCurrency,
      distributionDescription: distribution,
      listingDate: date(listingDate),
      asOfDate: priceAsOf ? priceAsOf.split(/[-/]/).reverse().join('-') : null,
      collectedAt,
      productStructure: { manager }
    },
    listingCounter: {
      exchange: 'HKEX', stockCode, tradingCurrency, isin: null,
      boardLotSize: number(boardLot), status: 'active_unverified'
    },
    snapshot: {
      asOfDate: priceAsOf ? priceAsOf.split(/[-/]/).reverse().join('-') : null,
      navPerShare: nav.value, navCurrency: nav.currency,
      totalNav: totalNav.value, totalNavCurrency: totalNav.currency,
      outstandingUnits: null, managementFeePct: number(managementFee),
      ongoingChargesPct: number(ongoingCharges), sourceUrl: productUrl, collectedAt
    },
    documents,
    validation: { warnings, parserVersion: 'value-etf-v0.1' }
  };
}

async function run() {
  const seeds = JSON.parse(await readFile(configPath, 'utf8'));
  await mkdir(dataDirectory, { recursive: true });
  const raw = []; const records = [];
  for (const seed of seeds) {
    const url = new URL(seed.slug, baseUrl).href;
    try {
      const html = await fetchPage(url);
      raw.push({ stockCode: seed.stockCode, url, collectedAt, ok: true, html });
      const record = parseProductPage(seed, html);
      records.push(record);
      console.log(`✓ ${record.listingCounter.stockCode} ${record.etf.officialNameEn}`);
    } catch (error) {
      raw.push({ stockCode: seed.stockCode, url, collectedAt, ok: false, error: error.message });
      console.error(`✗ ${seed.stockCode} ${error.message}`);
    }
  }
  const payload = { collectedAt, source: 'Value ETF public product pages', collectionMode: 'configured pilot list', records };
  const timestamp = collectedAt.replace(/[:.]/g, '-');
  await writeFile(join(dataDirectory, `raw-value-etf-${timestamp}.json`), JSON.stringify(raw, null, 2), 'utf8');
  await writeFile(join(dataDirectory, 'processed-value-etf-latest.json'), JSON.stringify(payload, null, 2), 'utf8');
  const failed = raw.filter((item) => !item.ok).length;
  const warnings = records.reduce((total, record) => total + record.validation.warnings.length, 0);
  console.log(`完成：${records.length}/${seeds.length} 条记录，${warnings} 个字段警告，${failed} 个请求失败。`);
  process.exitCode = failed > 0 ? 1 : 0;
}

run();
