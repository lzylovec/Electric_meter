import { useEffect, useRef, useState } from 'react';
import styles from './index.module.css';


function fmt(n) { if (!isFinite(n)) return '--'; return Number(n).toFixed(4) }
function fmtMoney(n) { if (!isFinite(n)) return '--'; return Number(n).toFixed(2) }
function hours() { return Array.from({ length: 24 }, (_, i) => `${i + 1}点`) }

function classify(cons, count = 8) {
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
  const [peakValleyCount, setPeakValleyCount] = useState(8);
  const [calendarConfigs, setCalendarConfigs] = useState(() => Array(12).fill(8));
  const [currentCalendarMonth, setCurrentCalendarMonth] = useState(0); // 0 for Jan, 11 for Dec
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
    const initialCount = calendarConfigs[currentCalendarMonth] || 8;
    setPeakValleyCount(initialCount);

    const cons = data.months[0].sums; const grp = classify(cons, initialCount); const pr = computePrices(cons, grp, exp);
    setConsumption(cons); setGroups(grp); setBasePrices(pr); setPrices(pr); setAdjustSelected([]); setAdjustGroups([]); renderChart(cons, pr.pricePerHour);
  }

  function recomputeForSelection(sel) {
    if (!months.length) return; const exp = parseFloat(expected); if (isNaN(exp) || exp <= 0) return;
    let cons = null; let scope = '';
    const m = months[monthIdx]; if (!m) return;
    if (sel === '__all__') { cons = m.sums; scope = `汇总(${m.name})` } else { const idx = parseInt(sel, 10); if (isNaN(idx) || !m.companies[idx]) return; cons = m.companies[idx].values; scope = `${m.name}-${m.companies[idx].name}` }
    const grp = classify(cons, peakValleyCount); const pr = computePrices(cons, grp, exp);
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
        {/* Card 1: File & Input */}
        <div className={styles.groupCard}>
          <div className={styles.groupHeader}>1. 导入数据</div>
          <div className={styles.field}>
            <label htmlFor="excelFile">Excel/CSV（24小时用电量，单位：MWh）</label>
            <input id="excelFile" type="file" accept=".xlsx,.xls,.csv" onChange={e => { const f = e.target.files && e.target.files[0] ? e.target.files[0] : null; setFile(f); setFileName(f ? f.name : '') }} />
            <div className={styles.fileRow}>
              <button className={styles.secondaryButton} onClick={() => document.getElementById('excelFile').click()}>选择文件</button>
              <span className={styles.fileName}>{fileName ? fileName : '未选择文件'}</span>
            </div>
            <div className={`${styles.dropzone}`} onClick={() => document.getElementById('excelFile').click()} onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('isDrag') }} onDragLeave={e => { e.currentTarget.classList.remove('isDrag') }} onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('isDrag'); const f = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files[0] : null; setFile(f); setFileName(f ? f.name : '') }}>
              {fileName || '拖拽文件到此或点击选择'}
            </div>
          </div>
        </div>

        {/* Card 2: Configuration */}
        <div className={styles.groupCard}>
          <div className={styles.groupHeader}>2. 参数设置</div>
          <div className={styles.controlRow}>
            <div className={styles.field}>
              <label htmlFor="calendarMonth">配置月份</label>
              <select id="calendarMonth" value={currentCalendarMonth} onChange={e => {
                const idx = parseInt(e.target.value, 10);
                setCurrentCalendarMonth(idx);
                const count = calendarConfigs[idx] || 8;
                setPeakValleyCount(count);

                if (consumption && expected) {
                  const exp = parseFloat(expected);
                  if (!isNaN(exp) && exp > 0) {
                    const grp = classify(consumption, count);
                    const pr = computePrices(consumption, grp, exp);
                    setGroups(grp); setBasePrices(pr); setPrices(pr); setAdjustSelected([]); setAdjustGroups([]); renderChart(consumption, pr.pricePerHour);
                  }
                }
              }}>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i} value={i}>{i + 1}月</option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="peakValleyCount">峰谷数量（个）</label>
              <input id="peakValleyCount" type="number" min="1" max="11" value={peakValleyCount} onChange={e => {
                const val = e.target.value;
                setPeakValleyCount(val);
                const v = parseInt(val, 10);
                if (!isNaN(v) && v > 0 && v * 2 <= 24 && consumption && expected) {
                  const exp = parseFloat(expected);
                  if (!isNaN(exp) && exp > 0) {
                    const newConfigs = [...calendarConfigs];
                    newConfigs[currentCalendarMonth] = v;
                    setCalendarConfigs(newConfigs);

                    const grp = classify(consumption, v);
                    const pr = computePrices(consumption, grp, exp);
                    setGroups(grp); setBasePrices(pr); setPrices(pr); setAdjustSelected([]); setAdjustGroups([]); renderChart(consumption, pr.pricePerHour);
                  }
                }
              }} />
            </div>
          </div>
          <div className={styles.controlRow} style={{ marginTop: 16 }}>
            <div className={styles.field}>
              <label htmlFor="expectedRevenue">期望总收入（元）</label>
              <input id="expectedRevenue" type="number" step="0.01" value={expected} onChange={e => { setExpected(e.target.value); if (consumption && groups) { const exp = parseFloat(e.target.value); if (!isNaN(exp) && exp > 0) { const pr = computePrices(consumption, groups, exp); setBasePrices(pr); setPrices(pr); setAdjustSelected([]); setAdjustGroups([]); } } }} placeholder="例如 100000" />
            </div>
          </div>
        </div>

        <button className={styles.actionButton} onClick={handleCalculate}>计算结果</button>
        <div className={styles.error}>{error}</div>
      </div>

      <div className={styles.controls}>
        {/* Card 3: Grouping & Adjustment */}
        <div className={styles.groupCard}>
          <div className={styles.groupHeader}>3. 分组与调整</div>

          <div className={styles.controlRow}>
            <div className={styles.field} style={{ flex: 2 }}>
              <label>选择小时列（点击表头，可Shift连选）</label>
              <div className={styles.fileName} style={{ marginTop: 8, padding: '8px', background: '#fff', border: '1px solid #eee', borderRadius: '4px', minHeight: '38px', display: 'flex', alignItems: 'center' }}>
                {adjustSelected.length ? `已选：${adjustSelected.map(i => `${i + 1}点`).join('、')}` : <span style={{ color: '#9ca3af' }}>请在下方表格点击表头选择时间段</span>}
              </div>
            </div>
            <div className={styles.field} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-end', justifyContent: 'flex-start', paddingBottom: 2 }}>
              <button className={styles.secondaryButton} disabled={!adjustSelected.length} onClick={addSelectionAsGroup}>添加为组</button>
              <button className={styles.secondaryButton} onClick={clearAllGroups}>清除全部组</button>
            </div>
          </div>

          {adjustGroups.length > 0 && (
            <div style={{ marginTop: 24, borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
              <div className={styles.groupHeader} style={{ fontSize: '14px', color: '#334155', marginBottom: 12 }}>已添加的分组 ({adjustGroups.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {adjustGroups.map((g, idx) => (
                  <div key={g.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', background: '#fff', padding: '12px 16px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                    <div style={{ minWidth: 60, fontWeight: 600, color: '#475569' }}>组 {idx + 1}</div>
                    <div style={{ flex: 1, minWidth: 200, fontSize: 14, color: '#475569' }}>
                      <span style={{ color: '#64748b', marginRight: 8 }}>包含:</span>
                      {g.cols.map(i => `${i + 1}点`).join('、')}
                    </div>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      <input type="number" step="0.01" value={g.setPrice} onChange={e => { const v = e.target.value; setAdjustGroups(adjustGroups.map(x => x.id === g.id ? { ...x, setPrice: v } : x)) }} placeholder="调整电价" style={{ padding: '8px', border: '1px solid #d1d5db', borderRadius: 6, width: 100 }} />
                      <span style={{ color: '#9ca3af' }}>×</span>
                      <input type="number" step="0.01" value={g.factor} onChange={e => { const v = e.target.value; setAdjustGroups(adjustGroups.map(x => x.id === g.id ? { ...x, factor: v } : x)) }} placeholder="倍数" style={{ padding: '8px', border: '1px solid #d1d5db', borderRadius: 6, width: 80 }} />
                      <button className={styles.secondaryButton} onClick={() => removeGroup(g.id)} style={{ padding: '8px 12px', color: '#ef4444', borderColor: '#fee2e2', background: '#fef2f2' }}>删除</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <section className={styles.results}>
        <div className={styles.summary}>
          <div className={styles.card}><div className={styles.cardTitle}>数据范围</div><div className={styles.cardValue}>{scope}</div></div>
          <div className={styles.card}><div className={styles.cardTitle}>谷电价</div><div className={styles.cardValue}>{prices ? fmt(prices.pLow) : '--'}</div></div>
          <div className={styles.card}><div className={styles.cardTitle}>平电价</div><div className={styles.cardValue}>{prices ? fmt(prices.pMid) : '--'}</div></div>
          <div className={styles.card}><div className={styles.cardTitle}>峰电价</div><div className={styles.cardValue}>{prices ? fmt(prices.pHigh) : '--'}</div></div>
          <div className={styles.card}><div className={styles.cardTitle}>总收入（元）</div><div className={styles.cardValue}>{prices ? fmtMoney(prices.revenue) : '--'}</div></div>
        </div>

        <h2>表格结果</h2>
        {renderTable()}
        <div className={styles.controls}>
          <button className={styles.actionButton} disabled={!prices} onClick={handleExport}>导出表格结果</button>
        </div>

        <h2>图表展示</h2>
        <div className={styles.chartWrap}><canvas ref={chartRef} height="140" /></div>
      </section>
    </div >
  )
}
