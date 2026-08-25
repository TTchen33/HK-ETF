import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CURRENT_PATH = path.join(ROOT, 'data', 'catalog-latest.json');
const HISTORY_PATH = path.join(ROOT, 'data', 'change-history.json');
const JSON_OUTPUT = path.join(ROOT, 'data', 'changes-latest.json');
const JS_OUTPUT = path.join(ROOT, 'data', 'changes-latest.js');

const valueAt = (record, dottedPath) => dottedPath.split('.').reduce((value, key) => value?.[key], record);
const sameValue = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
const recordCode = (record) => String(record?.listingCounter?.stockCode || '');
const recordName = (record) => record?.etf?.officialNameEn || recordCode(record);

function eventId(event) {
  return createHash('sha256').update(JSON.stringify([
    event.type,
    event.stockCode,
    event.before ?? null,
    event.after ?? null,
    event.detectedAt,
  ])).digest('hex').slice(0, 16);
}

function makeEvent({ type, category, severity = 'info', record, detectedAt, summary, before = null, after = null }) {
  const event = {
    type,
    category,
    severity,
    detectedAt,
    stockCode: recordCode(record),
    name: recordName(record),
    issuer: record?.etf?.issuer || null,
    summary,
    before,
    after,
    sourceUrl: record?.etf?.issuerProductUrl || record?.snapshot?.sourceUrl || null,
  };
  return { id: eventId(event), ...event };
}

export function diffCatalogs(previous, current, detectedAt = current?.collectedAt || new Date().toISOString()) {
  const previousMap = new Map((previous?.records || []).map((record) => [recordCode(record), record]));
  const currentMap = new Map((current?.records || []).map((record) => [recordCode(record), record]));
  const events = [];

  currentMap.forEach((record, code) => {
    const beforeRecord = previousMap.get(code);
    if (!beforeRecord) {
      events.push(makeEvent({ type: 'product_added', category: 'new', severity: 'info', record, detectedAt, summary: `发现新 ETF：${recordName(record)}`, after: { stockCode: code, listingDate: record.etf?.listingDate || null } }));
      return;
    }

    const tracked = [
      { path: 'etf.officialNameEn', type: 'name_changed', category: 'metadata', label: '基金名称', severity: 'watch' },
      { path: 'etf.underlyingBenchmark', type: 'benchmark_changed', category: 'benchmark', label: '追踪指数／基准', severity: 'watch' },
      { path: 'etf.managementStyle', type: 'style_changed', category: 'metadata', label: '管理方式', severity: 'watch' },
      { path: 'listingCounter.status', type: 'status_changed', category: 'status', label: '交易状态', severity: 'high' },
    ];
    tracked.forEach((field) => {
      const before = valueAt(beforeRecord, field.path) ?? null;
      const after = valueAt(record, field.path) ?? null;
      if (!sameValue(before, after)) events.push(makeEvent({ type: field.type, category: field.category, severity: field.severity, record, detectedAt, summary: `${field.label}发生变化`, before, after }));
    });

    const beforeFee = { managementFeePct: beforeRecord.snapshot?.managementFeePct ?? null, ongoingChargesPct: beforeRecord.snapshot?.ongoingChargesPct ?? null };
    const afterFee = { managementFeePct: record.snapshot?.managementFeePct ?? null, ongoingChargesPct: record.snapshot?.ongoingChargesPct ?? null };
    if (!sameValue(beforeFee, afterFee)) events.push(makeEvent({ type: 'fee_changed', category: 'fee', severity: 'high', record, detectedAt, summary: '管理费／持续费用发生变化', before: beforeFee, after: afterFee }));

    const beforeAum = Number(beforeRecord.snapshot?.totalNav);
    const afterAum = Number(record.snapshot?.totalNav);
    const sameCurrency = beforeRecord.snapshot?.totalNavCurrency && beforeRecord.snapshot?.totalNavCurrency === record.snapshot?.totalNavCurrency;
    if (sameCurrency && Number.isFinite(beforeAum) && beforeAum > 0 && Number.isFinite(afterAum)) {
      const changePct = (afterAum / beforeAum - 1) * 100;
      if (Math.abs(changePct) >= 20) events.push(makeEvent({ type: 'aum_jump', category: 'scale', severity: Math.abs(changePct) >= 50 ? 'high' : 'watch', record, detectedAt, summary: `基金规模较上一版本${changePct > 0 ? '增加' : '减少'} ${Math.abs(changePct).toFixed(1)}%`, before: { value: beforeAum, currency: record.snapshot.totalNavCurrency }, after: { value: afterAum, currency: record.snapshot.totalNavCurrency, changePct: Number(changePct.toFixed(2)) } }));
    }
  });

  previousMap.forEach((record, code) => {
    if (!currentMap.has(code)) events.push(makeEvent({ type: 'product_removed', category: 'removed', severity: 'high', record, detectedAt, summary: `ETF 已从当前采集目录消失：${recordName(record)}`, before: { stockCode: code, status: record.listingCounter?.status || null } }));
  });

  return events.sort((left, right) => right.detectedAt.localeCompare(left.detectedAt) || left.stockCode.localeCompare(right.stockCode));
}

