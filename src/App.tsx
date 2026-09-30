import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow, LogicalPosition, LogicalSize } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import { openPath } from '@tauri-apps/plugin-opener'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'

type Tab = 'todo' | 'focus' | 'note' | 'files' | 'settings'
type Task = { id: string; title: string; due: string; done: boolean; reminded: boolean; snoozedUntil: string; files: string[] }
type Note = { id: string; content: string }
type Habit = { id: string; name: string }
type Timer = { running: boolean; remaining: number; endAt: number | null }
type Data = { tasks: Task[]; notes: Note[]; habits: Habit[]; habitDone: Record<string, string[]>; minutes: number; quoteSource: string }

const STORAGE_KEY = 'timetipper-v1'
const BUBBLE_SIZE = 88
const PANEL_WIDTH = 408
const PANEL_HEIGHT = 558
const defaultQuotes = ['先完成眼前的一小步。', '给注意力一个清晰的方向。', '休息也是认真生活的一部分。']
const today = () => new Date().toLocaleDateString('sv-SE')
const fileName = (path: string) => path.split(/[\\/]/).pop() || path
const noteLabel = (note: Note) => note.content.trim().split(/\r?\n/)[0].slice(0, 14) || '空白便签'
const formatTime = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

function loadData(): Data {
  const fallback: Data = {
    tasks: [], notes: [{ id: 'first', content: '' }], habits: [{ id: 'water', name: '喝水' }, { id: 'move', name: '起身活动' }],
    habitDone: {}, minutes: 25, quoteSource: '',
  }
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return {
      tasks: Array.isArray(value.tasks) ? value.tasks : fallback.tasks,
      notes: Array.isArray(value.notes)
        ? value.notes.filter((note: unknown): note is Note => typeof note === 'object' && note !== null && typeof (note as Note).id === 'string' && typeof (note as Note).content === 'string')
        : [{ id: 'first', content: typeof value.note === 'string' ? value.note : '' }],
      habits: Array.isArray(value.habits) ? value.habits : fallback.habits,
      habitDone: value.habitDone && typeof value.habitDone === 'object' ? value.habitDone : fallback.habitDone,
      minutes: Number.isInteger(value.minutes) && value.minutes >= 1 && value.minutes <= 240 ? value.minutes : 25,
      quoteSource: typeof value.quoteSource === 'string' ? value.quoteSource : '',
    }
  } catch {
    return fallback
  }
}

