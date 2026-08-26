(() => {
  const analytics = window.HK_ETF_ANALYTICS;
  const marketSource = window.HK_ETF_MARKET;
  const catalogSource = window.HK_ETF_DATA;
  if (!analytics || !marketSource || !catalogSource) return;

  const catalogByCode = new Map((catalogSource.records || []).map((record) => [record.listingCounter.stockCode, record]));
  const marketRecords = (marketSource.records || []).filter((record) => record.status === 'ok');
  const rows = marketRecords.map((record) => ({
    record,
    catalog: catalogByCode.get(record.stockCode),
    result: analytics.premiumDiscount(record, catalogByCode.get(record.stockCode), marketSource),
  })).sort((a, b) => {
    if (a.result.status === 'unavailable' && b.result.status !== 'unavailable') return 1;
    if (b.result.status === 'unavailable' && a.result.status !== 'unavailable') return -1;
    return Math.abs(b.result.premiumPct || 0) - Math.abs(a.result.premiumPct || 0);
  });
  let selectedFilter = 'all';
  let selectedCode = rows.find((item) => item.result.status !== 'unavailable')?.record.stockCode;

  const finite = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));
  const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const price = (value) => finite(value) ? `HK$${Number(value).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}` : '—';
  const pct = (value) => finite(value) ? `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(2)}%` : '—';
  const directionLabel = { premium: '溢价', discount: '折价', flat: '接近平价' };
  const statusLabel = { matched: '日期已对齐', estimated: '近似换算', unavailable: '不可计算' };
  const shortName = (item) => item.catalog?.etf?.officialNameEn || item.record.name || item.record.stockCode;

  function renderSummary() {
    const usable = rows.filter((item) => item.result.status !== 'unavailable');
    const premium = usable.filter((item) => item.result.direction === 'premium');
    const discount = usable.filter((item) => item.result.direction === 'discount');
    const largest = [...usable].sort((a, b) => Math.abs(b.result.premiumPct) - Math.abs(a.result.premiumPct))[0];
    document.getElementById('premiumCoverage').textContent = `${usable.length}/${rows.length}`;
    document.getElementById('premiumCount').textContent = premium.length;
    document.getElementById('discountCount').textContent = discount.length;
    document.getElementById('premiumLargest').textContent = largest ? `${largest.record.stockCode} · ${pct(largest.result.premiumPct)}` : '—';
  }

  function filteredRows() {
    if (selectedFilter === 'unavailable') return rows.filter((item) => item.result.status === 'unavailable');
    if (selectedFilter === 'all') return rows;
    return rows.filter((item) => item.result.direction === selectedFilter && item.result.status !== 'unavailable');
  }

  function renderFilters() {
    const filters = [['all', '全部'], ['premium', '溢价'], ['discount', '折价'], ['unavailable', '不可计算']];
    document.getElementById('premiumFilters').innerHTML = filters.map(([key, label]) => `<button type="button" class="premium-filter ${key === selectedFilter ? 'active' : ''}" data-premium-filter="${key}">${label} <b>${key === 'all' ? rows.length : key === 'unavailable' ? rows.filter((item) => item.result.status === 'unavailable').length : rows.filter((item) => item.result.direction === key && item.result.status !== 'unavailable').length}</b></button>`).join('');
    document.querySelectorAll('[data-premium-filter]').forEach((button) => button.addEventListener('click', () => {
      selectedFilter = button.dataset.premiumFilter;
      renderFilters();
      renderTable();
    }));
  }

  function renderTable() {
    const body = document.getElementById('premiumTableBody');
    const visible = filteredRows();
    body.innerHTML = visible.map((item) => {
      const result = item.result;
      const unavailable = result.status === 'unavailable';
      const magnitude = unavailable ? 0 : Math.min(100, Math.abs(result.premiumPct) * 18);
      return `<tr data-premium-code="${escapeHtml(item.record.stockCode)}" class="${item.record.stockCode === selectedCode ? 'selected' : ''}"><td><b>${escapeHtml(item.record.stockCode)}</b><small>${escapeHtml(shortName(item))}</small></td><td>${escapeHtml(result.navDate || '—')}</td><td>${unavailable ? '—' : `${Number(result.nav).toFixed(4)} ${escapeHtml(result.navCurrency)}`}</td><td>${unavailable ? '—' : `${Number(result.fxRate).toFixed(result.fxRate === 1 ? 0 : 4)}<small>${escapeHtml(result.fxPair)}</small>`}</td><td>${unavailable ? '—' : price(result.navHkd)}</td><td>${unavailable ? '—' : price(result.close)}</td><td><div class="premium-value ${unavailable ? 'flat' : result.direction === 'premium' ? 'up' : result.direction === 'discount' ? 'down' : 'flat'}"><b>${pct(result.premiumPct)}</b><span><i style="width:${magnitude}%"></i></span></div></td><td><em class="premium-status ${escapeHtml(result.status)}">${statusLabel[result.status]}</em></td></tr>`;
    }).join('') || '<tr><td colspan="8" class="premium-empty">该筛选条件下暂无记录。</td></tr>';
    document.querySelectorAll('[data-premium-code]').forEach((row) => row.addEventListener('click', () => {
      selectedCode = row.dataset.premiumCode;
      renderTable();
      renderDetail();
    }));
  }

  function renderDetail() {
    const item = rows.find((row) => row.record.stockCode === selectedCode);
    const container = document.getElementById('premiumDetail');
    if (!item) return container.innerHTML = '<p>目前没有可展示的计算记录。</p>';
    const result = item.result;
    if (result.status === 'unavailable') {
      container.innerHTML = `<div><p class="eyebrow">CALCULATION TRACE · ${escapeHtml(item.record.stockCode)}</p><h3>${escapeHtml(shortName(item))}</h3></div><div class="premium-unavailable"><b>此记录不可计算</b><span>${escapeHtml(result.reason)}</span></div>`;
      return;
    }
    const formula = `${Number(result.nav).toFixed(4)} ${escapeHtml(result.navCurrency)} × ${Number(result.fxRate).toFixed(result.fxRate === 1 ? 0 : 4)} = ${price(result.navHkd)}`;
    container.innerHTML = `<div><p class="eyebrow">CALCULATION TRACE · ${escapeHtml(item.record.stockCode)}</p><h3>${escapeHtml(shortName(item))}</h3><small>${escapeHtml(result.reason)}</small></div><div class="premium-formula"><span>每单位净值换算</span><b>${formula}</b></div><div class="premium-arrow">→</div><div class="premium-formula"><span>${escapeHtml(result.closeDate)} 收盘价</span><b>${price(result.close)}</b></div><div class="premium-result ${result.direction === 'premium' ? 'up' : result.direction === 'discount' ? 'down' : 'flat'}"><span>${directionLabel[result.direction]}</span><b>${pct(result.premiumPct)}</b></div>`;
  }

  renderSummary();
  renderFilters();
  renderTable();
  renderDetail();
})();
