import { useEffect, useRef, useState } from 'react';
import styles from './index.module.css';
import { supabase } from '../lib/supabase'


function fmt(n) { if (!isFinite(n)) return '--'; return Number(n).toFixed(4) }
function fmtMoney(n) { if (!isFinite(n)) return '--'; return Number(n).toFixed(2) }
function hours() { return Array.from({ length: 24 }, (_, i) => `${i + 1}点`) }

function classify(cons, count = 3) {
  const idx = cons.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v).map(x => x.i);
  const high = new Set(idx.slice(0, count));
  const low = new Set(idx.slice(24 - count));
  const mid = new Set(idx.slice(count, 24 - count));
  const labels = cons.map((_, i) => high.has(i) ? '峰' : (mid.has(i) ? '平' : '谷'));
  return { labels, high, mid, low };
}

function computePrices(cons, groups, expected) {
  const wLow = 1, wMid = 1.5, wHigh = 2; let denom = 0;
  for (let i = 0; i < cons.length; i++) { const w = groups.high.has(i) ? wHigh : (groups.mid.has(i) ? wMid : wLow); denom += cons[i] * w }
  if (denom <= 0) return null; const k = expected / denom;
  const pLow = k * wLow, pMid = k * wMid, pHigh = k * wHigh;
  const pricePerHour = cons.map((_, i) => groups.high.has(i) ? pHigh : (groups.mid.has(i) ? pMid : pLow));
  let revenue = 0; for (let i = 0; i < cons.length; i++)revenue += cons[i] * pricePerHour[i];
  return { pLow, pMid, pHigh, pricePerHour, revenue };
}

function mergeTemplate(cons, tplMonth) {
  const cntRaw = tplMonth && tplMonth.count !== undefined ? parseInt(tplMonth.count, 10) : NaN
  const cnt = (!isNaN(cntRaw) && cntRaw > 0) ? cntRaw : 3
  const toIdx = arr => (Array.isArray(arr) ? arr : []).map(i => parseInt(i, 10)).filter(i => !isNaN(i) && i >= 0 && i < 24)
  const peaks = new Set(toIdx(tplMonth && tplMonth.peaks))
  const valleys = new Set(toIdx(tplMonth && tplMonth.valleys))
  const used = new Set([...peaks, ...valleys])
  const remain = Array.from({ length: 24 }, (_, i) => i).filter(i => !used.has(i))
  if (Array.isArray(cons)) {
    const desc = remain.map(i => ({ i, v: cons[i] })).sort((a, b) => b.v - a.v)
    for (const x of desc) { if (peaks.size < cnt) peaks.add(x.i) }
    const afterPeak = remain.filter(i => !peaks.has(i))
    const asc = afterPeak.map(i => ({ i, v: cons[i] })).sort((a, b) => a.v - b.v)
    for (const x of asc) { if (valleys.size < cnt) valleys.add(x.i) }
  } else {
    for (const i of remain) { if (peaks.size < cnt) peaks.add(i) }
    for (const i of remain) { if (!peaks.has(i) && valleys.size < cnt) valleys.add(i) }
  }
  const labels = Array.from({ length: 24 }, (_, i) => peaks.has(i) ? '峰' : (valleys.has(i) ? '谷' : '平'))
  const mid = new Set(labels.map((l, i) => l === '平' ? i : -1).filter(i => i >= 0))
  return { labels, high: peaks, mid, low: valleys }
}

