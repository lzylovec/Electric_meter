import { useEffect, useRef, useState } from 'react';
import styles from './index.module.css';


function fmt(n) { if (!isFinite(n)) return '--'; return Number(n).toFixed(4) }
function fmtMoney(n) { if (!isFinite(n)) return '--'; return Number(n).toFixed(2) }
function hours() { return Array.from({ length: 24 }, (_, i) => `${i + 1}点`) }

function classify(cons) {
  const idx = cons.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v).map(x => x.i);
  const high = new Set(idx.slice(0, 8));
  const mid = new Set(idx.slice(8, 16));
  const low = new Set(idx.slice(16));
  const labels = cons.map((_, i) => high.has(i) ? '高' : (mid.has(i) ? '中' : '低'));
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
  const lastSelIdxRef = useRef(null);
  const groupCounterRef = useRef(1);

  async function parseViaBackend(f) {
    const fd = new FormData(); fd.append('file', f);
    const resp = await fetch('/api/upload', { method: 'POST', body: fd });
    if (!resp.ok) return null; const json = await resp.json();
    if (!json || !json.sums || json.sums.length !== 24) return null;
    return { sums: json.sums, companies: json.companies || [] };
  }

  async function parseOnClient(f) {
    try {
      const ext = (f && f.name ? f.name.toLowerCase() : '');
      if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
        const buf = await f.arrayBuffer();
        const XLSX = await import('xlsx');
        const wb = XLSX.read(buf, { type: 'array' });
        const wsname = wb.SheetNames[0];
        const sheet = wb.Sheets[wsname];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
        const clean = rows.filter(r => Array.isArray(r) && r.some(v => v !== undefined && v !== null && String(v).trim() !== ''));
        if (clean.length === 0) return null;
        let maxCols = 0; for (const r of clean) { if (r.length > maxCols) maxCols = r.length }
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
        return { sums, companies };
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
        return { sums, companies };
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
              const cls = i === 0 ? '' : (c === '低' ? styles.levelLow : (c === '中' ? styles.levelMid : styles.levelHigh));
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
    if (!data) { setError('后端解析失败，请检查文件格式'); return }
    setParsed(data); setCompanies(data.companies || []); setSelected('__all__'); setScope('汇总(全部)');
    const cons = data.sums; const grp = classify(cons); const pr = computePrices(cons, grp, exp);
    setConsumption(cons); setGroups(grp); setBasePrices(pr); setPrices(pr); setAdjustSelected([]); setAdjustGroups([]); renderChart(cons, pr.pricePerHour);
  }

  function recomputeForSelection(sel) {
    if (!parsed) return; const exp = parseFloat(expected); if (isNaN(exp) || exp <= 0) return;
    let cons = null; let scope = '';
    if (sel === '__all__') { cons = parsed.sums; scope = '汇总(全部)' } else { const idx = parseInt(sel, 10); if (isNaN(idx) || !parsed.companies[idx]) return; cons = parsed.companies[idx].values; scope = parsed.companies[idx].name }
    const grp = classify(cons); const pr = computePrices(cons, grp, exp);
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
      const f = parseFloat(g.factor);
      if (!isNaN(f) && f > 0) {
        for (const i of g.cols) { if (pph[i] !== undefined) pph[i] = pph[i] * f }
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
    setAdjustGroups([...adjustGroups, { id, cols, factor: '' }]);
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
        <div className={styles.field}>
          <label htmlFor="excelFile">Excel/CSV（24小时用电量，单位：MWh）</label>
          <input id="excelFile" type="file" accept=".xlsx,.xls,.csv" onChange={e => { const f = e.target.files && e.target.files[0] ? e.target.files[0] : null; setFile(f); setFileName(f ? f.name : '') }} />
          <div className={`${styles.dropzone}`} onClick={() => document.getElementById('excelFile').click()} onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('isDrag') }} onDragLeave={e => { e.currentTarget.classList.remove('isDrag') }} onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('isDrag'); const f = e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files[0] : null; setFile(f); setFileName(f ? f.name : '') }}>
            拖拽文件到此或点击选择
          </div>
          <div className={styles.fileName}>{fileName}</div>
        </div>
        <div className={styles.field}>
          <label htmlFor="expectedRevenue">期望总收入（元）</label>
          <input id="expectedRevenue" type="number" step="0.01" value={expected} onChange={e => { setExpected(e.target.value); if (consumption && groups) { const exp = parseFloat(e.target.value); if (!isNaN(exp) && exp > 0) { const pr = computePrices(consumption, groups, exp); setBasePrices(pr); setPrices(pr); setAdjustSelected([]); setAdjustGroups([]); } } }} placeholder="例如 100000" />
        </div>
        <div className={styles.field}>
          <label htmlFor="companySelect">数据范围</label>
          <select id="companySelect" value={selected} onChange={e => { setSelected(e.target.value); recomputeForSelection(e.target.value) }}>
            <option value="__all__">汇总(全部)</option>
            {companies.map((c, idx) => (<option key={idx} value={String(idx)}>{c.name}</option>))}
          </select>
        </div>
        <button onClick={handleCalculate}>计算</button>
        <div className={styles.error}>{error}</div>
      </div>

      <div className={styles.controls}>
        <div className={styles.field}>
          <label>选择小时列（点击表头，可Shift连选）</label>
          <div className={styles.fileName}>{adjustSelected.length ? `已选：${adjustSelected.map(i => `${i + 1}点`).join('、')}` : '未选择'}</div>
        </div>
        <button disabled={!adjustSelected.length} onClick={addSelectionAsGroup}>添加为组</button>
        <button onClick={clearAllGroups}>清除全部组</button>
      </div>

      <div className={styles.controls}>
        <div className={styles.field}>
          <label>分组与倍数</label>
          <div className={styles.fileName}>{adjustGroups.length ? '' : '暂无组'}</div>
        </div>
        {adjustGroups.map((g, idx) => (
          <div key={g.id} className={styles.field}>
            <label>{`组${idx + 1}：${g.cols.map(i => `${i + 1}点`).join('、')}`}</label>
            <input type="number" step="0.01" value={g.factor} onChange={e => {
              const v = e.target.value;
              setAdjustGroups(adjustGroups.map(x => x.id === g.id ? { ...x, factor: v } : x));
            }} placeholder="倍数，例如 1.5" />
            <button onClick={() => removeGroup(g.id)}>删除该组</button>
          </div>
        ))}
      </div>

      <section className={styles.results}>
        <div className={styles.summary}>
          <div className={styles.card}><div className={styles.cardTitle}>数据范围</div><div className={styles.cardValue}>{scope}</div></div>
          <div className={styles.card}><div className={styles.cardTitle}>低档电价</div><div className={styles.cardValue}>{prices ? fmt(prices.pLow) : '--'}</div></div>
          <div className={styles.card}><div className={styles.cardTitle}>中档电价</div><div className={styles.cardValue}>{prices ? fmt(prices.pMid) : '--'}</div></div>
          <div className={styles.card}><div className={styles.cardTitle}>高档电价</div><div className={styles.cardValue}>{prices ? fmt(prices.pHigh) : '--'}</div></div>
          <div className={styles.card}><div className={styles.cardTitle}>总收入（元）</div><div className={styles.cardValue}>{prices ? fmtMoney(prices.revenue) : '--'}</div></div>
        </div>

        <h2>表格结果</h2>
        {renderTable()}
        <div className={styles.controls}>
          <button disabled={!prices} onClick={handleExport}>导出表格结果</button>
        </div>

        <h2>图表展示</h2>
        <div className={styles.chartWrap}><canvas ref={chartRef} height="140" /></div>
      </section>
    </div>
  )
}
