import { useEffect, useRef } from 'react';
import Link from 'next/link';
import styles from './index.module.css';
import { supabase } from '../lib/supabase'
import { useCalculation } from '../lib/CalculationContext';


function fmt(n) { if (!isFinite(n)) return '--'; return Number(n).toFixed(4) }
function fmtMoney(n) { if (!isFinite(n)) return '--'; return Number(n).toFixed(2) }
function hours() { return Array.from({ length: 24 }, (_, i) => `${i}点`) }
const defaultFactors = { flat: 1, spike: 2, peak: 1.7, valley: 0.3, deep: 0.1 }

function classify(cons, count = 3) {
  const labels = Array.from({ length: 24 }, () => '平')
  const high = new Set()
  const low = new Set()
  const mid = new Set(Array.from({ length: 24 }, (_, i) => i))
  return { labels, high, mid, low }
}

function computePrices(cons, groups, expected, f = defaultFactors) {
  const fs = cons.map((_, i) => {
    const l = groups.labels && groups.labels[i] ? groups.labels[i] : '平'
    if (l === '尖峰') return Number(f.spike) || 2
    if (l === '峰') return Number(f.peak) || 1.7
    if (l === '谷') return Number(f.valley) || 0.3
    if (l === '深谷') return Number(f.deep) || 0.1
    return Number(f.flat) || 1
  })
  let denom = 0; for (let i = 0; i < cons.length; i++) denom += cons[i] * fs[i]
  if (denom <= 0) return null; const pFlat = expected / denom
  const pSpike = pFlat * ((Number(f.spike) || 2))
  const pPeak = pFlat * ((Number(f.peak) || 1.7))
  const pValley = pFlat * ((Number(f.valley) || 0.3))
  const pDeep = pFlat * ((Number(f.deep) || 0.1))
  const pricePerHour = cons.map((_, i) => pFlat * fs[i])
  let revenue = 0; for (let i = 0; i < cons.length; i++) revenue += cons[i] * pricePerHour[i]
  return { pDeep, pValley, pFlat, pPeak, pSpike, pricePerHour, revenue }
}

function mergeTemplate(cons, tplMonth) {
  const toIdx = arr => (Array.isArray(arr) ? arr : []).map(i => parseInt(i, 10)).filter(i => !isNaN(i) && i >= 0 && i < 24)
  const spikes = new Set(toIdx(tplMonth && tplMonth.spikes))
  const peaks = new Set(toIdx(tplMonth && tplMonth.peaks))
  const valleys = new Set(toIdx(tplMonth && tplMonth.valleys))
  const deeps = new Set(toIdx(tplMonth && tplMonth.deeps))
  const labels = Array.from({ length: 24 }, (_, i) => (spikes.has(i) ? '尖峰' : (peaks.has(i) ? '峰' : (valleys.has(i) ? '谷' : (deeps.has(i) ? '深谷' : '平')))))
  const mid = new Set(labels.map((l, i) => l === '平' ? i : -1).filter(i => i >= 0))
  const spike = new Set(labels.map((l, i) => l === '尖峰' ? i : -1).filter(i => i >= 0))
  const deep = new Set(labels.map((l, i) => l === '深谷' ? i : -1).filter(i => i >= 0))
  return { labels, high: peaks, mid, low: valleys, spike, deep }
}

