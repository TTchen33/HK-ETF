/** 将各发行商已标准化的资料合并为前端直接加载的统一目录。 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const dataDirectory = join(process.cwd(), 'data');
const inputs = ['processed-globalx-latest.json', 'processed-value-etf-latest.json'];
const payloads = await Promise.all(inputs.map(async (file) => JSON.parse(await readFile(join(dataDirectory, file), 'utf8'))));
const records = payloads.flatMap((payload) => payload.records || []);
const collectedAt = payloads.map((payload) => payload.collectedAt).sort().at(-1) || new Date().toISOString();
const catalog = {
  collectedAt,
  source: 'Issuer public product pages',
  collectionMode: 'multi-issuer configured catalog',
  records: records.sort((left, right) => (left.listingCounter.stockCode || '').localeCompare(right.listingCounter.stockCode || ''))
};
await writeFile(join(dataDirectory, 'catalog-latest.json'), JSON.stringify(catalog, null, 2), 'utf8');
await writeFile(join(dataDirectory, 'catalog-latest.js'), `window.HK_ETF_DATA = ${JSON.stringify(catalog)};\n`, 'utf8');
console.log(`目录已更新：${catalog.records.length} 条 ETF，${new Set(records.map((record) => record.etf.issuer)).size} 家发行商。`);
