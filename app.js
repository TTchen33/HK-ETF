(() => {
  const source = window.HK_ETF_DATA;
  const records = source?.records || [];
  const grid = document.getElementById('fundGrid');
  const search = document.getElementById('searchInput');
  const dialog = document.getElementById('fundDialog');
  const dialogContent = document.getElementById('dialogContent');
  let selectedStyle = 'all';

  const label = {
    passive: '被动型 ETF', active: '主动型 ETF', unknown: '管理方式待确认',
    equity: '股票', fixed_income: '债券', commodity: '商品', money_market: '货币市场', other: '其他'
  };
  const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const formatDate = (value) => value ? new Intl.DateTimeFormat('zh-HK', { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00`)) : '未披露';
  const formatAmount = (value, currency) => {
    if (value === null || value === undefined || !currency) return '未披露';
    const symbol = currency === 'HKD' ? 'HK$' : currency === 'USD' ? 'US$' : currency === 'RMB' ? 'RMB¥' : `${currency} `;
    const compact = value >= 1e9 ? `${(value / 1e9).toFixed(2)}B` : value >= 1e6 ? `${(value / 1e6).toFixed(2)}M` : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
    return `${symbol}${compact}`;
  };
  const formatFee = (snapshot) => {
    const fee = snapshot.managementFeePct ?? snapshot.ongoingChargesPct;
    return fee === null || fee === undefined ? '未披露' : `${fee}%`;
  };
  const freshText = () => {
    if (!source?.collectedAt) return '资料文件尚未生成';
    return `最近同步：${new Intl.DateTimeFormat('zh-HK', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Hong_Kong' }).format(new Date(source.collectedAt))}`;
  };
  function card(record, index) {
    const { etf, listingCounter: counter, snapshot } = record;
    return `<article class="fund-card">
      <div class="card-top"><span class="code">${escapeHtml(counter.stockCode)}</span><span class="style">${escapeHtml(label[etf.managementStyle] || label.unknown)}</span></div>
      <h2>${escapeHtml(etf.officialNameEn)}</h2>
      <p class="issuer">${escapeHtml(etf.issuer)} · ${escapeHtml(etf.investmentRegion || '地区待确认')}</p>
      <p class="objective">${escapeHtml(etf.investmentObjective || '投资目标待从官方资料确认。')}</p>
      <div class="mini-metrics"><div><span>最新净值</span><b>${formatAmount(snapshot.navPerShare, snapshot.navCurrency)}</b></div><div><span>费用</span><b>${formatFee(snapshot)}</b></div><div><span>资产规模</span><b>${formatAmount(snapshot.totalNav, snapshot.totalNavCurrency)}</b></div><div><span>交易币种</span><b>${escapeHtml(counter.tradingCurrency || '未披露')}</b></div></div>
      <button class="detail-button" data-record="${index}">查看产品结构与官方来源 →</button>
    </article>`;
  }
  function render() {
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
  document.getElementById('totalFunds').textContent = records.length;
  document.getElementById('totalIssuers').textContent = new Set(records.map((record) => record.etf.issuer)).size;
  document.getElementById('lastUpdated').textContent = freshText();
  search.addEventListener('input', render);
  document.querySelectorAll('[data-style]').forEach((button) => button.addEventListener('click', () => { selectedStyle = button.dataset.style; document.querySelectorAll('[data-style]').forEach((item) => item.classList.toggle('active', item === button)); render(); }));
  document.getElementById('dialogClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  render();
})();
