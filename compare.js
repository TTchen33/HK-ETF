(() => {
  const analytics = window.HK_ETF_ANALYTICS;
  const marketSource = window.HK_ETF_MARKET;
  const catalogSource = window.HK_ETF_DATA;
  const marketRecords = (marketSource?.records || []).filter((record) => record.status === 'ok' && record.candles?.length >= 20);
  if (!analytics || !marketRecords.length) return;

  const marketByCode = new Map(marketRecords.map((record) => [record.stockCode, record]));
  const catalogByCode = new Map((catalogSource?.records || []).map((record) => [record.listingCounter.stockCode, record]));
  const colors = ['#276cf1', '#e34d59', '#7d62d9'];
  const preferred = ['2806', '2826', '3059'];
  const availableCodes = marketRecords.map((record) => record.stockCode);
  let selectedCodes = preferred.filter((code) => marketByCode.has(code));
  availableCodes.forEach((code) => { if (selectedCodes.length < 3 && !selectedCodes.includes(code)) selectedCodes.push(code); });
  let compareRange = 60;

  const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const signedPct = (value) => finite(value) ? `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(2)}%` : '—';
  const percent = (value) => finite(value) ? `${Number(value).toFixed(2)}%` : '—';
  const compact = (value, prefix = '') => {
    if (!finite(value)) return '—';
    const number = Number(value);
    const absolute = Math.abs(number);
    const text = absolute >= 1e9 ? `${(absolute / 1e9).toFixed(2)}B` : absolute >= 1e6 ? `${(absolute / 1e6).toFixed(2)}M` : absolute >= 1e3 ? `${(absolute / 1e3).toFixed(1)}K` : absolute.toFixed(0);
    return `${number < 0 ? '−' : ''}${prefix}${text}`;
  };
  const nameFor = (code) => catalogByCode.get(code)?.etf?.officialNameEn || marketByCode.get(code)?.name || code;
  const shortName = (code) => nameFor(code).replace(/^Global X /, '').replace(/ ETF$/, '');
  const feeFor = (code) => {
    const snapshot = catalogByCode.get(code)?.snapshot || {};
    const fee = snapshot.managementFeePct ?? snapshot.ongoingChargesPct;
    return finite(fee) ? `${Number(fee).toFixed(2)}%` : '未披露';
  };
  const aumFor = (code) => {
    const snapshot = catalogByCode.get(code)?.snapshot || {};
    const prefix = snapshot.totalNavCurrency === 'HKD' ? 'HK$' : snapshot.totalNavCurrency === 'USD' ? 'US$' : snapshot.totalNavCurrency === 'RMB' ? 'RMB¥' : `${snapshot.totalNavCurrency || ''} `;
    return compact(snapshot.totalNav, prefix);
  };
  const changeClass = (value) => !finite(value) || Number(value) === 0 ? 'flat' : Number(value) > 0 ? 'up' : 'down';

  function populateSelectors() {
    document.querySelectorAll('[data-compare-slot]').forEach((select, slot) => {
      select.innerHTML = marketRecords.map((record) => `<option value="${escapeHtml(record.stockCode)}">${escapeHtml(record.stockCode)} · ${escapeHtml(nameFor(record.stockCode))}</option>`).join('');
      select.value = selectedCodes[slot];
      select.addEventListener('change', () => {
        selectedCodes[slot] = select.value;
        updateDisabledOptions();
        renderLab();
      });
    });
    updateDisabledOptions();
  }

  function updateDisabledOptions() {
    document.querySelectorAll('[data-compare-slot]').forEach((select) => {
      [...select.options].forEach((option) => { option.disabled = selectedCodes.includes(option.value) && option.value !== select.value; });
    });
  }

  function commonSeries() {
    const selected = selectedCodes.map((code) => ({ code, candles: marketByCode.get(code).candles.slice(-(compareRange + 1)) }));
    const commonStart = selected.map((item) => item.candles[0]?.date).filter(Boolean).sort().at(-1);
    return selected.map((item) => {
      const candles = item.candles.filter((candle) => candle.date >= commonStart);
      return { code: item.code, points: analytics.normalizedSeries(candles, Math.max(1, candles.length - 1)) };
    });
  }

  function renderCompareChart() {
    const container = document.getElementById('compareChart');
    const series = commonSeries();
    const allPoints = series.flatMap((item) => item.points.map((point) => point.value));
    if (!allPoints.length) return container.innerHTML = '<div class="chart-empty">没有足够的共同交易日。</div>';
    const width = 900, height = 320, left = 24, right = 58, top = 18, bottom = 36;
    const dates = [...new Set(series.flatMap((item) => item.points.map((point) => point.date)))].sort();
    const dateIndex = new Map(dates.map((date, index) => [date, index]));
    const minRaw = Math.min(...allPoints), maxRaw = Math.max(...allPoints);
    const padding = Math.max((maxRaw - minRaw) * .12, 1);
    const min = minRaw - padding, max = maxRaw + padding;
    const x = (date) => left + dateIndex.get(date) / Math.max(1, dates.length - 1) * (width - left - right);
    const y = (value) => top + (max - value) / (max - min) * (height - top - bottom);
    const grid = Array.from({ length: 5 }, (_, index) => {
      const value = max - (max - min) * index / 4;
      const gridY = y(value);
      return `<line x1="${left}" y1="${gridY}" x2="${width - right}" y2="${gridY}"/><text x="${width - right + 8}" y="${gridY + 4}">${value.toFixed(1)}</text>`;
    }).join('');
    const lines = series.map((item, index) => {
      const path = item.points.map((point, pointIndex) => `${pointIndex ? 'L' : 'M'}${x(point.date).toFixed(2)},${y(point.value).toFixed(2)}`).join(' ');
      const last = item.points.at(-1);
      return `<path d="${path}" style="stroke:${colors[index]}"/><circle cx="${x(last.date)}" cy="${y(last.value)}" r="3.5" style="fill:${colors[index]}"/>`;
    }).join('');
    const tickIndexes = [...new Set([0, Math.floor((dates.length - 1) / 2), dates.length - 1])];
    const labels = tickIndexes.map((index) => `<text class="x-label" x="${x(dates[index])}" y="${height - 8}" text-anchor="middle">${escapeHtml(dates[index].slice(5))}</text>`).join('');
    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><g class="compare-grid">${grid}</g><line class="base-line" x1="${left}" y1="${y(100)}" x2="${width - right}" y2="${y(100)}"/><g class="compare-lines">${lines}</g>${labels}</svg>`;
    document.getElementById('compareLegend').innerHTML = series.map((item, index) => `<span><i style="background:${colors[index]}"></i>${escapeHtml(item.code)}</span>`).join('');
    container.setAttribute('aria-label', `${compareRange} 日标准化收益对比：${series.map((item) => `${item.code} ${item.points.at(-1)?.value?.toFixed(1)}`).join('，')}`);
  }

  function summaries() {
    return selectedCodes.map((code) => ({ code, ...analytics.summarizeMarket(marketByCode.get(code), compareRange) }));
  }

  function renderTable(items) {
    document.getElementById('comparisonTableBody').innerHTML = items.map((item, index) => `<tr><td><i style="background:${colors[index]}"></i><b>${escapeHtml(item.code)}</b><small>${escapeHtml(shortName(item.code))}</small></td><td class="${changeClass(item.cumulativeReturnPct)}">${signedPct(item.cumulativeReturnPct)}</td><td>${percent(item.annualizedVolatilityPct)}</td><td class="down">${signedPct(item.maximumDrawdownPct)}</td><td>${percent(item.positiveDayRatioPct)}</td><td>${compact(item.averageTurnover, 'HK$')}</td><td>${escapeHtml(feeFor(item.code))}</td><td>${escapeHtml(aumFor(item.code))}</td></tr>`).join('');
  }

  function renderInsights(items) {
    const byReturn = [...items].sort((a, b) => b.cumulativeReturnPct - a.cumulativeReturnPct);
    const byVolatility = [...items].sort((a, b) => a.annualizedVolatilityPct - b.annualizedVolatilityPct);
    const byLiquidity = [...items].sort((a, b) => b.averageTurnover - a.averageTurnover);
    const byDrawdown = [...items].sort((a, b) => b.maximumDrawdownPct - a.maximumDrawdownPct);
    const insights = [
      `<b>${byReturn[0].code}</b> 区间价格收益相对领先，为 <strong class="${changeClass(byReturn[0].cumulativeReturnPct)}">${signedPct(byReturn[0].cumulativeReturnPct)}</strong>。`,
      `<b>${byVolatility[0].code}</b> 年化波动率最低（${percent(byVolatility[0].annualizedVolatilityPct)}），历史价格变化相对平稳。`,
      `<b>${byLiquidity[0].code}</b> 近20日平均成交额最高（${compact(byLiquidity[0].averageTurnover, 'HK$')}），在本组中交易最活跃。`,
      `<b>${byDrawdown[0].code}</b> 最大回撤最小（${signedPct(byDrawdown[0].maximumDrawdownPct)}），但仍需结合基金类别与观察窗口理解。`,
    ];
    document.getElementById('compareInsights').innerHTML = insights.map((text, index) => `<article><span>0${index + 1}</span><p>${text}</p></article>`).join('');
  }

  function renderTrust() {
    const bandLabel = { excellent: '优秀', good: '良好', watch: '需关注', risk: '风险' };
    document.getElementById('trustGrid').innerHTML = selectedCodes.map((code, index) => {
      const report = analytics.reliabilityReport(marketByCode.get(code), marketSource, catalogByCode.get(code));
      return `<article class="trust-card"><div class="trust-card-head"><div><span style="color:${colors[index]}">${escapeHtml(code)}</span><b>${escapeHtml(shortName(code))}</b></div><div class="score-ring ${report.band}" style="--score:${report.score}%"><strong>${report.score}</strong><small>${bandLabel[report.band]}</small></div></div><div class="trust-checks">${report.checks.map((check) => `<div><i class="${check.status}"></i><span><b>${escapeHtml(check.label)}</b><small>${escapeHtml(check.detail)}</small></span><em>${check.points}/${check.maximum}</em></div>`).join('')}</div></article>`;
    }).join('');
  }

  function renderLab() {
    const items = summaries();
    renderCompareChart();
    renderTable(items);
    renderInsights(items);
    renderTrust();
  }

  populateSelectors();
  document.querySelectorAll('[data-compare-range]').forEach((button) => button.addEventListener('click', () => {
    compareRange = Number(button.dataset.compareRange);
    document.querySelectorAll('[data-compare-range]').forEach((item) => item.classList.toggle('active', item === button));
    renderLab();
  }));
  renderLab();
})();