export default function IndexPage() {
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState('');
  const [expected, setExpected] = useState('');
  const [parsed, setParsed] = useState(null);
  const [months, setMonths] = useState([]);
  const [monthIdx, setMonthIdx] = useState(0);
  const [scope, setScope] = useState('汇总(全部)');
  const [consumption, setConsumption] = useState(null);
  const [groups, setGroups] = useState(null);
  const [basePrices, setBasePrices] = useState(null);
  const [prices, setPrices] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [selected, setSelected] = useState('__all__');
  const [error, setError] = useState('');
  const chartRef = useRef(null); const chartInstance = useRef(null);
  const [adjustSelected, setAdjustSelected] = useState([]);
  const [adjustGroups, setAdjustGroups] = useState([]);
  const [peakValleyCount, setPeakValleyCount] = useState(3);
  const [calendarConfigs, setCalendarConfigs] = useState(() => Array(12).fill(3));
  const [currentCalendarMonth, setCurrentCalendarMonth] = useState(0); // 0 for Jan, 11 for Dec
  const lastSelIdxRef = useRef(null);
  const groupCounterRef = useRef(1);
  const [templates, setTemplates] = useState([])
  const [templateSelectedId, setTemplateSelectedId] = useState('')

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
            <tr>{hdr1.map((c, i) => {
              if (i === 0) return <th key={'h1' + i}>{c}</th>;
              const idx = i - 1;
              const isSel = adjustSelected.includes(idx);
              const cls = isSel ? styles.selectedCol : '';
              return (
                <th
                  key={'h1' + i}
                  className={cls}
                  onClick={e => {
                    const shift = e.shiftKey;
                    if (shift && lastSelIdxRef.current !== null && lastSelIdxRef.current !== undefined) {
                      const a = Math.min(lastSelIdxRef.current, idx);
                      const b = Math.max(lastSelIdxRef.current, idx);
                      const set = new Set(adjustSelected);
                      for (let k = a; k <= b; k++) set.add(k);
                      setAdjustSelected(Array.from(set).sort((x, y) => x - y));
                    } else {
                      const set = new Set(adjustSelected);
                      if (set.has(idx)) set.delete(idx); else set.add(idx);
                      setAdjustSelected(Array.from(set).sort((x, y) => x - y));
                      lastSelIdxRef.current = idx;
                    }
                  }}
                >{c}</th>
              )
            })}</tr>
            <tr>{hdr2.map((c, i) => {
              const cls = i === 0 ? '' : (c === '谷' ? styles.levelLow : (c === '平' ? styles.levelMid : styles.levelHigh));
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
    setCompanies(data.months[0].companies || []);
    setSelected('__all__');
    setScope(`汇总(${data.months[0].name})`);

    // Use the count for the currently selected calendar month (default Jan/0)
    const initialCount = calendarConfigs[currentCalendarMonth] || 3;
    setPeakValleyCount(initialCount);

    const cons = data.months[0].sums;
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
    const pr = computePrices(cons, grp, exp);
    setConsumption(cons); setGroups(grp); setBasePrices(pr); setPrices(pr); setAdjustSelected([]); setAdjustGroups([]); renderChart(cons, pr.pricePerHour);
  }

  function recomputeForSelection(sel) {
    if (!months.length) return; const exp = parseFloat(expected); if (isNaN(exp) || exp <= 0) return;
    let cons = null; let scope = '';
    const m = months[monthIdx]; if (!m) return;
    if (sel === '__all__') { cons = m.sums; scope = `汇总(${m.name})` } else { const idx = parseInt(sel, 10); if (isNaN(idx) || !m.companies[idx]) return; cons = m.companies[idx].values; scope = `${m.name}-${m.companies[idx].name}` }
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
    const pr = computePrices(cons, grp, exp);
    setConsumption(cons); setGroups(grp); setBasePrices(pr); setPrices(pr); setScope(scope); setAdjustSelected([]); setAdjustGroups([]); renderChart(cons, pr.pricePerHour);
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

  // Load calendar configs from browser and save on change
  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem('calendarConfigs') : null;
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length === 12) {
          const fixed = arr.map(v => {
            const n = parseInt(v, 10);
            return (!isNaN(n) && n > 0 && n * 2 <= 24) ? n : 3;
          });
          setCalendarConfigs(fixed);
          const c = fixed[currentCalendarMonth] || 3;
          setPeakValleyCount(c);
        }
      }
    } catch { }
  }, []);

  useEffect(() => {
    try {
      if (Array.isArray(calendarConfigs) && calendarConfigs.length === 12) {
        window.localStorage.setItem('calendarConfigs', JSON.stringify(calendarConfigs));
      }
    } catch { }
  }, [calendarConfigs]);

  useEffect(() => {
    async function loadTemplates() {
      try {
        if (!supabase) return
        const { data } = await supabase.from('rule_templates').select('id,name,months').order('created_at', { ascending: false })
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
    const exp = parseFloat(expected)
    if (consumption && !isNaN(exp) && exp > 0) {
      const pr = computePrices(consumption, grp, exp)
      setGroups(grp); setBasePrices(pr); setPrices(pr); setAdjustSelected([]); setAdjustGroups([]); renderChart(consumption, pr.pricePerHour)
    } else {
      setGroups(grp); setBasePrices(null); setPrices(null); setAdjustSelected([]); setAdjustGroups([])
    }
  }

  function recomputeWithGroups() {
    if (!basePrices || !consumption) return;
    let pph = basePrices.pricePerHour.slice();
    for (const g of adjustGroups) {
      const priceSet = parseFloat(g.setPrice);
      const factor = parseFloat(g.factor);
      for (const i of g.cols) {
        if (pph[i] === undefined) continue;
        let current = pph[i];
        if (!isNaN(priceSet) && priceSet > 0) {
          current = priceSet;
        }
        if (!isNaN(factor) && factor > 0) {
          current = current * factor;
        }
        pph[i] = current;
      }
    }
    let revenue = 0; for (let i = 0; i < consumption.length; i++) revenue += consumption[i] * pph[i];
    setPrices({ ...basePrices, pricePerHour: pph, revenue });
  }

  useEffect(() => { recomputeWithGroups() }, [adjustGroups, basePrices, consumption]);

  function addSelectionAsGroup() {
    if (!adjustSelected.length) return;
    const id = 'g' + groupCounterRef.current++;
    const cols = Array.from(new Set(adjustSelected)).sort((a, b) => a - b);
    setAdjustGroups([...adjustGroups, { id, cols, setPrice: '', factor: '' }]);
    setAdjustSelected([]);
    lastSelIdxRef.current = null;
  }

  function removeGroup(id) {
    setAdjustGroups(adjustGroups.filter(g => g.id !== id));
  }

  function clearAllGroups() {
    setAdjustGroups([]);
    setAdjustSelected([]);
    lastSelIdxRef.current = null;
    if (basePrices) setPrices(basePrices);
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
                <option value="__all__">汇总</option>
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
                  <option value="">未选择 (默认3档)</option>
                  {templates.map(t => (<option key={t.id} value={t.id}>{t.name}</option>))}
                </select>
                <a className={styles.secondaryButton} href="/rules" target="_blank" rel="noopener noreferrer">管理</a>
              </div>
              {!supabase && (
                <div className={styles.error} style={{ fontSize: '12px', padding: '8px' }}>未配置 Supabase，模板不可用。</div>
              )}
            </div>

            <div className={styles.field} style={{ marginTop: '16px' }}>
              <label htmlFor="expectedRevenue">期望总收入（元）</label>
              <input id="expectedRevenue" type="number" step="0.01" value={expected} onChange={e => { setExpected(e.target.value); if (consumption && groups) { const exp = parseFloat(e.target.value); if (!isNaN(exp) && exp > 0) { const pr = computePrices(consumption, groups, exp); setBasePrices(pr); setPrices(pr); setAdjustSelected([]); setAdjustGroups([]); } } }} placeholder="例如 100000" />
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
            <div className={styles.card}><div className={styles.cardTitle}>谷电价</div><div className={styles.cardValue}>{fmt(prices.pLow)}</div></div>
            <div className={styles.card}><div className={styles.cardTitle}>平电价</div><div className={styles.cardValue}>{fmt(prices.pMid)}</div></div>
            <div className={styles.card}><div className={styles.cardTitle}>峰电价</div><div className={styles.cardValue}>{fmt(prices.pHigh)}</div></div>
            <div className={styles.card}><div className={styles.cardTitle}>总收入（元）</div><div className={styles.cardValue}>{fmtMoney(prices.revenue)}</div></div>
          </div>

          <h2 style={{ marginTop: '32px' }}>分时电价详情</h2>

          {/* Grouping & Adjustment moved here */}
          <div className={styles.adjustSection}>
            <div className={styles.groupHeader} style={{ borderBottom: 'none', marginBottom: '12px' }}>微调工具：分组与调整</div>
            <div className={styles.controlRow}>
              <div className={styles.field} style={{ flex: 2 }}>
                <label>1. 在下方表格点击表头选择时间段 (支持Shift连选)</label>
                <div className={styles.fileName} style={{ marginTop: 8, padding: '8px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '6px', minHeight: '38px', display: 'flex', alignItems: 'center' }}>
                  {adjustSelected.length ? `已选：${adjustSelected.map(i => `${i + 1}点`).join('、')}` : <span style={{ color: '#9ca3af' }}>未选择时间段</span>}
                </div>
              </div>
              <div className={styles.field} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-end', justifyContent: 'flex-start', paddingBottom: 2 }}>
                <button className={styles.secondaryButton} disabled={!adjustSelected.length} onClick={addSelectionAsGroup}>2. 添加为调整组</button>
                <button className={styles.secondaryButton} onClick={clearAllGroups}>清除全部</button>
              </div>
            </div>

            {adjustGroups.length > 0 && (
              <div className={styles.groupList}>
                {adjustGroups.map((g, idx) => (
                  <div key={g.id} className={styles.groupItem}>
                    <div style={{ minWidth: 60, fontWeight: 600, color: '#475569' }}>组 {idx + 1}</div>
                    <div style={{ flex: 1, minWidth: 200, fontSize: 14, color: '#475569' }}>
                      <span style={{ color: '#64748b', marginRight: 8 }}>包含:</span>
                      {g.cols.map(i => `${i + 1}点`).join('、')}
                    </div>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 12, color: '#64748b' }}>固定价:</span>
                        <input type="number" step="0.01" value={g.setPrice} onChange={e => { const v = e.target.value; setAdjustGroups(adjustGroups.map(x => x.id === g.id ? { ...x, setPrice: v } : x)) }} placeholder="未设置" style={{ padding: '6px', border: '1px solid #d1d5db', borderRadius: 4, width: 80 }} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 12, color: '#64748b' }}>倍率:</span>
                        <input type="number" step="0.01" value={g.factor} onChange={e => { const v = e.target.value; setAdjustGroups(adjustGroups.map(x => x.id === g.id ? { ...x, factor: v } : x)) }} placeholder="1.0" style={{ padding: '6px', border: '1px solid #d1d5db', borderRadius: 4, width: 60 }} />
                      </div>
                      <button className={styles.secondaryButton} onClick={() => removeGroup(g.id)} style={{ padding: '6px 10px', color: '#ef4444', borderColor: '#fee2e2', background: '#fef2f2', fontSize: 12 }}>删除</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
