import { zipSync, strToU8 } from 'fflate'
import {
  decodeBuf,
  encodeComponents,
  generateSchematicCode,
  parsePly,
  plyToBuf,
  plyToComponents,
  type ComponentSpec,
  type ConvertOptions,
  type MeshType,
  type StorageType,
} from '../src/index'

const drop = document.querySelector('#drop') as HTMLElement
const fileInput = document.querySelector('#file') as HTMLInputElement
const browse = document.querySelector('#browse') as HTMLButtonElement
const fileName = document.querySelector('#fileName') as HTMLElement
const panel = document.querySelector('#panel') as HTMLElement
const rows = document.querySelector('#rows') as HTMLTableSectionElement
const exportBtn = document.querySelector('#export') as HTMLButtonElement
const schematicBtn = document.querySelector('#schematic') as HTMLButtonElement
const meshTypeEl = document.querySelector('#meshType') as HTMLSelectElement
const presetEl = document.querySelector('#preset') as HTMLSelectElement
const sortEl = document.querySelector('#sort') as HTMLInputElement
const logEl = document.querySelector('#log') as HTMLElement

type Loaded = {
  name: string
  ply: ArrayBuffer
  components: ComponentSpec[]
  meshTypeHint: MeshType
  sceneData?: unknown
}

let files: Loaded[] = []
let active = 0

function log(msg: string) {
  logEl.textContent = msg
}

function optsBase(): ConvertOptions {
  return {
    preset: presetEl.value as 'lusion' | 'everswap',
    sortByByteSize: sortEl.checked,
  }
}

function renderRows(components: ComponentSpec[]) {
  rows.innerHTML = ''
  for (const c of components) {
    if (c.saveToId === 'indices') continue
    const tr = document.createElement('tr')
    tr.dataset.source = c.sourceId
    tr.innerHTML = `
      <td><input type="checkbox" data-k="needsSave" ${c.needsSave ? 'checked' : ''} /></td>
      <td><code>${c.sourceId}</code></td>
      <td><input type="text" data-k="saveToId" value="${c.saveToId}" /></td>
      <td><input type="number" data-k="saveToIndex" value="${c.saveToIndex}" min="0" max="3" /></td>
      <td><input type="checkbox" data-k="needsPack" ${c.needsPack ? 'checked' : ''} /></td>
      <td>
        <select data-k="storageType">
          ${(['Float32Array','Int8Array','Uint8Array','Int16Array','Uint16Array','Int32Array','Uint32Array'] as StorageType[])
            .map((t) => `<option value="${t}" ${t === c.storageType ? 'selected' : ''}>${t.replace('Array','')}</option>`)
            .join('')}
        </select>
      </td>
      <td><input type="number" data-k="packFrom" step="any" placeholder="auto" ${c.packFrom !== undefined ? `value="${c.packFrom}"` : ''} /></td>
      <td><input type="number" data-k="packTo" step="any" placeholder="auto" ${c.packTo !== undefined ? `value="${c.packTo}"` : ''} /></td>
    `
    rows.appendChild(tr)
  }
}

function readRowsInto(components: ComponentSpec[]) {
  const bySource = new Map(components.map((c) => [c.sourceId, c]))
  for (const tr of rows.querySelectorAll('tr')) {
    const source = tr.dataset.source!
    const c = bySource.get(source)
    if (!c) continue
    const save = tr.querySelector('[data-k="needsSave"]') as HTMLInputElement
    const id = tr.querySelector('[data-k="saveToId"]') as HTMLInputElement
    const idx = tr.querySelector('[data-k="saveToIndex"]') as HTMLInputElement
    const pack = tr.querySelector('[data-k="needsPack"]') as HTMLInputElement
    const storage = tr.querySelector('[data-k="storageType"]') as HTMLSelectElement
    const from = tr.querySelector('[data-k="packFrom"]') as HTMLInputElement
    const to = tr.querySelector('[data-k="packTo"]') as HTMLInputElement
    c.needsSave = save.checked
    c.saveToId = id.value.trim() || c.sourceId
    c.saveToIndex = parseInt(idx.value, 10) || 0
    c.needsPack = pack.checked
    c.storageType = storage.value as StorageType
    c.packFrom = from.value === '' ? undefined : Number(from.value)
    c.packTo = to.value === '' ? undefined : Number(to.value)
    if (c.storageType === 'Float32Array') c.needsPack = false
  }
}

