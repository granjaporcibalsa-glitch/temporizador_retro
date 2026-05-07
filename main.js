const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

const DATA_FILE = path.join(app.getPath('userData'), 'cassette-data.json')

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
  } catch {}
  return { projects: [] }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

let win

function createWindow() {
  win = new BrowserWindow({
    width: 320,
    height: 480,
    minHeight: 260,
    maxHeight: 800,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    transparent: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })
  win.loadFile('index.html')
  win.on('close', e => {
    e.preventDefault()
    win.webContents.send('app-closing')
  })
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

ipcMain.handle('load-data', () => loadData())

ipcMain.handle('create-project', (_, name) => {
  const data = loadData()
  const project = {
    id: uuidv4(),
    name: name.trim() || 'Sin nombre',
    status: 'active',
    createdAt: new Date().toISOString(),
    archivedAt: null,
    totalSeconds: 0,
    sessions: []
  }
  data.projects.push(project)
  saveData(data)
  return project
})

ipcMain.handle('add-session', (_, { projectId, duration, start, end }) => {
  const data = loadData()
  const project = data.projects.find(p => p.id === projectId)
  if (!project) return null
  project.sessions.push({ start, end, duration })
  project.totalSeconds += duration
  saveData(data)
  return project
})

ipcMain.handle('archive-project', async (_, projectId) => {
  const data = loadData()
  const project = data.projects.find(p => p.id === projectId)
  if (!project) return false

  const h = Math.floor(project.totalSeconds / 3600)
  const m = Math.floor((project.totalSeconds % 3600) / 60)
  const totalStr = h > 0 ? `${h}h ${m}m` : `${m}m`
  const firstDate = project.sessions.length > 0
    ? new Date(project.sessions[0].start).toLocaleDateString('es-ES')
    : new Date(project.createdAt).toLocaleDateString('es-ES')

  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: '◈ ARCHIVAR PROYECTO',
    message: `"${project.name}"`,
    detail: [
      `Tiempo total:  ${totalStr}`,
      `Sesiones:      ${project.sessions.length}`,
      `Inicio:        ${firstDate}`,
      '',
      'El proyecto desaparecerá del panel.',
      'Sus datos quedarán guardados.'
    ].join('\n'),
    buttons: ['Cancelar', 'Archivar proyecto'],
    defaultId: 1,
    cancelId: 0
  })

  if (response === 1) {
    project.status = 'archived'
    project.archivedAt = new Date().toISOString()
    saveData(data)
    return true
  }
  return false
})

ipcMain.handle('rename-project', (_, { projectId, name }) => {
  const data = loadData()
  const project = data.projects.find(p => p.id === projectId)
  if (!project || !name.trim()) return false
  project.name = name.trim()
  saveData(data)
  return true
})

ipcMain.handle('show-close-summary', async (_, { runningNames }) => {
  const detail = runningNames.length > 0
    ? `Timers activos:\n${runningNames.map(n => `  · ${n}`).join('\n')}\n\nSe guardarán antes de cerrar.`
    : ''
  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: '◈ CASSETTE TIMER',
    message: '¿Cerrar Cassette Timer?',
    detail,
    buttons: ['Cancelar', 'Guardar y cerrar'],
    defaultId: 1,
    cancelId: 0
  })
  return response === 1
})

