import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import styles from './index.module.css'

export default function RulesPage() {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [months, setMonths] = useState(() => Array.from({ length: 12 }, () => ({ count: 3, peaks: [], valleys: [] })))
  const [monthIdx, setMonthIdx] = useState(0)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [templates, setTemplates] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(false)
  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), [])

  function labelOf(i) {
    const m = months[monthIdx]
    if (m.peaks.includes(i)) return '峰'
    if (m.valleys.includes(i)) return '谷'
    return '平'
  }

  function toggleHour(i) {
    const m = months[monthIdx]
    const peaks = new Set(m.peaks)
    const valleys = new Set(m.valleys)
    const cur = labelOf(i)
    if (cur === '平') { peaks.add(i); valleys.delete(i) }
    else if (cur === '峰') { peaks.delete(i); valleys.add(i) }
    else { peaks.delete(i); valleys.delete(i) }
    const next = { ...m, peaks: Array.from(peaks).sort((a, b) => a - b), valleys: Array.from(valleys).sort((a, b) => a - b) }
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
    const next = { ...m, peaks: [], valleys: [] }
    const arr = months.slice(); arr[monthIdx] = next; setMonths(arr)
  }

  async function saveTemplate() {
    setMsg('')
    if (!name.trim()) { setMsg('请输入模板名称'); return }
    if (!supabase) { setMsg('未配置 Supabase，无法保存模板'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('rule_templates').insert([{ name, description, months }])
      if (error) { setMsg(error.message || '保存失败'); setSaving(false); return }
      setMsg('已保存模板')
      setSaving(false)
      // Don't clear immediately, maybe load the new one?
      // For now, reload list and clear form to simulate "saved and ready for next" or select it.
      // Let's select the new one if possible, but we don't get ID back easily without select.
      // Simple behavior: reload list, reset form.
      setName('')
      setDescription('')
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
      const { data, error } = await supabase.from('rule_templates').select('id,name,description,months,created_at').order('created_at', { ascending: false })
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
      const m = Array.isArray(tpl.months) && tpl.months.length === 12 ? tpl.months : Array.from({ length: 12 }, () => ({ count: 3, peaks: [], valleys: [] }))
      setMonths(m)
    } catch {
      setMsg('模板数据格式异常')
    }
  }

  function createNew() {
    setSelectedId('')
    setName('')
    setDescription('')
    setMonths(Array.from({ length: 12 }, () => ({ count: 3, peaks: [], valleys: [] })))
    setMsg('已切换到新建模式')
  }

  async function updateTemplate() {
    setMsg('')
    if (!selectedId) { setMsg('请先选择要编辑的模板'); return }
    if (!supabase) { setMsg('未配置 Supabase'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('rule_templates').update({ name, description, months }).eq('id', selectedId)
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

  return (
    <div className={styles.container}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 className={styles.title} style={{ margin: 0 }}>规则管理</h1>
        <a href="/" className={styles.secondaryButton}>返回首页</a>
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
                <label>峰谷数量 (个)</label>
                <input
                  type="number"
                  min="1"
                  max="11"
                  value={months[monthIdx].count}
                  onChange={e => setCount(e.target.value)}
                  style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #e2e8f0' }}
                />
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>设置该月份每天的峰谷时段总数</div>
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
                点击时间段切换状态：<span style={{ color: '#64748b' }}>平</span> → <span style={{ color: '#ef4444' }}>峰</span> → <span style={{ color: '#10b981' }}>谷</span>
              </div>
              <div className={styles.timeGrid}>
                {hours.map(i => {
                  const label = labelOf(i)
                  const cls = label === '峰' ? styles.levelHigh : (label === '谷' ? styles.levelLow : styles.levelMid)
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
