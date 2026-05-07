const { ipcRenderer } = require('electron')

let projects = []
const timers = {}   // { [id]: { running, seconds, interval, sessionStart } }
let inHistory = false

// ── Utilidades ──────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0') }
function fmtSeconds(s) {
  return `${pad(Math.floor(s/3600))}:${pad(Math.floor((s%3600)/60))}:${pad(s%60)}`
}
function fmtHuman(s) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}H ${pad(m)}M` : `${m}M ${pad(s%60)}S`
}
function fmtHumanLong(s) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
function dateShort(iso) {
  return new Date(iso).toLocaleDateString('es-ES', { day:'2-digit', month:'2-digit', year:'2-digit' })
}

function getActive()   { return projects.filter(p => p.status === 'active') }
function getArchived() { return projects.filter(p => p.status === 'archived')
  .sort((a, b) => new Date(b.archivedAt) - new Date(a.archivedAt)) }

// ── Vista activa ─────────────────────────────────────────────
function renderAll() {
  const area  = document.getElementById('cardsArea')
  const empty = document.getElementById('emptyState')
  const active = getActive()

  area.querySelectorAll('.project-card').forEach(el => {
    if (!active.find(p => p.id === el.dataset.id)) el.remove()
  })

  empty.style.display = active.length === 0 ? 'flex' : 'none'
  active.forEach(proj => {
    const existing = area.querySelector(`.project-card[data-id="${proj.id}"]`)
    if (existing) updateCardStatic(existing, proj)
    else area.insertBefore(buildCard(proj), empty)
  })
}

function buildCard(proj) {
  const t = getTimer(proj.id)
  const card = document.createElement('div')
  card.className = 'project-card' + (t.running ? ' running' : '')
  card.dataset.id = proj.id

  card.innerHTML = `
    <div class="card-top">
      <span class="card-indicator">${t.running ? '▶' : '·'}</span>
      <span class="card-name" title="Doble clic para renombrar">${proj.name}</span>
      <button class="card-archive" title="Archivar proyecto">⏏</button>
    </div>
    <div class="card-bottom">
      <div class="card-time ${t.running ? 'blinking' : ''}">${fmtSeconds(t.seconds)}</div>
      <div class="card-btns">
        <button class="card-btn card-play"  ${t.running ? 'disabled' : ''}>▶ PLAY</button>
        <button class="card-btn card-stop"  ${!t.running ? 'disabled' : ''}>■ STOP</button>
      </div>
      <span class="card-total">${fmtHuman(proj.totalSeconds + t.seconds)}</span>
    </div>
  `

  card.querySelector('.card-play').addEventListener('click', () => startTimer(proj.id))
  card.querySelector('.card-stop').addEventListener('click', () => stopTimer(proj.id))
  card.querySelector('.card-archive').addEventListener('click', () => archiveProject(proj.id))

  const nameEl = card.querySelector('.card-name')
  nameEl.addEventListener('dblclick', () => startRename(card, proj))

  return card
}

function updateCardStatic(card, proj) {
  const t = getTimer(proj.id)
  card.classList.toggle('running', t.running)
  card.querySelector('.card-indicator').textContent = t.running ? '▶' : '·'
  const nameEl = card.querySelector('.card-name')
  if (nameEl) nameEl.textContent = proj.name
  const totalEl = card.querySelector('.card-total')
  if (totalEl) totalEl.textContent = fmtHuman(proj.totalSeconds + t.seconds)
  card.querySelector('.card-play').disabled = t.running
  card.querySelector('.card-stop').disabled = !t.running
}

function updateCardTime(projectId) {
  const card = document.querySelector(`.project-card[data-id="${projectId}"]`)
  if (!card) return
  const t = getTimer(projectId)
  const proj = projects.find(p => p.id === projectId)
  card.querySelector('.card-time').textContent = fmtSeconds(t.seconds)
  const totalEl = card.querySelector('.card-total')
  if (totalEl && proj) totalEl.textContent = fmtHuman(proj.totalSeconds + t.seconds)
}

// ── Vista historial ───────────────────────────────────────────
function renderHistory() {
  const list = document.getElementById('historyList')
  const archived = getArchived()

  if (archived.length === 0) {
    list.innerHTML = '<div class="history-empty">No hay proyectos archivados todavía</div>'
    return
  }

  list.innerHTML = archived.map(proj => {
    const inicio = proj.sessions.length > 0
      ? dateShort(proj.sessions[0].start)
      : dateShort(proj.createdAt)
    const fin    = proj.archivedAt ? dateShort(proj.archivedAt) : '—'
    const ses    = proj.sessions.length
    const prom   = ses > 0 ? Math.round(proj.totalSeconds / ses / 60) : 0

    return `
      <div class="history-card">
        <div class="hc-top">
          <span class="hc-icon">▣</span>
          <span class="hc-name">${proj.name}</span>
          <span class="hc-total">${fmtHumanLong(proj.totalSeconds)}</span>
        </div>
        <div class="hc-meta">
          <span>📅 ${inicio} → ${fin}</span>
          <span>◎ ${ses} ses.</span>
          ${prom > 0 ? `<span>⌀ ${prom}min</span>` : ''}
        </div>
      </div>`
  }).join('')
}

// ── Toggle historial / activos ────────────────────────────────
function showHistory() {
  inHistory = true
  document.getElementById('cardsArea').style.display   = 'none'
  document.getElementById('historyArea').style.display = 'flex'
  document.getElementById('barActive').style.display   = 'none'
  document.getElementById('barHistory').style.display  = 'flex'
  document.getElementById('topTitle').textContent      = '◈ HISTORIAL ◈'
  const nf = document.getElementById('newForm')
  if (nf.style.display !== 'none') hideNewForm()
  renderHistory()
}

function showActive() {
  inHistory = false
  document.getElementById('cardsArea').style.display   = 'flex'
  document.getElementById('historyArea').style.display = 'none'
  document.getElementById('barActive').style.display   = 'flex'
  document.getElementById('barHistory').style.display  = 'none'
  document.getElementById('topTitle').textContent      = '◈ CASSETTE TIMER ◈'
}

// ── Timer ────────────────────────────────────────────────────
function getTimer(id) {
  if (!timers[id]) timers[id] = { running: false, seconds: 0, interval: null, sessionStart: null }
  return timers[id]
}

function startTimer(projectId) {
  const t = getTimer(projectId)
  if (t.running) return
  t.running = true
  t.seconds = 0
  t.sessionStart = new Date()

  const card = document.querySelector(`.project-card[data-id="${projectId}"]`)
  if (card) {
    card.classList.add('running')
    card.querySelector('.card-indicator').textContent = '▶'
    card.querySelector('.card-play').disabled = true
    card.querySelector('.card-stop').disabled = false
    card.querySelector('.card-time').classList.add('blinking')
  }

  t.interval = setInterval(() => {
    t.seconds++
    updateCardTime(projectId)
  }, 1000)
}

async function stopTimer(projectId) {
  const t = getTimer(projectId)
  if (!t.running) return
  t.running = false
  clearInterval(t.interval)
  t.interval = null

  const duration = t.seconds
  const start    = t.sessionStart
  t.seconds      = 0
  t.sessionStart = null

  const card = document.querySelector(`.project-card[data-id="${projectId}"]`)
  if (card) {
    card.classList.remove('running')
    card.querySelector('.card-indicator').textContent = '·'
    card.querySelector('.card-play').disabled  = false
    card.querySelector('.card-stop').disabled  = true
    card.querySelector('.card-time').classList.remove('blinking')
    card.querySelector('.card-time').textContent = fmtSeconds(0)
  }

  if (duration > 0) {
    const updated = await ipcRenderer.invoke('add-session', {
      projectId, duration,
      start: start.toISOString(),
      end: new Date().toISOString()
    })
    if (updated) {
      const idx = projects.findIndex(p => p.id === projectId)
      if (idx !== -1) projects[idx] = updated
      if (card) updateCardStatic(card, updated)
    }
  }
}

// ── Archivar ─────────────────────────────────────────────────
async function archiveProject(projectId) {
  const t = getTimer(projectId)
  if (t.running) await stopTimer(projectId)

  const archived = await ipcRenderer.invoke('archive-project', projectId)
  if (archived) {
    if (timers[projectId]) { clearInterval(timers[projectId].interval); delete timers[projectId] }
    projects = projects.filter(p => p.id !== projectId)
    renderAll()
  }
}

// ── Renombrar ────────────────────────────────────────────────
function startRename(card, proj) {
  const nameEl = card.querySelector('.card-name')
  const input  = document.createElement('input')
  input.type = 'text'
  input.className = 'card-name-input'
  input.value = proj.name
  input.maxLength = 28
  input.spellcheck = false
  nameEl.replaceWith(input)
  input.focus(); input.select()

  async function commit() {
    const name = input.value.trim() || proj.name
    await ipcRenderer.invoke('rename-project', { projectId: proj.id, name })
    const p = projects.find(p => p.id === proj.id)
    if (p) p.name = name
    const span = document.createElement('span')
    span.className = 'card-name'
    span.title = 'Doble clic para renombrar'
    span.textContent = name
    span.addEventListener('dblclick', () => startRename(card, p))
    input.replaceWith(span)
  }

  input.addEventListener('blur', commit)
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') input.blur()
    if (e.key === 'Escape') {
      input.removeEventListener('blur', commit)
      const span = document.createElement('span')
      span.className = 'card-name'
      span.title = 'Doble clic para renombrar'
      span.textContent = proj.name
      span.addEventListener('dblclick', () => startRename(card, proj))
      input.replaceWith(span)
    }
  })
}

// ── Nuevo proyecto ────────────────────────────────────────────
const newProjectBtn  = document.getElementById('newProjectBtn')
const newForm        = document.getElementById('newForm')
const newProjectName = document.getElementById('newProjectName')
const confirmNewBtn  = document.getElementById('confirmNewBtn')
const cancelNewBtn   = document.getElementById('cancelNewBtn')

function showNewForm() {
  newForm.style.display = 'flex'
  newProjectName.value  = ''
  newProjectName.focus()
  newProjectBtn.style.display = 'none'
}
function hideNewForm() {
  newForm.style.display = 'none'
  newProjectBtn.style.display = ''
}
async function createProject() {
  const name = newProjectName.value.trim()
  if (!name) return
  const proj = await ipcRenderer.invoke('create-project', name)
  projects.push(proj)
  hideNewForm()
  renderAll()
}

newProjectBtn.addEventListener('click', showNewForm)
cancelNewBtn.addEventListener('click', hideNewForm)
confirmNewBtn.addEventListener('click', createProject)
newProjectName.addEventListener('keydown', e => {
  if (e.key === 'Enter')  createProject()
  if (e.key === 'Escape') hideNewForm()
})

// ── Historial / Exportar ──────────────────────────────────────
document.getElementById('historyBtn').addEventListener('click', showHistory)
document.getElementById('backBtn').addEventListener('click', showActive)

async function exportReport() {
  const result = await ipcRenderer.invoke('export-report')
  if (result) {
    // Feedback visual breve en el botón
    const btn = inHistory
      ? document.getElementById('exportBtn2')
      : document.getElementById('exportBtn')
    const orig = btn.textContent
    btn.textContent = '✓ ABIERTO'
    setTimeout(() => { btn.textContent = orig }, 2000)
  }
}
document.getElementById('exportBtn').addEventListener('click', exportReport)
document.getElementById('exportBtn2').addEventListener('click', exportReport)

// ── Cerrar app ────────────────────────────────────────────────
async function handleClose() {
  const running = Object.entries(timers).filter(([, t]) => t.running)
  for (const [id] of running) await stopTimer(id)

  const runningNames = running.map(([id]) => {
    const p = projects.find(p => p.id === id)
    return p ? p.name : id
  })

  const shouldQuit = await ipcRenderer.invoke('show-close-summary', { runningNames })
  if (shouldQuit) ipcRenderer.send('quit-app')
}

document.getElementById('closeBtn').addEventListener('click', handleClose)
ipcRenderer.on('app-closing', handleClose)

// ── Init ──────────────────────────────────────────────────────
;(async () => {
  const data = await ipcRenderer.invoke('load-data')
  projects = data.projects || []
  renderAll()
})()