// ── Exportar informe ──────────────────────────────────────────
ipcMain.handle('export-report', async () => {
  const data = loadData()
  const all = data.projects || []
  const docsDir = path.join(app.getPath('documents'), 'CassetteTimer')
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true })

  const ts = new Date().toISOString().slice(0, 10)

  // ── CSV ──
  const csvLines = [
    'Proyecto,Estado,Fecha inicio,Fecha fin,Tiempo total (min),Sesiones'
  ]
  all.forEach(p => {
    const minutos = Math.round(p.totalSeconds / 60)
    const inicio = p.sessions.length > 0
      ? new Date(p.sessions[0].start).toLocaleDateString('es-ES')
      : new Date(p.createdAt).toLocaleDateString('es-ES')
    const fin = p.archivedAt
      ? new Date(p.archivedAt).toLocaleDateString('es-ES')
      : 'En curso'
    csvLines.push(`"${p.name}","${p.status === 'active' ? 'Activo' : 'Archivado'}","${inicio}","${fin}",${minutos},${p.sessions.length}`)
  })
  const csvPath = path.join(docsDir, `cassette-timer-${ts}.csv`)
  fs.writeFileSync(csvPath, '﻿' + csvLines.join('\r\n'), 'utf8') // BOM para Excel

  // ── HTML ──
  function fmtSecs(s) {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    return h > 0 ? `${h}h ${m.toString().padStart(2,'0')}m` : `${m}m`
  }

  const activeProjects   = all.filter(p => p.status === 'active')
  const archivedProjects = all.filter(p => p.status === 'archived')
    .sort((a, b) => new Date(b.archivedAt) - new Date(a.archivedAt))

  function projectRows(list) {
    return list.map(p => {
      const inicio = p.sessions.length > 0
        ? new Date(p.sessions[0].start).toLocaleDateString('es-ES')
        : new Date(p.createdAt).toLocaleDateString('es-ES')
      const fin = p.archivedAt
        ? new Date(p.archivedAt).toLocaleDateString('es-ES')
        : '<span class="active-badge">En curso</span>'
      const sesiones = p.sessions.length
      const promMin = sesiones > 0 ? Math.round(p.totalSeconds / sesiones / 60) : 0
      return `
        <tr>
          <td class="name">${p.name}</td>
          <td class="center">${inicio}</td>
          <td class="center">${fin}</td>
          <td class="right bold">${fmtSecs(p.totalSeconds)}</td>
          <td class="center">${sesiones}</td>
          <td class="center dim">${promMin > 0 ? promMin + ' min' : '—'}</td>
        </tr>`
    }).join('')
  }

  const totalAll = all.reduce((a, p) => a + p.totalSeconds, 0)
  const totalActive = activeProjects.reduce((a, p) => a + p.totalSeconds, 0)
  const totalArchived = archivedProjects.reduce((a, p) => a + p.totalSeconds, 0)

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Cassette Timer — Informe ${ts}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Segoe UI', sans-serif; background:#1a1208; color:#e8c878; padding:32px; }
  h1   { font-size:22px; letter-spacing:3px; color:#f0d060; margin-bottom:4px; }
  .sub { font-size:13px; color:#8a6830; margin-bottom:32px; letter-spacing:1px; }
  .summary { display:flex; gap:20px; margin-bottom:32px; flex-wrap:wrap; }
  .stat { background:#2a1c0a; border:1px solid #5a3a18; border-radius:6px;
          padding:14px 20px; min-width:140px; }
  .stat-val { font-size:28px; color:#f0c030; letter-spacing:2px; }
  .stat-lbl { font-size:12px; color:#8a6020; letter-spacing:1px; margin-top:2px; }
  h2   { font-size:14px; letter-spacing:2px; color:#c09040; margin-bottom:10px;
         border-bottom:1px solid #3a2810; padding-bottom:6px; }
  table { width:100%; border-collapse:collapse; margin-bottom:32px; font-size:14px; }
  th   { background:#2a1c0a; color:#a07030; font-size:11px; letter-spacing:1px;
         padding:8px 10px; text-align:left; border-bottom:1px solid #4a2e10; }
  td   { padding:8px 10px; border-bottom:1px solid #2a1a08; color:#d4a850; }
  tr:hover td { background:rgba(100,60,10,0.2); }
  .name { color:#f0c040; font-weight:600; }
  .center { text-align:center; }
  .right  { text-align:right; }
  .bold   { font-weight:700; color:#f8d060; }
  .dim    { color:#7a5820; }
  .active-badge { background:#2a5010; color:#80d030; padding:1px 8px;
                  border-radius:10px; font-size:12px; }
  .footer { font-size:11px; color:#4a3010; margin-top:40px; letter-spacing:1px; }
</style>
</head>
<body>
<h1>◈ CASSETTE TIMER</h1>
<div class="sub">Informe generado el ${new Date().toLocaleDateString('es-ES', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</div>

<div class="summary">
  <div class="stat">
    <div class="stat-val">${fmtSecs(totalAll)}</div>
    <div class="stat-lbl">TIEMPO TOTAL</div>
  </div>
  <div class="stat">
    <div class="stat-val">${all.length}</div>
    <div class="stat-lbl">PROYECTOS</div>
  </div>
  <div class="stat">
    <div class="stat-val">${fmtSecs(totalActive)}</div>
    <div class="stat-lbl">EN ACTIVO</div>
  </div>
  <div class="stat">
    <div class="stat-val">${fmtSecs(totalArchived)}</div>
    <div class="stat-lbl">ARCHIVADOS</div>
  </div>
</div>

${activeProjects.length > 0 ? `
<h2>PROYECTOS ACTIVOS</h2>
<table>
  <thead><tr>
    <th>PROYECTO</th><th>INICIO</th><th>ESTADO</th>
    <th style="text-align:right">TOTAL</th><th>SESIONES</th><th>PROM./SESIÓN</th>
  </tr></thead>
  <tbody>${projectRows(activeProjects)}</tbody>
</table>` : ''}

${archivedProjects.length > 0 ? `
<h2>PROYECTOS ARCHIVADOS</h2>
<table>
  <thead><tr>
    <th>PROYECTO</th><th>INICIO</th><th>ARCHIVADO</th>
    <th style="text-align:right">TOTAL</th><th>SESIONES</th><th>PROM./SESIÓN</th>
  </tr></thead>
  <tbody>${projectRows(archivedProjects)}</tbody>
</table>` : ''}

<div class="footer">Archivo: ${csvPath}</div>
</body></html>`

  const htmlPath = path.join(docsDir, `cassette-timer-${ts}.html`)
  fs.writeFileSync(htmlPath, html, 'utf8')

  // Abre el HTML en el navegador
  shell.openPath(htmlPath)

  return { htmlPath, csvPath }
})

ipcMain.on('quit-app', () => app.exit(0))