async function loadList(list: FileList | File[]) {
  const arr = [...list].filter((f) => f.name.toLowerCase().endsWith('.ply'))
  if (!arr.length) return
  files = []
  for (const file of arr) {
    const ply = await file.arrayBuffer()
    const mesh = parsePly(ply)
    const components = plyToComponents(mesh, optsBase())
    files.push({
      name: file.name.replace(/\.ply$/i, ''),
      ply,
      components,
      meshTypeHint: mesh.meshTypeHint,
      sceneData: mesh.sceneData,
    })
  }
  active = 0
  fileName.textContent = files.map((f) => f.name + '.ply').join(', ')
  panel.hidden = false
  renderRows(files[0]!.components)
  log(`Loaded ${files.length} file(s). Editing: ${files[0]!.name}.ply`)
}

function currentMeshType(hint: MeshType): MeshType | undefined {
  const v = meshTypeEl.value
  if (v === 'auto') return undefined
  return v as MeshType
}

function encodeOne(item: Loaded): ArrayBuffer {
  readRowsInto(item.components)
  // For multi-file, only first file's UI rows apply to first; others use their auto components
  return encodeComponents(item.components, {
    ...optsBase(),
    meshType: currentMeshType(item.meshTypeHint),
    meshTypeHint: item.meshTypeHint,
    sceneData: item.sceneData,
    indexCount: item.components.find((c) => c.saveToId === 'indices')?.data.length ?? 0,
  })
}

function download(name: string, data: Uint8Array, mime: string) {
  const blob = new Blob([data], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

browse.addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', () => {
  if (fileInput.files) void loadList(fileInput.files)
})
;['dragenter', 'dragover'].forEach((ev) => {
  drop.addEventListener(ev, (e) => {
    e.preventDefault()
    drop.classList.add('drag')
  })
})
;['dragleave', 'drop'].forEach((ev) => {
  drop.addEventListener(ev, (e) => {
    e.preventDefault()
    drop.classList.remove('drag')
  })
})
drop.addEventListener('drop', (e) => {
  const list = e.dataTransfer?.files
  if (list) void loadList(list)
})

presetEl.addEventListener('change', () => {
  if (!files[active]) return
  const mesh = parsePly(files[active]!.ply)
  files[active]!.components = plyToComponents(mesh, optsBase())
  renderRows(files[active]!.components)
})

exportBtn.addEventListener('click', () => {
  if (!files.length) return
  if (files.length === 1) {
    const out = encodeOne(files[0]!)
    const { meta } = decodeBuf(out, 'everswap')
    download(`${files[0]!.name}.buf`, new Uint8Array(out), 'application/octet-stream')
    log(
      [
        `Exported ${files[0]!.name}.buf (${out.byteLength.toLocaleString()} bytes)`,
        `${meta.meshType} v=${meta.vertexCount} i=${meta.indexCount}`,
        ...meta.attributes.map(
          (a) => `  ${a.id}: ${a.storageType}${a.needsPack ? ' packed' : ''}`,
        ),
      ].join('\n'),
    )
    return
  }

  // Multi-file: first uses UI overrides; others re-parse with preset
  const zipped: Record<string, Uint8Array> = {}
  for (let i = 0; i < files.length; i++) {
    const item = files[i]!
    if (i === 0) readRowsInto(item.components)
    else {
      const mesh = parsePly(item.ply)
      item.components = plyToComponents(mesh, optsBase())
    }
    const out = encodeComponents(item.components, {
      ...optsBase(),
      meshType: currentMeshType(item.meshTypeHint),
      meshTypeHint: item.meshTypeHint,
      sceneData: item.sceneData,
      indexCount: item.components.find((c) => c.saveToId === 'indices')?.data.length ?? 0,
    })
    zipped[`${item.name}.buf`] = new Uint8Array(out)
  }
  const z = zipSync(zipped, { level: 5 })
  download('all.zip', z, 'application/zip')
  log(`Exported all.zip (${files.length} buffers)`)
})

schematicBtn.addEventListener('click', async () => {
  if (!files[0]) return
  const out = encodeOne(files[0])
  const { meta } = decodeBuf(out, 'schematic')
  const code = generateSchematicCode(meta, {
    includeSceneScript: true,
    unpackMode: 'schematic',
  })
  await navigator.clipboard.writeText(code)
  log('Schematic loader copied to clipboard (size-1 unpack, Lusion style).')
})

void plyToBuf
void strToU8