export default function App() {
  const [data, setData] = useState<Data>(loadData)
  const [expanded, setExpanded] = useState(false)
  const [tab, setTab] = useState<Tab>('todo')
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDue, setTaskDue] = useState('')
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [selectedNoteId, setSelectedNoteId] = useState(data.notes[0]?.id || '')
  const [fileDragOver, setFileDragOver] = useState(false)
  const [habitName, setHabitName] = useState('')
  const [noticeId, setNoticeId] = useState<string | null>(null)
  const [habitPrompt, setHabitPrompt] = useState(false)
  const [timer, setTimer] = useState<Timer>({ running: false, remaining: data.minutes * 60, endAt: null })
  const [quotes, setQuotes] = useState(defaultQuotes)
  const [quoteIndex, setQuoteIndex] = useState(0)
  const [quoteError, setQuoteError] = useState('')
  const [quoteDraft, setQuoteDraft] = useState(data.quoteSource)
  const [autostart, setAutostart] = useState(false)
  const [error, setError] = useState('')
  const bubblePos = useRef({ x: 0, y: 0 })
  const pointerStart = useRef<{ x: number; y: number } | null>(null)
  const dragging = useRef(false)
  const completed = useRef(false)
  const currentDate = today()

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) }, [data])
  useEffect(() => {
    if (!isTauri()) return
    isEnabled().then(setAutostart).catch(() => undefined)
    const saved = localStorage.getItem('timetipper-ball-position')
    if (saved) {
      try {
        const position = JSON.parse(saved) as { x: number; y: number }
        bubblePos.current = {
          x: Math.max(0, Math.min(window.screen.availWidth - BUBBLE_SIZE, position.x)),
          y: Math.max(0, Math.min(window.screen.availHeight - BUBBLE_SIZE, position.y)),
        }
        void getCurrentWindow().setPosition(new LogicalPosition(bubblePos.current.x, bubblePos.current.y))
      } catch { /* use the centered position */ }
    } else {
      const position = { x: Math.max(0, window.screen.availWidth - 120), y: Math.max(0, window.screen.availHeight - 140) }
      bubblePos.current = position
      void getCurrentWindow().setPosition(new LogicalPosition(position.x, position.y))
    }
  }, [])

  const expand = useCallback(async (nextTab?: Tab) => {
    if (nextTab) setTab(nextTab)
    if (expanded) return
    if (isTauri()) {
      const window = getCurrentWindow()
      await invoke('set_bubble_shape', { bubble: false })
      const position = await window.outerPosition()
      const factor = await window.scaleFactor()
      bubblePos.current = { x: position.x / factor, y: position.y / factor }
      const x = Math.min(bubblePos.current.x, Math.max(0, screen.availWidth - PANEL_WIDTH - 12))
      const y = Math.min(bubblePos.current.y, Math.max(0, screen.availHeight - PANEL_HEIGHT - 12))
      await window.setPosition(new LogicalPosition(x, y))
      await window.setSize(new LogicalSize(PANEL_WIDTH, PANEL_HEIGHT))
      await window.setFocus()
    }
    setExpanded(true)
  }, [expanded])

  const collapse = useCallback(async () => {
    if (isTauri()) {
      const window = getCurrentWindow()
      await window.setSize(new LogicalSize(BUBBLE_SIZE, BUBBLE_SIZE))
      await window.setPosition(new LogicalPosition(bubblePos.current.x, bubblePos.current.y))
      await invoke('set_bubble_shape', { bubble: true })
    }
    setExpanded(false)
    setError('')
  }, [])

  useEffect(() => {
    if (!timer.running || !timer.endAt) return
    const interval = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((timer.endAt! - Date.now()) / 1000))
      setTimer(previous => ({ ...previous, remaining, running: remaining > 0, endAt: remaining > 0 ? previous.endAt : null }))
      if (remaining === 0 && !completed.current) {
        completed.current = true
        setHabitPrompt(true)
        setTab('focus')
        void expand('focus')
        try {
          const context = new AudioContext()
          const tone = context.createOscillator()
          tone.connect(context.destination)
          tone.frequency.value = 740
          tone.start()
          tone.stop(context.currentTime + 0.25)
        } catch { /* visual reminder still appears */ }
      }
    }, 250)
    return () => window.clearInterval(interval)
  }, [timer.running, timer.endAt, expand])

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (noticeId) return
      const due = data.tasks.find(task => !task.done && !task.reminded && task.due && new Date(task.snoozedUntil || task.due).getTime() <= Date.now())
      if (due) {
        setNoticeId(due.id)
        setData(previous => ({ ...previous, tasks: previous.tasks.map(task => task.id === due.id ? { ...task, reminded: true } : task) }))
        void expand('todo')
      }
    }, 1000)
    return () => window.clearInterval(interval)
  }, [data.tasks, noticeId, expand])

  useEffect(() => {
    const interval = window.setInterval(() => setQuoteIndex(index => (index + 1) % Math.max(quotes.length, 1)), 15000)
    return () => window.clearInterval(interval)
  }, [quotes.length])

  useEffect(() => {
    if (!data.quoteSource) { setQuotes(defaultQuotes); setQuoteError(''); return }
    let cancelled = false
    const refresh = async () => {
      try {
        const content = await invoke<string>('read_quotes', { source: data.quoteSource })
        if (cancelled) return
        const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
        setQuotes(lines.length ? lines : defaultQuotes)
        setQuoteIndex(0)
        setQuoteError(lines.length ? '' : '文件没有非空行')
      } catch (reason) {
        if (!cancelled) setQuoteError(String(reason))
      }
    }
    void refresh()
    const interval = window.setInterval(refresh, /^https?:\/\//i.test(data.quoteSource) ? 300000 : 5000)
    return () => { cancelled = true; window.clearInterval(interval) }
  }, [data.quoteSource])

  const update = (patch: Partial<Data>) => setData(previous => ({ ...previous, ...patch }))
  const addTask = () => {
    const title = taskTitle.trim()
    if (!title) return
    const task: Task = { id: crypto.randomUUID(), title, due: taskDue, done: false, reminded: false, snoozedUntil: '', files: [] }
    update({ tasks: [...data.tasks, task] })
    setSelectedTaskId(task.id)
    setTaskTitle('')
    setTaskDue('')
  }
  const changeTask = (id: string, patch: Partial<Task>) => update({ tasks: data.tasks.map(task => task.id === id ? { ...task, ...patch } : task) })
  const removeTask = (id: string) => {
    update({ tasks: data.tasks.filter(task => task.id !== id) })
    if (selectedTaskId === id) setSelectedTaskId('')
  }
  const startFocus = () => {
    const minutes = Math.max(1, Math.min(240, Math.round(data.minutes)))
    update({ minutes })
    completed.current = false
    setHabitPrompt(false)
    setTimer({ running: true, remaining: minutes * 60, endAt: Date.now() + minutes * 60000 })
    void collapse()
  }
  const pauseFocus = () => setTimer(previous => ({ ...previous, running: false, endAt: null }))
  const resumeFocus = () => { completed.current = false; setTimer(previous => ({ ...previous, running: true, endAt: Date.now() + previous.remaining * 1000 })) }
  const stopFocus = () => { completed.current = false; setTimer({ running: false, remaining: data.minutes * 60, endAt: null }) }
  const doneToday = data.habitDone[currentDate] || []
  const toggleHabit = (id: string) => {
    const next = doneToday.includes(id) ? doneToday.filter(value => value !== id) : [...doneToday, id]
    update({ habitDone: { ...data.habitDone, [currentDate]: next } })
  }
  const selectedTask = data.tasks.find(task => task.id === selectedTaskId)
  const selectedNote = data.notes.find(note => note.id === selectedNoteId) || data.notes[0]
  const appendFiles = useCallback((taskId: string, paths: string[]) => {
    setData(previous => ({
      ...previous,
      tasks: previous.tasks.map(task => task.id === taskId
        ? { ...task, files: [...new Set([...task.files, ...paths])] }
        : task),
    }))
  }, [])
  useEffect(() => {
    if (!isTauri() || !expanded || tab !== 'files') return
    let cancelled = false
    let unlisten: (() => void) | undefined
    getCurrentWindow().onDragDropEvent(event => {
      if (event.payload.type === 'enter' || event.payload.type === 'over') {
        setFileDragOver(true)
      } else if (event.payload.type === 'leave') {
        setFileDragOver(false)
      } else if (event.payload.type === 'drop') {
        setFileDragOver(false)
        if (!selectedTaskId) {
          setError('请先选择一个待办，再拖入文件。')
        } else {
          appendFiles(selectedTaskId, event.payload.paths)
        }
      }
    }).then(stop => { if (cancelled) stop(); else unlisten = stop }).catch(reason => setError(`无法接收拖入文件：${String(reason)}`))
    return () => { cancelled = true; unlisten?.(); setFileDragOver(false) }
  }, [expanded, tab, selectedTaskId, appendFiles])
  const addFiles = async () => {
    if (!selectedTask) return
    const picked = await open({ multiple: true, directory: false })
    const paths = typeof picked === 'string' ? [picked] : picked || []
    appendFiles(selectedTask.id, paths)
  }
  const addNote = () => {
    const id = crypto.randomUUID()
    setData(previous => ({ ...previous, notes: [...previous.notes, { id, content: '' }] }))
    setSelectedNoteId(id)
  }
  const deleteNote = (id: string) => {
    if (!window.confirm('删除这张便签？')) return
    setData(previous => ({ ...previous, notes: previous.notes.filter(note => note.id !== id) }))
    if (selectedNoteId === id) setSelectedNoteId(data.notes.find(note => note.id !== id)?.id || '')
  }
  const toggleAutostart = async () => {
    try {
      if (autostart) await disable(); else await enable()
      setAutostart(!autostart)
    } catch (reason) { setError(`无法设置开机启动：${String(reason)}`) }
  }
  const pickQuoteFile = async () => {
    const picked = await open({ multiple: false, filters: [{ name: 'Markdown', extensions: ['md'] }] })
    if (typeof picked === 'string') { setQuoteDraft(picked); update({ quoteSource: picked }) }
  }

  const remindedTask = data.tasks.find(task => task.id === noticeId)
  const onBubblePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!pointerStart.current || dragging.current || !isTauri()) return
    if (Math.hypot(event.clientX - pointerStart.current.x, event.clientY - pointerStart.current.y) > 5) {
      dragging.current = true
      void getCurrentWindow().startDragging().then(async () => {
        const window = getCurrentWindow()
        const position = await window.outerPosition()
        const factor = await window.scaleFactor()
        bubblePos.current = { x: position.x / factor, y: position.y / factor }
        localStorage.setItem('timetipper-ball-position', JSON.stringify(bubblePos.current))
      })
    }
  }

  return expanded ? (
    <main className="panel">
      <header className="panel-header" title="按住标题栏拖动窗口" onMouseDown={event => {
        if (event.button === 0 && !(event.target as HTMLElement).closest('button') && isTauri()) {
          void getCurrentWindow().startDragging().catch(reason => setError(`无法移动窗口：${String(reason)}`))
        }
      }}>
        <div><strong>Timetipper</strong><small>专注当下，顺手记录</small></div>
        <button className="icon-button" aria-label="收起为悬浮球" onClick={() => void collapse()}>●</button>
      </header>
      <nav className="tabs" aria-label="功能">
        {([['todo', '待办'], ['focus', '专注'], ['note', '便签'], ['files', '文件'], ['settings', '设置']] as const).map(([key, label]) => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav>
      {remindedTask && <div className="alert"><b>待办时间到了</b><span>{remindedTask.title}</span><div className="row"><button onClick={() => { changeTask(remindedTask.id, { snoozedUntil: new Date(Date.now() + 600000).toISOString(), reminded: false }); setNoticeId(null) }}>10 分钟后</button><button onClick={() => setNoticeId(null)}>知道了</button><button className="primary" onClick={() => { changeTask(remindedTask.id, { done: true }); setNoticeId(null) }}>完成</button></div></div>}
      {habitPrompt && <div className="alert"><b>专注结束，休息一下</b><span>喝点水，起身活动一下。</span><div className="row"><button className="primary" onClick={() => { setHabitPrompt(false); setTab('focus') }}>查看今日习惯</button></div></div>}
      {error && <div className="error" onClick={() => setError('')}>{error}</div>}
      <div className="content">
        {tab === 'todo' && <section>
          <h2>待办事项 <em>{data.tasks.filter(task => !task.done).length}</em></h2>
          <div className="add-row"><input aria-label="待办内容" value={taskTitle} onChange={event => setTaskTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') addTask() }} placeholder="写下一件要做的事"/><button className="primary" onClick={addTask}>添加</button></div>
          <label className="sub-label">提醒时间（可选）<input aria-label="提醒时间" type="datetime-local" value={taskDue} onChange={event => setTaskDue(event.target.value)}/></label>
          <div className="task-list">{[...data.tasks].sort((a, b) => Number(a.done) - Number(b.done) || (a.due || 'z').localeCompare(b.due || 'z')).map(task => <div className={`task ${task.done ? 'done' : ''}`} key={task.id}>
            <input type="checkbox" checked={task.done} onChange={() => changeTask(task.id, { done: !task.done })}/>
            <button className="task-body" onClick={() => { setSelectedTaskId(task.id); setTab('files') }}><span>{task.title}</span><small>{task.due ? new Date(task.due).toLocaleString('zh-CN') : '无提醒'} · {task.files.length} 个文件入口</small></button>
            <button className="subtle" aria-label={`删除 ${task.title}`} onClick={() => removeTask(task.id)}>×</button>
          </div>)}</div>
        </section>}
        {tab === 'focus' && <section>
          <h2>专注计时</h2>
          <div className="timer-face">{formatTime(timer.remaining)}</div>
          <div className="row center">{timer.running ? <button onClick={pauseFocus}>暂停</button> : timer.endAt === null && timer.remaining !== data.minutes * 60 ? <button className="primary" onClick={resumeFocus}>继续</button> : <button className="primary" onClick={startFocus}>开始专注</button>}<button onClick={stopFocus}>重置</button></div>
          <label className="sub-label">专注时长（分钟）<input type="number" min="1" max="240" value={data.minutes} onChange={event => update({ minutes: Number(event.target.value) })}/></label>
          <h3>今日习惯</h3>
          <div className="habits">{data.habits.map(habit => <label key={habit.id}><input type="checkbox" checked={doneToday.includes(habit.id)} onChange={() => toggleHabit(habit.id)}/>{habit.name}<button aria-label={`删除 ${habit.name}`} onClick={event => { event.preventDefault(); update({ habits: data.habits.filter(item => item.id !== habit.id) }) }}>×</button></label>)}</div>
          <div className="add-row"><input value={habitName} onChange={event => setHabitName(event.target.value)} placeholder="添加习惯" onKeyDown={event => { if (event.key === 'Enter' && habitName.trim()) { update({ habits: [...data.habits, { id: crypto.randomUUID(), name: habitName.trim() }] }); setHabitName('') } }}/><button onClick={() => { if (habitName.trim()) { update({ habits: [...data.habits, { id: crypto.randomUUID(), name: habitName.trim() }] }); setHabitName('') } }}>添加</button></div>
        </section>}
        {tab === 'note' && <section className="notes-section"><div className="section-heading"><h2>便签 <em>{data.notes.length}</em></h2><button className="primary" onClick={addNote}>＋ 新建</button></div><div className="note-list">{data.notes.map((note, index) => <button key={note.id} className={selectedNote?.id === note.id ? 'active' : ''} onClick={() => setSelectedNoteId(note.id)} title={noteLabel(note)}>{index + 1}. {noteLabel(note)}</button>)}</div>{selectedNote ? <><div className="note-toolbar"><span>自动保存</span><button className="subtle" onClick={() => deleteNote(selectedNote.id)}>删除这张</button></div><textarea className="note" aria-label="便签内容" value={selectedNote.content} onChange={event => { const content = event.target.value; setData(previous => ({ ...previous, notes: previous.notes.map(note => note.id === selectedNote.id ? { ...note, content } : note) })) }} placeholder="随手记下想法，自动保存…"/></> : <p className="hint">点击“新建”创建便签。</p>}</section>}
        {tab === 'files' && <section><h2>文件入口</h2><select aria-label="选择待办" value={selectedTaskId} onChange={event => setSelectedTaskId(event.target.value)}><option value="">选择一个待办</option>{data.tasks.filter(task => !task.done).map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select><p className="hint">保存原文件路径，不复制文件。</p><div className={`file-drop-zone ${fileDragOver ? 'drag-over' : ''}`}><strong>{fileDragOver ? '松开鼠标，添加文件入口' : '将文件拖到这里'}</strong><span>{selectedTask ? `添加到「${selectedTask.title}」` : '先选择一个待办'}</span></div><button className="primary" disabled={!selectedTask} onClick={() => void addFiles()}>或浏览文件</button><div className="file-list">{selectedTask?.files.map(path => <div className="file" key={path}><button onClick={() => void openPath(path).catch(reason => setError(`打不开原文件：${String(reason)}`))} title={path}>{fileName(path)}</button><button className="subtle" aria-label={`移除 ${fileName(path)}`} onClick={() => changeTask(selectedTask.id, { files: selectedTask.files.filter(item => item !== path) })}>×</button></div>)}</div></section>}
        {tab === 'settings' && <section><h2>设置</h2><label className="toggle"><span>开机自启动</span><input type="checkbox" checked={autostart} onChange={() => void toggleAutostart()}/></label><h3>名言来源</h3><p className="hint">本地 .md 文件或在线链接，每个非空行一句。</p><div className="add-row"><input aria-label="名言来源" value={quoteDraft} onChange={event => setQuoteDraft(event.target.value)} placeholder="粘贴 .md 链接或文件路径"/><button onClick={() => void pickQuoteFile()}>选择</button><button className="primary" onClick={() => update({ quoteSource: quoteDraft.trim() })}>应用</button></div>{quoteError && <p className="error-text">{quoteError}</p>}<button className="quit" onClick={() => { if (isTauri()) void getCurrentWindow().close().catch(reason => setError(`无法退出：${String(reason)}`)) }}>退出程序</button></section>}
      </div>
      <footer className="quote" title={data.quoteSource || '内置名言'}>“{quotes[quoteIndex] || defaultQuotes[0]}”</footer>
    </main>
  ) : (
    <button className="bubble" title="点击展开功能，拖动可移动" onPointerDown={event => { pointerStart.current = { x: event.clientX, y: event.clientY }; dragging.current = false }} onPointerMove={onBubblePointerMove} onPointerUp={() => { pointerStart.current = null }} onClick={() => { if (!dragging.current) void expand(); dragging.current = false }} onContextMenu={event => { event.preventDefault(); void expand('settings') }}>
      <span className="bubble-time">{formatTime(timer.remaining)}</span><span className="bubble-caption">{timer.running ? '专注中' : '点我展开'}</span>
    </button>
  )
}
