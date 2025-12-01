import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import styles from './index.module.css'

export default function RulesPage() {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [months, setMonths] = useState(() => Array.from({ length: 12 }, () => ({ count: 3, peaks: [], valleys: [], spikes: [], deeps: [] })))
  const [monthIdx, setMonthIdx] = useState(0)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [templates, setTemplates] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(false)
  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), [])
  const [factors, setFactors] = useState({ flat: 1, spike: 2, peak: 1.7, valley: 0.3, deep: 0.1 })

  function labelOf(i) {
    const m = months[monthIdx]
    const peaks = Array.isArray(m.peaks) ? m.peaks : []
    const valleys = Array.isArray(m.valleys) ? m.valleys : []
    const spikes = Array.isArray(m.spikes) ? m.spikes : []
    const deeps = Array.isArray(m.deeps) ? m.deeps : []
    if (spikes.includes(i)) return '尖峰'
    if (peaks.includes(i)) return '峰'
    if (valleys.includes(i)) return '谷'
    if (deeps.includes(i)) return '深谷'
    return '平'
  }

  function toggleHour(i) {
    const m = months[monthIdx]
    const peaks = new Set(Array.isArray(m.peaks) ? m.peaks : [])
    const valleys = new Set(Array.isArray(m.valleys) ? m.valleys : [])
    const spikes = new Set(Array.isArray(m.spikes) ? m.spikes : [])
    const deeps = new Set(Array.isArray(m.deeps) ? m.deeps : [])
    const cur = labelOf(i)
    if (cur === '平') { spikes.add(i); peaks.delete(i); valleys.delete(i); deeps.delete(i) }
    else if (cur === '尖峰') { spikes.delete(i); peaks.add(i); valleys.delete(i); deeps.delete(i) }
    else if (cur === '峰') { spikes.delete(i); peaks.delete(i); valleys.add(i); deeps.delete(i) }
    else if (cur === '谷') { spikes.delete(i); peaks.delete(i); valleys.delete(i); deeps.add(i) }
    else { spikes.delete(i); peaks.delete(i); valleys.delete(i); deeps.delete(i) }
    const next = {
      ...m,
      peaks: Array.from(peaks).sort((a, b) => a - b),
      valleys: Array.from(valleys).sort((a, b) => a - b),
      spikes: Array.from(spikes).sort((a, b) => a - b),
      deeps: Array.from(deeps).sort((a, b) => a - b)
    }
    const arr = months.slice(); arr[monthIdx] = next; setMonths(arr)
  }

  function setCount(val) {
    const v = parseInt(val, 10)
    const m = months[monthIdx]
    const next = { ...m, count: isNaN(v) || v <= 0 ? 3 : v }
    const arr = months.slice(); arr[monthIdx] = next; setMonths(arr)
  }

  function clearCurrentMonth() {
    const m = months[monthIdx]
    const next = { ...m, peaks: [], valleys: [], spikes: [], deeps: [] }
    const arr = months.slice(); arr[monthIdx] = next; setMonths(arr)
  }

  async function saveTemplate() {
    setMsg('')
    if (!name.trim()) { setMsg('请输入模板名称'); return }
    if (!supabase) { setMsg('未配置 Supabase，无法保存模板'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('rule_templates').insert([{ name, description, months, factors }])
      if (error) { setMsg(error.message || '保存失败'); setSaving(false); return }
      setMsg('已保存模板')
      setSaving(false)
      // Don't clear immediately, maybe load the new one?
      // For now, reload list and clear form to simulate "saved and ready for next" or select it.
      // Let's select the new one if possible, but we don't get ID back easily without select.
      // Simple behavior: reload list, reset form.
      setName('')
      setDescription('')
      setFactors({ flat: 1, spike: 2, peak: 1.7, valley: 0.3, deep: 0.1 })
      await loadTemplates()
    } catch (e) {
      setMsg(String(e && e.message ? e.message : e))
      setSaving(false)
    }
  }

  async function loadTemplates() {
    setLoading(true)
    setMsg('')
    try {
      if (!supabase) { setMsg('未配置 Supabase'); setLoading(false); return }
      const { data, error } = await supabase.from('rule_templates').select('id,name,description,months,factors,created_at').order('created_at', { ascending: false })
      if (error) { setMsg(error.message || '读取模板失败'); setLoading(false); return }
      setTemplates(Array.isArray(data) ? data : [])
      setLoading(false)
    } catch (e) {
      setMsg(String(e && e.message ? e.message : e))
      setLoading(false)
    }
  }

  function loadIntoEditor(id) {
    setMsg('')
    setSelectedId(id)
    const tpl = templates.find(t => t.id === id)
    if (!tpl) { setMsg('未找到模板'); return }
    setName(tpl.name || '')
    setDescription(tpl.description || '')
    try {
      const m = Array.isArray(tpl.months) && tpl.months.length === 12 ? tpl.months : Array.from({ length: 12 }, () => ({ count: 3, peaks: [], valleys: [], spikes: [], deeps: [] }))
      setMonths(m)
      const f = tpl.factors || {}
      setFactors({
        flat: parseFloat(f.flat) > 0 ? parseFloat(f.flat) : 1,
        spike: parseFloat(f.spike) > 0 ? parseFloat(f.spike) : 2,
        peak: parseFloat(f.peak) > 0 ? parseFloat(f.peak) : 1.7,
        valley: parseFloat(f.valley) > 0 ? parseFloat(f.valley) : 0.3,
        deep: parseFloat(f.deep) > 0 ? parseFloat(f.deep) : 0.1
      })
    } catch {
      setMsg('模板数据格式异常')
    }
  }

  function createNew() {
    setSelectedId('')
    setName('')
    setDescription('')
    setMonths(Array.from({ length: 12 }, () => ({ count: 3, peaks: [], valleys: [], spikes: [], deeps: [] })))
    setFactors({ flat: 1, spike: 2, peak: 1.7, valley: 0.3, deep: 0.1 })
    setMsg('已切换到新建模式')
  }

  async function updateTemplate() {
    setMsg('')
    if (!selectedId) { setMsg('请先选择要编辑的模板'); return }
    if (!supabase) { setMsg('未配置 Supabase'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('rule_templates').update({ name, description, months, factors }).eq('id', selectedId)
      if (error) { setMsg(error.message || '更新失败'); setSaving(false); return }
      setMsg('模板已更新')
      setSaving(false)
      await loadTemplates()
    } catch (e) {
      setMsg(String(e && e.message ? e.message : e))
      setSaving(false)
    }
  }

  async function deleteTemplate() {
    setMsg('')
    if (!selectedId) { setMsg('请先选择要删除的模板'); return }
    if (!supabase) { setMsg('未配置 Supabase'); return }
    if (!confirm('确定要删除这个模板吗？')) return
    setSaving(true)
    try {
      const { data, error } = await supabase.from('rule_templates').delete().eq('id', selectedId).select('id')
      if (error) { setMsg(error.message || '删除失败'); setSaving(false); return }
      if (!Array.isArray(data) || data.length === 0) { setMsg('未删除：可能无权限或模板不存在'); setSaving(false); return }
      setMsg('模板已删除')
      setSaving(false)
      createNew() // Reset to new mode
      await loadTemplates()
    } catch (e) {
      setMsg(String(e && e.message ? e.message : e))
      setSaving(false)
    }
  }

  useEffect(() => { loadTemplates() }, [])

  async function exportExcelTemplate() {
    try {
      const XLSX = await import('xlsx')
      const header = ['时段数', ...Array.from({ length: 12 }, (_, i) => `${i + 1}月`)]
      const aoa = [header]
      for (let h = 1; h <= 24; h++) {
        const row = [h]
        for (let m = 0; m < 12; m++) {
          const cfg = months[m] || { peaks: [], valleys: [], spikes: [], deeps: [], count: 3 }
          const label = (Array.isArray(cfg.spikes) && cfg.spikes.includes(h - 1)) ? '尖峰' : (Array.isArray(cfg.peaks) && cfg.peaks.includes(h - 1)) ? '峰' : (Array.isArray(cfg.valleys) && cfg.valleys.includes(h - 1)) ? '谷' : (Array.isArray(cfg.deeps) && cfg.deeps.includes(h - 1)) ? '深谷' : '平'
          row.push(label)
        }
        aoa.push(row)
      }
      const wb = XLSX.utils.book_new()
      const ws = XLSX.utils.aoa_to_sheet(aoa)
      ws['!cols'] = [{ wch: 8 }, ...Array(12).fill({ wch: 10 })]
      XLSX.utils.book_append_sheet(wb, ws, '时段模板')
      const ts = new Date(); const pad = n => String(n).padStart(2, '0')
      const nameSafe = (name || '规则模板').replace(/[\\/:*?"<>|]/g, '-')
      const fileName = `时段模板-${nameSafe}-${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}.xlsx`
      XLSX.writeFile(wb, fileName)
      setMsg('已导出 Excel 模板')
    } catch (e) {
      setMsg(String(e && e.message ? e.message : e))
    }
  }

  return (
    <div className={styles.container}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 className={styles.title} style={{ margin: 0 }}>规则管理</h1>
        <Link href="/" className={styles.secondaryButton}>返回首页</Link>
      </div>

      <div className={styles.rulesContainer}>
        {/* Sidebar: Template List */}
        <div className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <h2>模板列表</h2>
            <button className={styles.iconButton} onClick={loadTemplates} title="刷新列表">↻</button>
          </div>
          <div className={styles.templateList}>
            <div
              className={`${styles.templateItem} ${!selectedId ? styles.active : ''}`}
              onClick={createNew}
            >
              <div className={styles.templateName}>+ 新建模板</div>
              <div className={styles.templateDesc}>创建新的分时电价规则</div>
            </div>
            {templates.map(t => (
              <div
                key={t.id}
                className={`${styles.templateItem} ${selectedId === t.id ? styles.active : ''}`}
                onClick={() => loadIntoEditor(t.id)}
              >
                <div className={styles.templateName}>{t.name}</div>
                <div className={styles.templateDesc}>{t.description || '无备注'}</div>
              </div>
            ))}
            {templates.length === 0 && !loading && (
              <div style={{ padding: 16, color: '#94a3b8', textAlign: 'center', fontSize: 12 }}>暂无模板</div>
            )}
          </div>
        </div>

        {/* Main Content: Editor */}
        <div className={styles.mainContent}>
          <div className={styles.editorHeader}>
            <input
              type="text"
              className={styles.titleInput}
              placeholder="输入模板名称..."
              value={name}
              onChange={e => setName(e.target.value)}
            />
            <div className={styles.headerActions}>
              {selectedId ? (
                <>
                  <button className={styles.actionButton} disabled={saving} onClick={updateTemplate}>保存修改</button>
                  <button className={styles.secondaryButton} disabled={saving} onClick={saveTemplate}>另存为新模板</button>
                  <button className={styles.dangerButton} disabled={saving} onClick={deleteTemplate}>删除</button>
                </>
              ) : (
                <button className={styles.actionButton} disabled={saving} onClick={saveTemplate}>保存模板</button>
              )}
              <button className={styles.secondaryButton} disabled={saving} onClick={exportExcelTemplate}>导出Excel模板</button>
            </div>
          </div>

          <input
            type="text"
            className={styles.descInput}
            placeholder="添加备注信息 (可选)..."
            value={description}
            onChange={e => setDescription(e.target.value)}
          />

          {/* Month Navigation */}
          <div className={styles.monthTabs}>
            {Array.from({ length: 12 }, (_, i) => (
              <button
                key={i}
                className={`${styles.monthTab} ${monthIdx === i ? styles.active : ''}`}
                onClick={() => setMonthIdx(i)}
              >
                {i + 1}月
              </button>
            ))}
          </div>

          {/* Configuration Area */}
          <div className={styles.configArea}>
            {/* Left Sidebar: Settings */}
            <div className={styles.configSidebar}>
              <div className={styles.field}>
                <label>电价系数配置</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ width: 60, fontWeight: 500, color: '#b91c1c' }}>尖峰</span>
                    <input type="number" step="0.01" value={factors.spike} onChange={e => setFactors({ ...factors, spike: e.target.value })} style={{ width: 100, padding: '4px 8px', borderRadius: 4, border: '1px solid #cbd5e1' }} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ width: 60, fontWeight: 500, color: '#ef4444' }}>峰</span>
                    <input type="number" step="0.01" value={factors.peak} onChange={e => setFactors({ ...factors, peak: e.target.value })} style={{ width: 100, padding: '4px 8px', borderRadius: 4, border: '1px solid #cbd5e1' }} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ width: 60, fontWeight: 500, color: '#64748b' }}>平</span>
                    <input type="number" disabled value={1} style={{ width: 100, background: '#f1f5f9', color: '#94a3b8', padding: '4px 8px', borderRadius: 4, border: '1px solid #cbd5e1' }} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ width: 60, fontWeight: 500, color: '#10b981' }}>谷</span>
                    <input type="number" step="0.01" value={factors.valley} onChange={e => setFactors({ ...factors, valley: e.target.value })} style={{ width: 100, padding: '4px 8px', borderRadius: 4, border: '1px solid #cbd5e1' }} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ width: 60, fontWeight: 500, color: '#0ea5e9' }}>深谷</span>
                    <input type="number" step="0.01" value={factors.deep} onChange={e => setFactors({ ...factors, deep: e.target.value })} style={{ width: 100, padding: '4px 8px', borderRadius: 4, border: '1px solid #cbd5e1' }} />
                  </div>
                </div>
              </div>

              <div className={styles.field}>
                <label>操作</label>
                <button className={styles.secondaryButton} onClick={clearCurrentMonth} style={{ width: '100%', justifyContent: 'center' }}>清空当前月配置</button>
              </div>

              {msg && (
                <div className={styles.error} style={{ marginTop: 'auto' }}>
                  {msg}
                </div>
              )}
            </div>

            {/* Right Content: Time Grid */}
            <div>
              <div style={{ marginBottom: 12, fontSize: 14, fontWeight: 500, color: '#475569' }}>
                点击时间段切换状态：<span style={{ color: '#64748b' }}>平</span> → <span style={{ color: '#b91c1c' }}>尖峰</span> → <span style={{ color: '#ef4444' }}>峰</span> → <span style={{ color: '#10b981' }}>谷</span> → <span style={{ color: '#0ea5e9' }}>深谷</span>
              </div>
              <div className={styles.timeGrid}>
                {hours.map(i => {
                  const label = labelOf(i)
                  const clsMap = { '尖峰': styles.levelSpike, '峰': styles.levelPeak, '平': styles.levelFlat, '谷': styles.levelValley, '深谷': styles.levelDeep }
                  const cls = clsMap[label] || styles.levelFlat
                  return (
                    <div
                      key={i}
                      className={`${styles.timeSlot} ${cls}`}
                      onClick={() => toggleHour(i)}
                    >
                      <div>{i}:00</div>
                      <div style={{ fontSize: 12, opacity: 0.8 }}>{label}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