export default function IndexPage() {
  const {
    file, setFile,
    fileName, setFileName,
    expected, setExpected,
    parsed, setParsed,
    months, setMonths,
    monthIdx, setMonthIdx,
    scope, setScope,
    consumption, setConsumption,
    groups, setGroups,
    basePrices, setBasePrices,
    prices, setPrices,
    companies, setCompanies,
    selected, setSelected,
    error, setError,
    peakValleyCount, setPeakValleyCount,
    calendarConfigs, setCalendarConfigs,
    currentCalendarMonth, setCurrentCalendarMonth,
    templates, setTemplates,
    templateSelectedId, setTemplateSelectedId,
    factors, setFactors
  } = useCalculation();

  const chartRef = useRef(null); const chartInstance = useRef(null);
  const lastSelIdxRef = useRef(null);
  const groupCounterRef = useRef(1);

  async function parseViaBackend(f) {
    const fd = new FormData(); fd.append('file', f);
    const resp = await fetch('/api/upload', { method: 'POST', body: fd });
    if (!resp.ok) return null; const json = await resp.json();
    if (!json || (!json.months && (!json.sums || json.sums.length !== 24))) return null;
    if (json.months && Array.isArray(json.months) && json.months.length) return { months: json.months };
    return { months: [{ name: '数据', sums: json.sums, companies: json.companies || [] }] };
  }

  async function parseOnClient(f) {
    try {
      const ext = (f && f.name ? f.name.toLowerCase() : '');
      if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
        const buf = await f.arrayBuffer();
        const XLSX = await import('xlsx');
        const wb = XLSX.read(buf, { type: 'array' });
        const months = [];
        for (const wsname of wb.SheetNames) {
          const sheet = wb.Sheets[wsname];
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
          const clean = rows.filter(r => Array.isArray(r) && r.some(v => v !== undefined && v !== null && String(v).trim() !== ''));
          if (!clean.length) continue;
          let maxCols = 0; for (const r of clean) { if (r.length > maxCols) maxCols = r.length }
          if (maxCols < 24) continue;
          const startIdx = maxCols - 24;
          const companies = [];
          for (let i = 1; i < clean.length; i++) {
            const r = clean[i];
            const values = new Array(24).fill(0);
            let hasNum = false;
            for (let j = 0; j < 24; j++) {
              const num = parseFloat(r[startIdx + j]);
              if (!isNaN(num)) { values[j] = num; hasNum = true }
            }
            if (hasNum) {
              const nameRaw = r[0];
              const nameStr = String(nameRaw === undefined || nameRaw === null ? '' : nameRaw);
              const name = nameStr.replace(/^\ufeff/, '').trim() || `第${i}行`;
              companies.push({ name, values })
            }
          }
          const sums = new Array(24).fill(0);
          for (const c of companies) { for (let j = 0; j < 24; j++) sums[j] += c.values[j] }
          months.push({ name: wsname, sums, companies });
        }
        if (!months.length) return null;
        return { months };
      } else {
        const text = await f.text();
        const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
        if (lines.length === 0) return null;
        const rows = [];
        let maxCols = 0;
        for (const line of lines) {
          const cols = line.split(/,|\t|;/).filter(x => x !== '');
          rows.push(cols); if (cols.length > maxCols) maxCols = cols.length;
        }
        const clean = rows.filter(r => Array.isArray(r) && r.some(v => v !== undefined && v !== null && String(v).trim() !== ''));
        if (clean.length === 0) return null;
        if (maxCols < 24) return null;
        const startIdx = maxCols - 24;
        const companies = [];
        for (let i = 1; i < clean.length; i++) {
          const r = clean[i];
          const values = new Array(24).fill(0);
          let hasNum = false;
          for (let j = 0; j < 24; j++) {
            const num = parseFloat(r[startIdx + j]);
            if (!isNaN(num)) { values[j] = num; hasNum = true }
          }
          if (hasNum) {
            const nameRaw = r[0];
            const nameStr = String(nameRaw === undefined || nameRaw === null ? '' : nameRaw);
            const name = nameStr.replace(/^\ufeff/, '').trim() || `第${i}行`;
            companies.push({ name, values })
          }
        }
        const sums = new Array(24).fill(0);
        for (const c of companies) { for (let j = 0; j < 24; j++) sums[j] += c.values[j] }
        return { months: [{ name: 'CSV', sums, companies }] };
      }
    } catch {
      return null;
    }
  }

  async function renderChart(cons, pph) {
    const { Chart } = await import('chart.js/auto');
    const ctx = chartRef.current; if (!ctx) return;
    const labels = hours();
    const dataBar = { label: '用电量(MWh)', data: cons, backgroundColor: '#34d399' };
    const dataLine = { label: '电价(元/MWh)', data: pph, borderColor: '#ef4444', backgroundColor: '#ef4444', yAxisID: 'y1', type: 'line', tension: 0.2 };
    const cfg = { type: 'bar', data: { labels, datasets: [dataBar, dataLine] }, options: { responsive: true, scales: { y: { beginAtZero: true, title: { display: true, text: 'MWh' } }, y1: { beginAtZero: true, title: { display: true, text: '元/MWh' }, position: 'right', grid: { drawOnChartArea: false } } } } };
    if (chartInstance.current) { chartInstance.current.destroy() }
    chartInstance.current = new Chart(ctx, cfg);
  }

  function renderTable() {
    if (!consumption || !groups || !prices) return null;
    const hdr1 = ['时间', ...hours()];
    const hdr2 = ['价格梯度', ...groups.labels];
    const rowQty = ['电量(MWh)', ...consumption.map(v => fmt(v))];
    const rowPrice = ['电价(元/MWh)', ...prices.pricePerHour.map(v => fmt(v))];
    const rowIncome = ['小时收入(元)', ...consumption.map((v, i) => fmtMoney(v * prices.pricePerHour[i]))];
    const totalRow = ['合计收入(元)', ...Array(23).fill(''), fmtMoney(prices.revenue), '目标:' + fmtMoney(parseFloat(expected || '0'))];
    return (
      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr>{hdr1.map((c, i) => (<th key={'h1' + i}>{c}</th>))}</tr>
            <tr>{hdr2.map((c, i) => {
              const clsMap = { '尖峰': styles.levelSpike, '峰': styles.levelPeak, '平': styles.levelFlat, '谷': styles.levelValley, '深谷': styles.levelDeep };
              const cls = i === 0 ? '' : (clsMap[c] || styles.levelFlat);
              const Tag = i === 0 ? 'th' : 'td';
              return <Tag key={'h2' + i} className={cls}>{c}</Tag>
            })}</tr>
          </thead>
          <tbody>
            {[rowQty, rowPrice, rowIncome, totalRow].map((row, ri) => (
              <tr key={'r' + ri}>{row.map((c, i) => { const Tag = i === 0 ? 'th' : 'td'; return <Tag key={'c' + ri + i}>{c}</Tag> })}</tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  async function handleExport() {
    if (!consumption || !groups || !prices) return;
    const hdr1 = ['时间', ...hours()];
    const hdr2 = ['价格梯度', ...groups.labels];
    const rowQty = ['电量(MWh)', ...consumption];
    const rowPrice = ['电价(元/MWh)', ...prices.pricePerHour];
    const rowIncome = ['小时收入(元)', ...consumption.map((v, i) => v * prices.pricePerHour[i])];
    const totalRow = ['合计收入(元)', ...Array(23).fill(''), prices.revenue, '目标:' + (parseFloat(expected || '0'))];
    const aoa = [hdr1, hdr2, rowQty, rowPrice, rowIncome, totalRow];
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 12 }, ...Array(24).fill({ wch: 10 })];
    XLSX.utils.book_append_sheet(wb, ws, '表格结果');
    const ts = new Date();
    const pad = n => String(n).padStart(2, '0');
    const name = `表格结果-${scope}-${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}.xlsx`;
    XLSX.writeFile(wb, name);
  }

  async function handleCalculate() {
    setError('');
    const exp = parseFloat(expected); if (isNaN(exp) || exp <= 0) { setError('请输入有效的期望总收入'); return }
    if (!file) { setError('请先选择或拖拽文件'); return }
    let data = await parseViaBackend(file);
    if (!data) data = await parseOnClient(file);
    if (!data || !data.months || !data.months.length) { setError('后端解析失败，请检查文件格式'); return }
    setMonths(data.months);
    setMonthIdx(0);
    setParsed(data);
    const comps = data.months[0].companies || []
    setCompanies(comps);
    if (!Array.isArray(comps) || comps.length === 0) { setError('未找到企业行数据'); return }
    setSelected('0');
    setScope(`${data.months[0].name}-${comps[0].name}`);

    // Use the count for the currently selected calendar month (default Jan/0)
    const initialCount = calendarConfigs[currentCalendarMonth] || 3;
    setPeakValleyCount(initialCount);

    const cons = comps[0].values;
    let grp = null
    if (templateSelectedId) {
      const tpl = templates.find(t => t.id === templateSelectedId)
      const tm = tpl && tpl.months ? tpl.months[currentCalendarMonth] : null
      const cntRaw = tm && tm.count !== undefined ? parseInt(tm.count, 10) : NaN
      const cnt = (!isNaN(cntRaw) && cntRaw > 0) ? cntRaw : initialCount
      setPeakValleyCount(cnt)
      grp = tm ? mergeTemplate(cons, tm) : classify(cons, cnt)
    } else {
      grp = classify(cons, initialCount)
    }
    const pr = computePrices(cons, grp, exp, factors);
    setConsumption(cons); setGroups(grp); setBasePrices(pr); setPrices(pr); renderChart(cons, pr.pricePerHour);
  }

  function recomputeForSelection(sel) {
    if (!months.length) return; const exp = parseFloat(expected); if (isNaN(exp) || exp <= 0) return;
    let cons = null; let scope = '';
    const m = months[monthIdx]; if (!m) return;
    const idx = parseInt(sel, 10); if (isNaN(idx) || !m.companies[idx]) return; cons = m.companies[idx].values; scope = `${m.name}-${m.companies[idx].name}`
    let grp = null
    if (templateSelectedId) {
      const tpl = templates.find(t => t.id === templateSelectedId)
      const tm = tpl && tpl.months ? tpl.months[currentCalendarMonth] : null
      const cntRaw = tm && tm.count !== undefined ? parseInt(tm.count, 10) : NaN
      const cnt = (!isNaN(cntRaw) && cntRaw > 0) ? cntRaw : peakValleyCount
      setPeakValleyCount(cnt)
      grp = tm ? mergeTemplate(cons, tm) : classify(cons, cnt)
    } else {
      grp = classify(cons, peakValleyCount)
    }
    const pr = computePrices(cons, grp, exp, factors);
    setConsumption(cons); setGroups(grp); setBasePrices(pr); setPrices(pr); setScope(scope); renderChart(cons, pr.pricePerHour);
  }

  useEffect(() => { if (consumption && prices) renderChart(consumption, prices.pricePerHour) }, [consumption, prices]);

  useEffect(() => {
    function send() {
      try {
        const data = new Blob([JSON.stringify({ t: Date.now() })], { type: 'application/json' });
        if (navigator && navigator.sendBeacon) navigator.sendBeacon('/api/cleanup', data);
      } catch { }
    }
    window.addEventListener('pagehide', send);
    window.addEventListener('beforeunload', send);
    return () => {
      window.removeEventListener('pagehide', send);
      window.removeEventListener('beforeunload', send);
    }
  }, []);


  useEffect(() => {
    async function loadTemplates() {
      try {
        if (!supabase) return
        const { data } = await supabase.from('rule_templates').select('id,name,months,factors').order('created_at', { ascending: false })
        setTemplates(Array.isArray(data) ? data : [])
      } catch { }
    }
    loadTemplates()
  }, [])

  function applyTemplateById(id) {
    const tpl = templates.find(t => t.id === id)
    if (!tpl) return
    const m = tpl.months && tpl.months[currentCalendarMonth] ? tpl.months[currentCalendarMonth] : null
    if (!m) return
    const grp = mergeTemplate(consumption, m)
    const cnt = parseInt(m.count, 10)
    setPeakValleyCount(!isNaN(cnt) && cnt > 0 ? cnt : 3)
    const tf = tpl.factors || {}
    setFactors({
      flat: Number(tf.flat) > 0 ? Number(tf.flat) : 1,
      spike: Number(tf.spike) > 0 ? Number(tf.spike) : 2,
      peak: Number(tf.peak) > 0 ? Number(tf.peak) : 1.7,
      valley: Number(tf.valley) > 0 ? Number(tf.valley) : 0.3,
      deep: Number(tf.deep) > 0 ? Number(tf.deep) : 0.1
    })
    const exp = parseFloat(expected)
    if (consumption && !isNaN(exp) && exp > 0) {
      const pr = computePrices(consumption, grp, exp, {
        flat: Number(tf.flat) > 0 ? Number(tf.flat) : defaultFactors.flat,
        spike: Number(tf.spike) > 0 ? Number(tf.spike) : defaultFactors.spike,
        peak: Number(tf.peak) > 0 ? Number(tf.peak) : defaultFactors.peak,
        valley: Number(tf.valley) > 0 ? Number(tf.valley) : defaultFactors.valley,
        deep: Number(tf.deep) > 0 ? Number(tf.deep) : defaultFactors.deep
      })
      setGroups(grp); setBasePrices(pr); setPrices(pr); renderChart(consumption, pr.pricePerHour)
    } else {
      setGroups(grp); setBasePrices(null); setPrices(null)
    }
  }

  function updateFactors(next) {
    setFactors(next)
    const exp = parseFloat(expected)
    if (consumption && groups && !isNaN(exp) && exp > 0) {
      const pr = computePrices(consumption, groups, exp, next)
      setBasePrices(pr); setPrices(pr); renderChart(consumption, pr.pricePerHour)
    }
  }

  function resetFactors() {
    updateFactors(defaultFactors)
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>管理员上传用电量并计算分档电价</h1>

      <div className={styles.controls}>
        {/* Column 1: Data Source */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div className={styles.groupCard}>
            <div className={styles.groupHeader}>1. 数据源</div>
            <div className={styles.field}>
              <label htmlFor="excelFile">导入数据 (Excel/CSV)</label>
              <div className={styles.fileRow}>
                <button className={styles.secondaryButton} onClick={() => document.getElementById('excelFile').click()}>选择文件</button>
                <span className={styles.fileName}>{fileName ? fileName : '未选择文件'}</span>
              </div>
              <input id="excelFile" type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => { const f = e.target.files && e.target.files[0] ? e.target.files[0] : null; setFile(f); setFileName(f ? f.name : '') }} />

              <div className={`${styles.dropzone}`} style={{ marginTop: '12px', padding: '20px' }} onClick={() => document.getElementById('excelFile').click()} onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('isDrag') }} onDragLeave={e => { e.currentTarget.classList.remove('isDrag') }} onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('isDrag'); const f = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files[0] : null; setFile(f); setFileName(f ? f.name : '') }}>
                {fileName || '拖拽文件到此或点击选择'}
              </div>
            </div>

            <div className={styles.field} style={{ marginTop: '16px' }}>
              <label htmlFor="dataScope">数据范围</label>
              <select id="dataScope" value={selected} onChange={e => { const val = e.target.value; setSelected(val); recomputeForSelection(val) }}>
                {companies.map((c, i) => (<option key={i} value={String(i)}>{c.name}</option>))}
              </select>
            </div>
          </div>
        </div>

        {/* Column 2: Calculation Parameters */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div className={styles.groupCard}>
            <div className={styles.groupHeader}>2. 计算参数</div>

            <div className={styles.field}>
              <label htmlFor="ruleTemplate">规则模板</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <select id="ruleTemplate" style={{ flex: 1 }} value={templateSelectedId} onChange={e => setTemplateSelectedId(e.target.value)}>
                  <option value="">未选择 (全部平)</option>
                  {templates.map(t => (<option key={t.id} value={t.id}>{t.name}</option>))}
                </select>
                <Link href="/rules" className={styles.secondaryButton}>管理</Link>
              </div>
              {!supabase && (
                <div className={styles.error} style={{ fontSize: '12px', padding: '8px' }}>未配置 Supabase，模板不可用。</div>
              )}
            </div>

            <div className={styles.field} style={{ marginTop: '16px' }}>
              <label htmlFor="expectedRevenue">期望总收入（元）</label>
              <input id="expectedRevenue" type="number" step="0.01" value={expected} onChange={e => { setExpected(e.target.value); if (consumption && groups) { const exp = parseFloat(e.target.value); if (!isNaN(exp) && exp > 0) { const pr = computePrices(consumption, groups, exp, factors); setBasePrices(pr); setPrices(pr); } } }} placeholder="例如 100000" />
            </div>

            <div style={{ marginTop: '24px' }}>
              <button className={styles.actionButton} onClick={handleCalculate}>开始计算</button>
              {error && <div className={styles.error}>{error}</div>}
            </div>
          </div>
        </div>
      </div>

      {/* Results Section */}
      {prices && (
        <section className={styles.results}>
          <div className={styles.summary}>
            <div className={styles.card}><div className={styles.cardTitle}>当前范围</div><div className={styles.cardValue}>{scope}</div></div>
            <div className={styles.card}><div className={styles.cardTitle}>深谷电价</div><div className={styles.cardValue}>{fmt(prices.pDeep)}</div></div>
            <div className={styles.card}><div className={styles.cardTitle}>谷电价</div><div className={styles.cardValue}>{fmt(prices.pValley)}</div></div>
            <div className={styles.card}><div className={styles.cardTitle}>平电价</div><div className={styles.cardValue}>{fmt(prices.pFlat)}</div></div>
            <div className={styles.card}><div className={styles.cardTitle}>峰电价</div><div className={styles.cardValue}>{fmt(prices.pPeak)}</div></div>
            <div className={styles.card}><div className={styles.cardTitle}>尖峰电价</div><div className={styles.cardValue}>{fmt(prices.pSpike)}</div></div>
            <div className={styles.card}><div className={styles.cardTitle}>总收入（元）</div><div className={styles.cardValue}>{fmtMoney(prices.revenue)}</div></div>
          </div>

          <h2 style={{ marginTop: '32px' }}>分时电价详情</h2>

          <div className={styles.adjustSection}>
            <div className={styles.groupHeader} style={{ borderBottom: 'none', marginBottom: '12px' }}>系数调整（尖峰/峰/谷/深谷）</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(160px, 1fr))', gap: 12 }}>
              <div className={styles.field}><label>尖峰系数</label><input type="number" step="0.01" value={factors.spike} onChange={e => updateFactors({ ...factors, spike: e.target.value })} /></div>
              <div className={styles.field}><label>峰系数</label><input type="number" step="0.01" value={factors.peak} onChange={e => updateFactors({ ...factors, peak: e.target.value })} /></div>
              <div className={styles.field}><label>谷系数</label><input type="number" step="0.01" value={factors.valley} onChange={e => updateFactors({ ...factors, valley: e.target.value })} /></div>
              <div className={styles.field}><label>深谷系数</label><input type="number" step="0.01" value={factors.deep} onChange={e => updateFactors({ ...factors, deep: e.target.value })} /></div>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 12, alignItems: 'center' }}>
              <span className={styles.fileName}>平系数固定为 1</span>
              <button className={styles.secondaryButton} onClick={resetFactors}>重置默认系数</button>
            </div>
          </div>

          {renderTable()}
          <div className={styles.controls} style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className={styles.actionButton} style={{ width: 'auto' }} onClick={handleExport}>导出表格结果</button>
          </div>

          <h2 style={{ marginTop: '48px' }}>图表展示</h2>
          <div className={styles.chartWrap}><canvas ref={chartRef} height="100" /></div>
        </section>
      )}
    </div >
  )
}
