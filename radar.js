(() => {
  const source = window.HK_ETF_CHANGES;
  if (!source) return;
  const events = source.events || [];
  const categoryLabel = { all: '全部', new: '新基金', removed: '目录消失', fee: '费率', benchmark: '基准', status: '状态', scale: '规模', metadata: '资料' };
  const categoryIcon = { new: '+', removed: '−', fee: '%', benchmark: '↗', status: '!', scale: '◆', metadata: '✎' };
  const severityLabel = { info: '信息', watch: '关注', high: '高关注' };
  let selectedCategory = 'all';
  let visibleCount = 12;

  const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const formatDateTime = (value) => value ? new Intl.DateTimeFormat('zh-HK', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Hong_Kong' }).format(new Date(value)) : '—';
  const formatPct = (value) => value === null || value === undefined ? '未披露' : `${Number(value).toFixed(2)}%`;
  const compact = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return '未披露';
    return number >= 1e9 ? `${(number / 1e9).toFixed(2)}B` : number >= 1e6 ? `${(number / 1e6).toFixed(2)}M` : number.toLocaleString('en-US', { maximumFractionDigits: 0 });
  };

  function detailFor(event) {
    if (event.type === 'product_added') return `上市日期：${event.after?.listingDate || '待确认'}；已加入统一产品目录。`;
    if (event.type === 'product_removed') return `上一状态：${event.before?.status || '未披露'}；需要复核是否下架、改名或来源暂时失效。`;
    if (event.type === 'fee_changed') return `管理费 ${formatPct(event.before?.managementFeePct)} → ${formatPct(event.after?.managementFeePct)}；持续费用 ${formatPct(event.before?.ongoingChargesPct)} → ${formatPct(event.after?.ongoingChargesPct)}。`;
    if (event.type === 'aum_jump') return `${event.before?.currency || ''} ${compact(event.before?.value)} → ${event.after?.currency || ''} ${compact(event.after?.value)}。`;
    const before = typeof event.before === 'object' ? JSON.stringify(event.before) : event.before;
    const after = typeof event.after === 'object' ? JSON.stringify(event.after) : event.after;
    return `${before ?? '未披露'} → ${after ?? '未披露'}`;
  }

  function filteredEvents() {
    return selectedCategory === 'all' ? events : events.filter((event) => event.category === selectedCategory);
  }

  function renderFilters() {
    const categories = ['all', 'new', 'fee', 'benchmark', 'status', 'scale', 'removed', 'metadata'];
    document.getElementById('radarFilters').innerHTML = categories.map((category) => {
      const count = category === 'all' ? events.length : events.filter((event) => event.category === category).length;
      return `<button class="radar-filter ${selectedCategory === category ? 'active' : ''}" data-radar-category="${category}" type="button">${categoryLabel[category]} <b>${count}</b></button>`;
    }).join('');
    document.querySelectorAll('[data-radar-category]').forEach((button) => button.addEventListener('click', () => {
      selectedCategory = button.dataset.radarCategory;
      visibleCount = 12;
      renderFilters();
      renderTimeline();
    }));
  }

  function renderTimeline() {
    const filtered = filteredEvents();
    const shown = filtered.slice(0, visibleCount);
    const container = document.getElementById('radarTimeline');
    if (!shown.length) {
      container.innerHTML = `<div class="radar-empty"><b>该类型暂时没有变化</b><span>后续自动刷新检测到差异时会在这里保留记录。</span></div>`;
    } else {
      container.innerHTML = shown.map((event) => `<article class="radar-event ${escapeHtml(event.severity)}"><div class="event-icon ${escapeHtml(event.category)}">${categoryIcon[event.category] || '•'}</div><div class="event-content"><div class="event-meta"><span>${escapeHtml(categoryLabel[event.category] || event.category)}</span><time>${escapeHtml(formatDateTime(event.detectedAt))}</time><em>${escapeHtml(severityLabel[event.severity] || event.severity)}</em></div><h3><b>${escapeHtml(event.stockCode)}</b>${escapeHtml(event.summary)}</h3><p>${escapeHtml(detailFor(event))}</p><small>${escapeHtml(event.issuer || '发行商待确认')}</small></div>${event.sourceUrl ? `<a href="${escapeHtml(event.sourceUrl)}" target="_blank" rel="noreferrer">核对来源 ↗</a>` : ''}</article>`).join('');
    }
    const more = document.getElementById('radarMore');
    more.hidden = visibleCount >= filtered.length;
    more.textContent = `显示更多变化（剩余 ${Math.max(0, filtered.length - visibleCount)}）`;
  }

  document.getElementById('radarCurrent').textContent = source.currentRecordCount ?? '—';
  document.getElementById('radarAdded').textContent = source.latestSummary?.new ?? 0;
  document.getElementById('radarEvents').textContent = events.length;
  document.getElementById('radarHigh').textContent = events.filter((event) => event.severity === 'high').length;
  document.getElementById('radarVersion').innerHTML = `<b>${source.previousRecordCount} → ${source.currentRecordCount} 只</b><span>最近比较：${escapeHtml(formatDateTime(source.generatedAt))}</span>`;
  document.getElementById('radarMore').addEventListener('click', () => { visibleCount += 12; renderTimeline(); });
  renderFilters();
  renderTimeline();
})();