export function mergeHistory(existingEvents = [], currentEvents = [], limit = 500) {
  const unique = new Map();
  [...currentEvents, ...existingEvents].forEach((event) => { if (!unique.has(event.id)) unique.set(event.id, event); });
  return [...unique.values()].sort((left, right) => right.detectedAt.localeCompare(left.detectedAt) || left.stockCode.localeCompare(right.stockCode)).slice(0, limit);
}

function summarize(events) {
  const categories = ['new', 'removed', 'fee', 'benchmark', 'status', 'scale', 'metadata'];
  return Object.fromEntries([['total', events.length], ...categories.map((category) => [category, events.filter((event) => event.category === category).length])]);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const useStdin = process.argv.includes('--previous-stdin');
  const previousArg = process.argv.find((argument) => argument.startsWith('--previous='));
  const currentArg = process.argv.find((argument) => argument.startsWith('--current='));
  const previousText = useStdin
    ? await readStdin()
    : await readFile(previousArg ? path.resolve(ROOT, previousArg.split('=').slice(1).join('=')) : path.join(ROOT, 'data', 'catalog-previous.json'), 'utf8');
  const currentPath = currentArg ? path.resolve(ROOT, currentArg.split('=').slice(1).join('=')) : CURRENT_PATH;
  const current = JSON.parse(await readFile(currentPath, 'utf8'));
  const previous = JSON.parse(previousText);
  let existingEvents = [];
  try {
    existingEvents = JSON.parse(await readFile(HISTORY_PATH, 'utf8')).events || [];
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const generatedAt = new Date().toISOString();
  const detectedAt = current.collectedAt || generatedAt;
  const latestEvents = diffCatalogs(previous, current, detectedAt);
  const history = mergeHistory(existingEvents, latestEvents);
  const payload = {
    schemaVersion: 'catalog-change-radar-v1',
    generatedAt,
    previousCollectedAt: previous.collectedAt || null,
    currentCollectedAt: current.collectedAt || null,
    previousRecordCount: previous.records?.length || 0,
    currentRecordCount: current.records?.length || 0,
    latestSummary: summarize(latestEvents),
    historySummary: summarize(history),
    events: history,
    methodology: 'Compares normalized catalog versions; ignores routine NAV changes and records AUM only when the absolute change is at least 20%.',
  };
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  await writeFile(JSON_OUTPUT, serialized, 'utf8');
  await writeFile(JS_OUTPUT, `window.HK_ETF_CHANGES = ${serialized.trim()};\n`, 'utf8');
  await writeFile(HISTORY_PATH, `${JSON.stringify({ schemaVersion: payload.schemaVersion, events: history }, null, 2)}\n`, 'utf8');
  console.log(`Change radar: ${latestEvents.length} new events, ${history.length} retained events.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
