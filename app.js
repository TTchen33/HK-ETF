(() => {
  const source = window.HK_ETF_DATA;
  const marketSource = window.HK_ETF_MARKET;
  const records = source?.records || [];
  const marketRecords = marketSource?.records || [];
  const marketByCode = new Map(marketRecords.map((record) => [record.stockCode, record]));
  const catalogByCode = new Map(records.map((record) => [record.listingCounter.stockCode, record]));
  const grid = document.getElementById('fundGrid');
  const search = document.getElementById('searchInput');
  const dialog = document.getElementById('fundDialog');
  const dialogContent = document.getElementById('dialogContent');
  const marketSelect = document.getElementById('marketSelect');
  let selectedStyle = 'all';
  let selectedMarketCode = marketRecords.find((record) => record.status === 'ok')?.stockCode || marketRecords[0]?.stockCode;
  let chartRange = 60;

  const label = {
    passive: '被动型 ETF', active: '主动型 ETF', unknown: '管理方式待确认',
    equity: '股票', fixed_income: '债券', commodity: '商品', money_market: '货币市场', other: '其他'
  };
  const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const formatDate = (value) => value ? new Intl.DateTimeFormat('zh-HK', { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00`)) : '未披露';
  const formatDateTime = (value) => value ? new Intl.DateTimeFormat('zh-HK', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Hong_Kong' }).format(new Date(value)) : '—';
  const formatAmount = (value, currency) => {
    if (value === null || value === undefined || !currency) return '未披露';
    const symbol = currency === 'HKD' ? 'HK$' : currency === 'USD' ? 'US$' : currency === 'RMB' ? 'RMB¥' : `${currency} `;
    const compact = value >= 1e9 ? `${(value / 1e9).toFixed(2)}B` : value >= 1e6 ? `${(value / 1e6).toFixed(2)}M` : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
    return `${symbol}${compact}`;
  };
  const formatCompact = (value, prefix = '') => {
    if (!finite(value)) return '—';
    const absolute = Math.abs(Number(value));
    const compact = absolute >= 1e9 ? `${(absolute / 1e9).toFixed(2)}B` : absolute >= 1e6 ? `${(absolute / 1e6).toFixed(2)}M` : absolute >= 1e3 ? `${(absolute / 1e3).toFixed(1)}K` : absolute.toLocaleString('en-US', { maximumFractionDigits: 0 });
    return `${Number(value) < 0 ? '−' : ''}${prefix}${compact}`;
  };
  const formatFee = (snapshot) => {
    const fee = snapshot.managementFeePct ?? snapshot.ongoingChargesPct;
    return fee === null || fee === undefined ? '未披露' : `${fee}%`;
  };
  const freshText = () => {
    if (!source?.collectedAt) return '资料文件尚未生成';
    return `最近同步：${new Intl.DateTimeFormat('zh-HK', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Hong_Kong' }).format(new Date(source.collectedAt))}`;
  };
  const changeClass = (value) => !finite(value) || Number(value) === 0 ? 'flat' : Number(value) > 0 ? 'up' : 'down';
  const signed = (value, suffix = '') => !finite(value) ? '—' : `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(2)}${suffix}`;

  function card(record, index) {
    const { etf, listingCounter: counter, snapshot } = record;
    const market = marketByCode.get(counter.stockCode);
    const marketBadge = market?.status === 'ok' ? `<span class="card-market ${changeClass(market.changePct)}">${signed(market.changePct, '%')}</span>` : '';
    return `<article class="fund-card">
      <div class="card-top"><span class="code">${escapeHtml(counter.stockCode)}</span><div>${marketBadge}<span class="style">${escapeHtml(label[etf.managementStyle] || label.unknown)}</span></div></div>
      <h2>${escapeHtml(etf.officialNameEn)}</h2>
      <p class="issuer">${escapeHtml(etf.issuer)} · ${escapeHtml(etf.investmentRegion || '地区待确认')}</p>
      <p class="objective">${escapeHtml(etf.investmentObjective || '投资目标待从官方资料确认。')}</p>
      <div class="mini-metrics"><div><span>最新净值</span><b>${formatAmount(snapshot.navPerShare, snapshot.navCurrency)}</b></div><div><span>费用</span><b>${formatFee(snapshot)}</b></div><div><span>资产规模</span><b>${formatAmount(snapshot.totalNav, snapshot.totalNavCurrency)}</b></div><div><span>交易币种</span><b>${escapeHtml(counter.tradingCurrency || '未披露')}</b></div></div>
      <button class="detail-button" data-record="${index}">查看产品结构与官方来源 →</button>
    </article>`;
  }

  function renderFunds() {
    const term = search.value.trim().toLowerCase();
    const filtered = records.filter((record) => {
      const etf = record.etf;
      const counter = record.listingCounter;
      const matchesStyle = selectedStyle === 'all' || etf.managementStyle === selectedStyle;
      const haystack = [etf.officialNameEn, counter.stockCode, etf.underlyingBenchmark, etf.investmentObjective, etf.issuer].join(' ').toLowerCase();
      return matchesStyle && haystack.includes(term);
    });
    document.getElementById('resultCount').textContent = `显示 ${filtered.length} / ${records.length} 只 ETF`;
    grid.innerHTML = filtered.length ? filtered.map((record) => card(record, records.indexOf(record))).join('') : document.getElementById('emptyState').innerHTML;
    grid.querySelectorAll('[data-record]').forEach((button) => button.addEventListener('click', () => openDetail(records[Number(button.dataset.record)])));
  }

  function row(name, value) { return `<div><span>${escapeHtml(name)}</span><b>${escapeHtml(value || '未披露')}</b></div>`; }
  function openDetail(record) {
    const { etf, listingCounter: counter, snapshot, documents } = record;
    const manager = etf.productStructure?.manager || null;
    const structure = etf.managementStyle === 'passive' ? '被动管理：以追踪目标指数/基准为主要策略' : etf.managementStyle === 'active' ? '主动管理：由管理人按披露策略进行投资' : '待发行商文件确认';
    const officialLinks = [
      `<a href="${escapeHtml(etf.issuerProductUrl)}" target="_blank" rel="noreferrer">发行商产品页 ↗</a>`,
      ...(documents || []).filter((doc) => doc.url).map((doc) => `<a href="${escapeHtml(doc.url)}" target="_blank" rel="noreferrer">${doc.type === 'fact_sheet' ? '基金事实表' : '官方文件'} ↗</a>`)
    ];
    dialogContent.innerHTML = `<p class="eyebrow">${escapeHtml(counter.stockCode)} · ${escapeHtml(label[etf.assetClass] || 'ETF')}</p><h2 class="dialog-title" id="dialogTitle">${escapeHtml(etf.officialNameEn)}</h2><p class="dialog-subtitle">${escapeHtml(etf.issuer)} · 上市日期 ${formatDate(etf.listingDate)}</p>
      <div class="detail-grid">
        ${row('管理方式', label[etf.managementStyle] || '待确认')}${row('基金管理人', manager)}${row('交易柜台', `${counter.stockCode} · ${counter.tradingCurrency || '未披露'}`)}${row('基础币种', etf.baseCurrency)}
        ${row('管理费 / 持续费用', formatFee(snapshot))}${row('每手单位', counter.boardLotSize ? `${counter.boardLotSize} 单位` : null)}${row('ISIN', counter.isin)}
      </div>
      <section class="detail-section"><h3>主要投资什么？</h3><p>${escapeHtml(etf.investmentObjective || '官方投资目标暂未解析。')}</p></section>
      <section class="detail-section"><h3>产品结构</h3><p>${escapeHtml(structure)}${etf.underlyingBenchmark ? `；追踪指数/基准：${escapeHtml(etf.underlyingBenchmark)}` : ''}。具体持仓、复制方式及衍生品安排请以官方文件为准。</p></section>
      <section class="detail-section"><h3>最新公开指标</h3><div class="detail-grid">${row('每单位净值', formatAmount(snapshot.navPerShare, snapshot.navCurrency))}${row('基金规模', formatAmount(snapshot.totalNav, snapshot.totalNavCurrency))}${row('净值对应日期', formatDate(snapshot.asOfDate))}</div></section>
      <section class="detail-section"><h3>官方来源</h3><div class="detail-links">${officialLinks.join('')}</div><p class="data-source">数据来源：${escapeHtml(snapshot.sourceUrl)}<br>系统采集时间：${escapeHtml(new Date(snapshot.collectedAt).toLocaleString('zh-HK'))}</p></section>
      <p class="disclaimer">资料仅供教育与资讯展示。净值、交易价格、交易币种及基础币种可能不同；过去表现不代表未来结果，不构成投资建议。</p>`;
    dialog.showModal();
  }

  function svgPath(points) {
    return points.map((point, index) => `${index ? 'L' : 'M'}${point[0].toFixed(2)},${point[1].toFixed(2)}`).join(' ');
  }

  function renderCandleChart(record) {
    const container = document.getElementById('candleChart');
    const candles = (record?.candles || []).filter((item) => finite(item.open) && finite(item.high) && finite(item.low) && finite(item.close)).slice(-chartRange);
    if (!candles.length) {
      container.innerHTML = '<div class="chart-empty">该 ETF 暂时没有可用的 K 线数据。</div>';
      return;
    }
    const width = 960, height = 420, left = 18, right = 70, priceTop = 18, priceBottom = 300, volumeTop = 326, volumeBottom = 390;
    const plotWidth = width - left - right;
    const minLow = Math.min(...candles.map((item) => Number(item.low)));
    const maxHigh = Math.max(...candles.map((item) => Number(item.high)));
    const padding = Math.max((maxHigh - minLow) * .08, maxHigh * .005);
    const minPrice = minLow - padding, maxPrice = maxHigh + padding;
    const maxVolume = Math.max(...candles.map((item) => Number(item.volume) || 0), 1);
    const step = plotWidth / candles.length;
    const bodyWidth = Math.max(2, Math.min(10, step * .58));
    const x = (index) => left + step * (index + .5);
    const y = (price) => priceTop + (maxPrice - price) / (maxPrice - minPrice) * (priceBottom - priceTop);
    const volumeY = (volume) => volumeBottom - (Number(volume) || 0) / maxVolume * (volumeBottom - volumeTop);
    const gridLines = Array.from({ length: 5 }, (_, index) => {
      const price = maxPrice - (maxPrice - minPrice) * index / 4;
      const lineY = y(price);
      return `<line x1="${left}" y1="${lineY}" x2="${width - right}" y2="${lineY}" class="chart-grid"/><text x="${width - right + 9}" y="${lineY + 4}" class="chart-label">${price.toFixed(price >= 100 ? 1 : 2)}</text>`;
    }).join('');
    const candleShapes = candles.map((item, index) => {
      const up = Number(item.close) >= Number(item.open);
      const colorClass = up ? 'candle-up' : 'candle-down';
      const bodyTop = y(Math.max(item.open, item.close));
      const bodyHeight = Math.max(1.5, Math.abs(y(item.open) - y(item.close)));
      return `<g class="${colorClass}" data-candle-index="${index}"><line x1="${x(index)}" y1="${y(item.high)}" x2="${x(index)}" y2="${y(item.low)}"/><rect x="${x(index) - bodyWidth / 2}" y="${bodyTop}" width="${bodyWidth}" height="${bodyHeight}" rx="1"/><rect class="volume-bar" x="${x(index) - bodyWidth / 2}" y="${volumeY(item.volume)}" width="${bodyWidth}" height="${volumeBottom - volumeY(item.volume)}" rx="1"/></g>`;
    }).join('');
    const maPath = (field, className) => {
      const points = candles.map((item, index) => finite(item[field]) ? [x(index), y(Number(item[field]))] : null).filter(Boolean);
      return points.length > 1 ? `<path d="${svgPath(points)}" class="${className}"/>` : '';
    };
    const tickIndexes = [...new Set([0, Math.floor((candles.length - 1) / 2), candles.length - 1])];
    const xLabels = tickIndexes.map((index) => `<text x="${x(index)}" y="411" text-anchor="middle" class="chart-label">${escapeHtml(candles[index].date.slice(5))}</text>`).join('');
    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">${gridLines}<line x1="${left}" y1="${volumeBottom}" x2="${width - right}" y2="${volumeBottom}" class="chart-axis"/>${candleShapes}${maPath('ma5', 'ma-line ma5-line')}${maPath('ma20', 'ma-line ma20-line')}${xLabels}<g class="chart-crosshair" id="chartCrosshair"><rect class="focus-band" id="chartFocusBand" y="${priceTop}" height="${volumeBottom - priceTop}"/><line class="crosshair-line" id="chartCrosshairX" y1="${priceTop}" y2="${volumeBottom}"/><line class="crosshair-line" id="chartCrosshairY" x1="${left}" x2="${width - right}"/><circle class="crosshair-dot" id="chartCrosshairDot" r="4"/><g class="axis-marker close-marker" id="chartCloseMarker"><rect x="0" y="-10" width="${right - 5}" height="20" rx="5"/><text x="${(right - 5) / 2}" y="4" text-anchor="middle" id="chartCloseLabel">—</text></g><g class="axis-marker date-marker" id="chartDateMarker"><rect x="-29" y="5" width="58" height="19" rx="5"/><text x="0" y="18" text-anchor="middle" id="chartDateLabel">—</text></g></g></svg><div class="ohlc-tooltip" id="ohlcTooltip" aria-hidden="true"></div>`;

    const svg = container.querySelector('svg');
    const crosshair = container.querySelector('#chartCrosshair');
    const crosshairX = container.querySelector('#chartCrosshairX');
    const crosshairY = container.querySelector('#chartCrosshairY');
    const crosshairDot = container.querySelector('#chartCrosshairDot');
    const focusBand = container.querySelector('#chartFocusBand');
    const closeMarker = container.querySelector('#chartCloseMarker');
    const closeLabel = container.querySelector('#chartCloseLabel');
    const dateMarker = container.querySelector('#chartDateMarker');
    const dateLabel = container.querySelector('#chartDateLabel');
    const tooltip = container.querySelector('#ohlcTooltip');
    let activeIndex = candles.length - 1;

    const showCandle = (requestedIndex, inputMode = 'pointer') => {
      const index = Math.max(0, Math.min(candles.length - 1, requestedIndex));
      const item = candles[index];
      const previous = candles[index - 1];
      const candleX = x(index);
      const closeY = y(Number(item.close));
      const delta = previous ? Number(item.close) - Number(previous.close) : null;
      const deltaPct = previous && Number(previous.close) ? delta / Number(previous.close) * 100 : null;
      activeIndex = index;
      crosshair.classList.add('active');
      crosshairX.setAttribute('x1', candleX);
      crosshairX.setAttribute('x2', candleX);
      crosshairY.setAttribute('y1', closeY);
      crosshairY.setAttribute('y2', closeY);
      crosshairDot.setAttribute('cx', candleX);
      crosshairDot.setAttribute('cy', closeY);
      focusBand.setAttribute('x', candleX - step / 2);
      focusBand.setAttribute('width', step);
      closeMarker.setAttribute('transform', `translate(${width - right},${closeY})`);
      closeLabel.textContent = Number(item.close).toFixed(Number(item.close) >= 100 ? 1 : 2);
      dateMarker.setAttribute('transform', `translate(${candleX},${volumeBottom})`);
      dateLabel.textContent = item.date.slice(5);
      container.querySelectorAll('[data-candle-index]').forEach((candle) => candle.classList.toggle('is-selected', Number(candle.dataset.candleIndex) === index));
      tooltip.className = `ohlc-tooltip active ${index > candles.length / 2 ? 'align-left' : 'align-right'}`;
      tooltip.setAttribute('aria-hidden', 'false');
      tooltip.innerHTML = `<div class="tooltip-head"><b>${escapeHtml(item.date)}</b><span class="${changeClass(deltaPct)}">${signed(deltaPct, '%')}</span></div><div class="ohlc-grid"><span>开 <b>${Number(item.open).toFixed(2)}</b></span><span>高 <b>${Number(item.high).toFixed(2)}</b></span><span>低 <b>${Number(item.low).toFixed(2)}</b></span><span>收 <b>${Number(item.close).toFixed(2)}</b></span></div><div class="tooltip-detail"><span>涨跌 <b class="${changeClass(delta)}">${signed(delta)}</b></span><span>成交量 <b>${formatCompact(item.volume)}</b></span><span>MA5 <b>${finite(item.ma5) ? Number(item.ma5).toFixed(2) : '—'}</b></span><span>MA20 <b>${finite(item.ma20) ? Number(item.ma20).toFixed(2) : '—'}</b></span></div>`;
      container.setAttribute('aria-label', `${item.date}，开盘 ${item.open}，最高 ${item.high}，最低 ${item.low}，收盘 ${item.close}，成交量 ${item.volume}`);
      if (inputMode === 'keyboard') tooltip.classList.add('keyboard-active');
    };
    const hideCandle = () => {
      crosshair.classList.remove('active');
      tooltip.className = 'ohlc-tooltip';
      tooltip.setAttribute('aria-hidden', 'true');
      container.querySelectorAll('[data-candle-index]').forEach((candle) => candle.classList.remove('is-selected'));
    };
    const indexFromPointer = (event) => {
      const bounds = svg.getBoundingClientRect();
      const viewX = (event.clientX - bounds.left) / bounds.width * width;
      return Math.floor((viewX - left) / step);
    };
    container.tabIndex = 0;
    container.onpointermove = (event) => showCandle(indexFromPointer(event));
    container.onpointerdown = (event) => showCandle(indexFromPointer(event));
    container.onpointerleave = () => hideCandle();
    container.onfocus = () => showCandle(activeIndex, 'keyboard');
    container.onblur = () => hideCandle();
    container.onkeydown = (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Escape') return hideCandle();
      const target = event.key === 'Home' ? 0 : event.key === 'End' ? candles.length - 1 : activeIndex + (event.key === 'ArrowLeft' ? -1 : 1);
      showCandle(target, 'keyboard');
    };
  }

  function renderMarketTable() {
    const body = document.getElementById('marketTableBody');
    body.innerHTML = marketRecords.map((record) => {
      const catalog = catalogByCode.get(record.stockCode);
      const name = catalog?.etf?.officialNameEn || record.name || record.yahooSymbol;
      if (record.status !== 'ok') return `<tr data-market-code="${escapeHtml(record.stockCode)}"><td><b>${escapeHtml(record.stockCode)}</b><small>${escapeHtml(name)}</small></td><td colspan="5" class="market-error">行情暂不可用</td></tr>`;
      return `<tr data-market-code="${escapeHtml(record.stockCode)}" class="${record.stockCode === selectedMarketCode ? 'selected' : ''}"><td><b>${escapeHtml(record.stockCode)}</b><small>${escapeHtml(name)}</small></td><td>HK$${Number(record.lastPrice).toFixed(2)}</td><td class="${changeClass(record.changePct)}">${signed(record.changePct, '%')}</td><td>${formatCompact(record.volume)}</td><td>${formatCompact(record.turnoverEstimate, 'HK$')}</td><td>${formatDateTime(record.asOf)}</td></tr>`;
    }).join('');
    body.querySelectorAll('[data-market-code]').forEach((tableRow) => tableRow.addEventListener('click', () => selectMarket(tableRow.dataset.marketCode)));
  }

  function renderSelectedMarket() {
    const record = marketByCode.get(selectedMarketCode);
    const available = record?.status === 'ok';
    marketSelect.value = selectedMarketCode || '';
    const setText = (id, value) => { document.getElementById(id).textContent = value; };
    setText('marketLast', available && finite(record.lastPrice) ? `HK$${Number(record.lastPrice).toFixed(2)}` : '—');
    const changeNode = document.getElementById('marketChange');
    changeNode.textContent = available ? signed(record.changePct, '%') : '—';
    changeNode.className = available ? changeClass(record.changePct) : '';
    setText('marketChangeValue', available ? `${signed(record.change)} HKD` : '—');
    setText('marketRange', available && finite(record.high) && finite(record.low) ? `${Number(record.high).toFixed(2)} / ${Number(record.low).toFixed(2)}` : '—');
    setText('marketVolume', available ? formatCompact(record.volume) : '—');
    setText('marketTurnover', available ? formatCompact(record.turnoverEstimate, 'HK$') : '—');
    setText('marketAsOf', available ? formatDateTime(record.asOf) : '行情暂不可用');

    const flow = available ? record.flowProxy : null;
    const net = flow?.netTurnover;
    setText('flowNet', finite(net) ? `${Number(net) >= 0 ? '+' : '−'}HK$${formatCompact(Math.abs(Number(net)))}` : '—');
    const flowNumber = document.getElementById('flowNet');
    flowNumber.className = `flow-number ${changeClass(net)}`;
    setText('flowDirection', finite(net) ? (Number(net) > 0 ? '买入动能占优' : Number(net) < 0 ? '卖出动能占优' : '买卖动能平衡') : '暂时无法估算');
    setText('flowBuy', formatCompact(flow?.buyTurnover, 'HK$'));
    setText('flowSell', formatCompact(flow?.sellTurnover, 'HK$'));
    document.getElementById('flowBuyBar').style.width = `${finite(flow?.buyRatio) ? Math.max(0, Math.min(100, Number(flow.buyRatio))) : 50}%`;
    renderCandleChart(record);
    renderMarketTable();
  }

  function selectMarket(code) {
    if (!marketByCode.has(code)) return;
    selectedMarketCode = code;
    renderSelectedMarket();
  }

  function initializeMarket() {
    const marketUpdated = document.getElementById('marketUpdated');
    if (!marketRecords.length) {
      marketSelect.innerHTML = '<option>行情数据尚未生成</option>';
      marketUpdated.textContent = '等待首次自动采集';
      renderCandleChart(null);
      renderMarketTable();
      return;
    }
    marketSelect.innerHTML = marketRecords.map((record) => `<option value="${escapeHtml(record.stockCode)}">${escapeHtml(record.stockCode)} · ${escapeHtml(catalogByCode.get(record.stockCode)?.etf?.officialNameEn || record.name)}</option>`).join('');
    marketUpdated.textContent = `行情抓取：${formatDateTime(marketSource.fetchedAt)} · 可用 ${marketSource.recordsAvailable}/${marketSource.recordsRequested}`;
    marketSelect.addEventListener('change', () => selectMarket(marketSelect.value));
    document.querySelectorAll('[data-range]').forEach((button) => button.addEventListener('click', () => {
      chartRange = Number(button.dataset.range);
      document.querySelectorAll('[data-range]').forEach((item) => item.classList.toggle('active', item === button));
      renderCandleChart(marketByCode.get(selectedMarketCode));
    }));
    renderSelectedMarket();
  }

  document.getElementById('totalFunds').textContent = records.length;
  document.getElementById('totalIssuers').textContent = new Set(records.map((record) => record.etf.issuer)).size;
  document.getElementById('lastUpdated').textContent = freshText();
  search.addEventListener('input', renderFunds);
  document.querySelectorAll('[data-style]').forEach((button) => button.addEventListener('click', () => { selectedStyle = button.dataset.style; document.querySelectorAll('[data-style]').forEach((item) => item.classList.toggle('active', item === button)); renderFunds(); }));
  document.getElementById('dialogClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  initializeMarket();
  renderFunds();
})();
