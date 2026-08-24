/**
 * 只读开发辅助工具：检查 HKEX 公开 ETP 目录的页面资源。
 * 目的：识别是否存在适合长期自动化的公开主名单入口。
 * 不下载付费市场数据、不提交表单、不绕过限制。
 */

const catalogUrl = 'https://www.hkex.com.hk/Market-Data/Securities-Prices/Exchange-Traded-Products?sc_lang=en';
const response = await fetch(catalogUrl, {
  headers: { 'user-agent': 'HK-ETF-Explorer/0.1 (public catalog research)' },
  signal: AbortSignal.timeout(20_000)
});
const html = await response.text();
const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)/gi)].map((match) => new URL(match[1], catalogUrl).href);
const endpointLikeStrings = [...new Set(
  [...html.matchAll(/(?:https?:)?\/\/[^"'<>\s]+|\/[A-Za-z0-9_./?=&-]*(?:api|quote|etp|product)[A-Za-z0-9_./?=&-]*/gi)]
    .map((match) => match[0])
    .filter((value) => value.length > 12)
)].slice(0, 80);
const etpsScriptUrl = scripts.find((url) => /\/etps\.js/i.test(url));
const etpsScript = etpsScriptUrl ? await (await fetch(etpsScriptUrl, { signal: AbortSignal.timeout(20_000) })).text() : '';
const abstractScriptUrl = scripts.find((url) => /\/abstractpageobj\.js/i.test(url));
const configScriptUrl = scripts.find((url) => /\/ssdlconfig\.js/i.test(url));
const [abstractScript, configScript] = await Promise.all([
  abstractScriptUrl ? fetch(abstractScriptUrl, { signal: AbortSignal.timeout(20_000) }).then((response) => response.text()) : '',
  configScriptUrl ? fetch(configScriptUrl, { signal: AbortSignal.timeout(20_000) }).then((response) => response.text()) : ''
]);
const scriptSignals = etpsScript
  .split(/(?<=[;{}])/)
  .filter((line) => /(ajax|url\s*:|api|json|etp)/i.test(line))
  .map((line) => line.trim())
  .filter(Boolean)
  .slice(0, 120);
const loaderIndex = abstractScript.indexOf('loaddata: function');
const loaderContext = loaderIndex >= 0 ? abstractScript.slice(loaderIndex, loaderIndex + 2600) : null;
const filterCallIndex = etpsScript.indexOf('loaddata("getetpfilter"');
const filterCallContext = filterCallIndex >= 0
  ? etpsScript.slice(Math.max(0, filterCallIndex - 2600), filterCallIndex + 500)
  : null;
const configSignals = configScript
  .split(/(?<=[;{}])/)
  .filter((line) => /(url|service|api|endpoint)/i.test(line))
  .map((line) => line.trim())
  .filter(Boolean)
  .slice(0, 40);
const candidateCatalogUrl = 'https://www1.hkex.com.hk/hkexwidget/data/getetpfilter?lang=en&all=1';
const candidateResponse = await fetch(candidateCatalogUrl, {
  headers: {
    'user-agent': 'Mozilla/5.0 (compatible; HK-ETF-Explorer/0.1)',
    'referer': catalogUrl,
    'origin': 'https://www.hkex.com.hk',
    'accept': 'application/json, text/javascript, */*; q=0.01'
  },
  signal: AbortSignal.timeout(20_000)
});
const candidateBody = await candidateResponse.text();

console.log(JSON.stringify({
  status: response.status,
  bytes: html.length,
  scriptUrls: scripts,
  endpointLikeStrings,
  etpsScriptUrl,
  scriptSignals,
  abstractScriptUrl,
  loaderContext,
  filterCallContext,
  configScriptUrl,
  configSignals,
  candidateCatalogUrl,
  candidateStatus: candidateResponse.status,
  candidatePreview: candidateBody.slice(0, 1000)
}, null, 2));
