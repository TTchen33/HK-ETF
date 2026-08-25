(function exposeAnalytics(root) {
  const isFiniteNumber = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const round = (value, digits = 2) => isFiniteNumber(value) ? Number(Number(value).toFixed(digits)) : null;
  const validCandles = (candles = []) => candles.filter((item) => isFiniteNumber(item.close));

  function windowCandles(candles = [], days = 60, includeBase = true) {
    const valid = validCandles(candles);
    const size = Math.max(2, Number(days) + (includeBase ? 1 : 0));
    return valid.slice(-size);
  }

  function dailyReturns(candles = [], days = 60) {
    const selected = windowCandles(candles, days, true);
    return selected.slice(1).map((item, index) => Number(item.close) / Number(selected[index].close) - 1).filter(Number.isFinite);
  }

  function cumulativeReturn(candles = [], days = 60) {
    const selected = windowCandles(candles, days, true);
    if (selected.length < 2 || !Number(selected[0].close)) return null;
    return round((Number(selected.at(-1).close) / Number(selected[0].close) - 1) * 100);
  }

  function annualizedVolatility(candles = [], days = 60) {
    const returns = dailyReturns(candles, days);
    if (returns.length < 2) return null;
    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
    return round(Math.sqrt(variance) * Math.sqrt(252) * 100);
  }

  function maximumDrawdown(candles = [], days = 60) {
    const selected = windowCandles(candles, days, true);
    if (selected.length < 2) return null;
    let peak = Number(selected[0].close);
    let drawdown = 0;
    selected.forEach((item) => {
      const close = Number(item.close);
      peak = Math.max(peak, close);
      drawdown = Math.min(drawdown, close / peak - 1);
    });
    return round(drawdown * 100);
  }

  function averageTurnover(candles = [], days = 20) {
    const selected = windowCandles(candles, days, false).filter((item) => isFiniteNumber(item.volume));
    if (!selected.length) return null;
    return round(selected.reduce((sum, item) => sum + Number(item.close) * Number(item.volume), 0) / selected.length, 2);
  }

  function positiveDayRatio(candles = [], days = 60) {
    const returns = dailyReturns(candles, days);
    if (!returns.length) return null;
    return round(returns.filter((value) => value > 0).length / returns.length * 100);
  }

  function normalizedSeries(candles = [], days = 60) {
    const selected = windowCandles(candles, days, true);
    if (!selected.length || !Number(selected[0].close)) return [];
    const base = Number(selected[0].close);
    return selected.map((item) => ({ date: item.date, value: round(Number(item.close) / base * 100, 4) }));
  }

  function summarizeMarket(record, days = 60) {
    const candles = record?.candles || [];
    return {
      stockCode: record?.stockCode,
      days,
      observations: windowCandles(candles, days, true).length,
      cumulativeReturnPct: cumulativeReturn(candles, days),
      annualizedVolatilityPct: annualizedVolatility(candles, days),
      maximumDrawdownPct: maximumDrawdown(candles, days),
      averageTurnover: averageTurnover(candles, Math.min(days, 20)),
      positiveDayRatioPct: positiveDayRatio(candles, days),
      normalized: normalizedSeries(candles, days),
    };
  }

  function ageHours(value, now = new Date()) {
    if (!value) return null;
    const timestamp = new Date(value);
    if (Number.isNaN(timestamp.getTime())) return null;
    return Math.max(0, (now.getTime() - timestamp.getTime()) / 36e5);
  }

  function ageDays(value, now = new Date()) {
    if (!value) return null;
    const normalized = String(value).length === 10 ? `${value}T23:59:59+08:00` : value;
    const hours = ageHours(normalized, now);
    return hours === null ? null : hours / 24;
  }

  function reliabilityReport(record, marketSource = {}, catalogRecord = {}, now = new Date()) {
    const candles = record?.candles || [];
    const marketAge = ageHours(marketSource.fetchedAt, now);
    const marketPoints = marketAge === null ? 0 : marketAge <= 36 ? 30 : marketAge <= 96 ? 24 : marketAge <= 168 ? 12 : 4;
    const coveragePoints = candles.length >= 60 ? 25 : candles.length >= 40 ? 20 : candles.length >= 20 ? 15 : candles.length ? 5 : 0;
    const invalidCandles = candles.filter((item) => {
      if (![item.open, item.high, item.low, item.close, item.volume].every(isFiniteNumber)) return true;
      return Number(item.high) < Math.max(Number(item.open), Number(item.close)) || Number(item.low) > Math.min(Number(item.open), Number(item.close)) || Number(item.volume) < 0;
    }).length;
    const consistencyPoints = candles.length ? Math.floor(25 * (1 - invalidCandles / candles.length)) : 0;
    const lineageComplete = Boolean(marketSource.provider && record?.yahooSymbol && record?.asOf && record?.status === 'ok');
    const lineagePoints = lineageComplete ? 10 : 4;
    const productDate = catalogRecord?.snapshot?.asOfDate || catalogRecord?.etf?.asOfDate;
    const productAge = ageDays(productDate, now);
    const productPoints = productAge === null ? 0 : productAge <= 7 ? 10 : productAge <= 14 ? 7 : productAge <= 30 ? 3 : 1;
    const score = Math.round(marketPoints + coveragePoints + consistencyPoints + lineagePoints + productPoints);
    const band = score >= 90 ? 'excellent' : score >= 75 ? 'good' : score >= 60 ? 'watch' : 'risk';
    const status = (points, maximum) => points === maximum ? 'pass' : points >= maximum * .5 ? 'warn' : 'fail';
    return {
      score,
      band,
      invalidCandles,
      checks: [
        { key: 'freshness', label: '行情时效', points: marketPoints, maximum: 30, status: status(marketPoints, 30), detail: marketAge === null ? '缺少抓取时间' : `${round(marketAge, 1)} 小时前抓取` },
        { key: 'coverage', label: '历史覆盖', points: coveragePoints, maximum: 25, status: status(coveragePoints, 25), detail: `${candles.length} 根有效日线` },
        { key: 'consistency', label: 'OHLC 一致性', points: consistencyPoints, maximum: 25, status: status(consistencyPoints, 25), detail: invalidCandles ? `${invalidCandles} 根异常` : '未发现结构异常' },
        { key: 'lineage', label: '来源链路', points: lineagePoints, maximum: 10, status: status(lineagePoints, 10), detail: lineageComplete ? `${marketSource.provider} · ${record.yahooSymbol}` : '来源字段不完整' },
        { key: 'product', label: '产品资料', points: productPoints, maximum: 10, status: status(productPoints, 10), detail: productAge === null ? '缺少资料日期' : `${round(productAge, 1)} 天前更新` },
      ],
    };
  }

  const api = {
    dailyReturns,
    cumulativeReturn,
    annualizedVolatility,
    maximumDrawdown,
    averageTurnover,
    positiveDayRatio,
    normalizedSeries,
    summarizeMarket,
    reliabilityReport,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.HK_ETF_ANALYTICS = api;
})(typeof window !== 'undefined' ? window : globalThis);
