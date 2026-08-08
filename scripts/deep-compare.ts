/**
 * Deep comparison: our encoder vs a Lusion-oracle encoder (logic copied from
 * ply2buf.lusion.co reference bundle export path).
 *
 * Also optionally hits the live site via Playwright if installed.
 *
 *   npx tsx scripts/deep-compare.ts
 *   npx tsx scripts/deep-compare.ts --live   # needs: npx playwright install chromium
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  decodeBuf,
  encodeComponents,
  plyToBuf,
  parsePly,
  plyToComponents,
  type ComponentSpec,
  type StorageType,
  type MeshType,
} from '../src/index'

const OUT = resolve(import.meta.dirname, '../tmp/deep-compare')
mkdirSync(OUT, { recursive: true })
const MODELS =
  process.env.EVERSWAP_MODELS ??
  '/Users/nemo/Documents/personal/everswap-clone/public/models/scene1'
const LIVE = process.argv.includes('--live')

const STORAGE: Record<
  StorageType,
  { bytes: number; from: number; to: number; Ctor: any }
> = {
  Int8Array: { bytes: 1, from: -128, to: 127, Ctor: Int8Array },
  Uint8Array: { bytes: 1, from: 0, to: 255, Ctor: Uint8Array },
  Int16Array: { bytes: 2, from: -32768, to: 32767, Ctor: Int16Array },
  Uint16Array: { bytes: 2, from: 0, to: 65535, Ctor: Uint16Array },
  Int32Array: { bytes: 4, from: -2147483648, to: 2147483647, Ctor: Int32Array },
  Uint32Array: { bytes: 4, from: 0, to: 4294967295, Ctor: Uint32Array },
  Float32Array: { bytes: 4, from: 0, to: 1, Ctor: Float32Array },
}

function mix(a: number, b: number, t: number) {
  return a + (b - a) * t
}

/** Exact Lusion `_sortHighToLowByteSize` from their bundle. */
function lusionSort(
  a: { byteSize: number; id: string },
  b: { byteSize: number; id: string },
) {
  return a.byteSize === b.byteSize
    ? b.id > a.id
      ? -1
      : 1
    : b.byteSize > a.byteSize
      ? 1
      : -1
}

/**
 * Oracle encoder — mirrors ply2buf `_exportBinary` + schematic JSON build.
 * Source: tools/.../reference/index.js (Lusion hosted tool).
 */
function lusionOracleEncode(
  components: ComponentSpec[],
  opts: { meshType: MeshType; sceneData?: unknown },
): ArrayBuffer {
  // group by saveToId, sort components by saveToIndex
  const groups = new Map<string, ComponentSpec[]>()
  for (const c of components) {
    if (!c.needsSave) continue
    const list = groups.get(c.saveToId) ?? []
    list.push(c)
    groups.set(c.saveToId, list)
  }
  for (const list of groups.values()) list.sort((a, b) => a.saveToIndex - b.saveToIndex)

  type Attr = {
    id: string
    storageType: StorageType
    needsPack: boolean
    componentSize: number
    dataLength: number
    byteSize: number
    components: { data: Float32Array; packFrom: number; packDelta: number }[]
  }

  const attrs: Attr[] = []
  let vertexCount = 0
  let indexCount = 0

  for (const [id, comps] of groups) {
    const first = comps[0]!
    const info = STORAGE[first.storageType]
    let needsPack = first.needsPack
    if (info.bytes === 4) needsPack = false

    const dataLength = first.data.length
    if (id === 'indices') indexCount = dataLength
    else vertexCount = dataLength

    const built = comps.map((c) => {
      let packFrom = c.packFrom
      let packTo = c.packTo
      if (needsPack && (packFrom === undefined || packTo === undefined)) {
        let min = Infinity,
          max = -Infinity
        for (let i = 0; i < c.data.length; i++) {
          min = Math.min(min, c.data[i]!)
          max = Math.max(max, c.data[i]!)
        }
        packFrom = packFrom ?? min
        packTo = packTo ?? max
      }
      const packDelta = needsPack ? Math.max((packTo ?? 0) - (packFrom ?? 0), 0) : 0
      return {
        data: c.data,
        packFrom: packFrom ?? 0,
        packDelta,
      }
    })

    attrs.push({
      id,
      storageType: first.storageType,
      needsPack,
      componentSize: comps.length,
      dataLength,
      byteSize: info.bytes,
      components: built,
    })
  }

  attrs.sort(lusionSort)

  const meta: Record<string, unknown> = {
    vertexCount,
    indexCount,
    meshType: opts.meshType,
    attributes: attrs.map((a) => {
      const m: Record<string, unknown> = {
        id: a.id,
        needsPack: a.needsPack,
        componentSize: a.componentSize,
        storageType: a.storageType,
      }
      if (a.needsPack) {
        m.packedComponents = a.components.map((c) => ({
          from: c.packFrom,
          delta: c.packDelta,
        }))
      }
      return m
    }),
  }
  if (opts.sceneData !== undefined) meta.sceneData = opts.sceneData

  // NOTE: Lusion's online tool does NOT always write bbox; our tool does.
  // For byte compare of payloads we compare attribute blobs separately.

  let json = JSON.stringify(meta)
  const pad = (4 - (json.length % 4)) % 4
  json += ' '.repeat(pad) // Lusion: c+="   ".substr(0,h) — same as spaces

  const jsonBytes = new Uint8Array(json.length)
  for (let i = 0; i < json.length; i++) jsonBytes[i] = json.charCodeAt(i) & 0xff

  const chunks: Uint8Array[] = []
  const header = new Uint8Array(4)
  new DataView(header.buffer).setUint32(0, json.length, true)
  chunks.push(header)
  chunks.push(jsonBytes)

  for (const a of attrs) {
    const info = STORAGE[a.storageType]
    const out = new info.Ctor(a.dataLength * a.componentSize)
    let h = 0
    for (let s = 0; s < a.dataLength; s++) {
      for (let u = 0; u < a.componentSize; u++) {
        const c = a.components[u]!
        let v = c.data[s]!
        if (a.needsPack) {
          v = c.packDelta > 0 ? (v - c.packFrom) / c.packDelta : 0
          out[h] = mix(info.from, info.to, v) // TypedArray truncate — Lusion exact
        } else {
          out[h] = v
        }
        h++
      }
    }
    chunks.push(new Uint8Array(out.buffer, out.byteOffset, out.byteLength))
  }

  let total = 0
  for (const c of chunks) total += c.byteLength
  const buf = new ArrayBuffer(total)
  const view = new Uint8Array(buf)
  let o = 0
  for (const c of chunks) {
    view.set(c, o)
    o += c.byteLength
  }
  return buf
}

function splitBuf(buffer: ArrayBuffer) {
  const headerLen = new Uint32Array(buffer, 0, 1)[0]!
  const meta = JSON.parse(
    String.fromCharCode(...new Uint8Array(buffer, 4, headerLen)),
  ) as {
    attributes: {
      id: string
      storageType: StorageType
      componentSize: number
      needsPack: boolean
    }[]
    vertexCount: number
    indexCount: number
  }
  let offset = 4 + headerLen
  const payloads: Record<string, Uint8Array> = {}
  for (const a of meta.attributes) {
    const count = a.id === 'indices' ? meta.indexCount : meta.vertexCount
    const bytes = STORAGE[a.storageType].bytes * count * a.componentSize
    payloads[a.id] = new Uint8Array(buffer, offset, bytes).slice()
    offset += bytes
  }
  return { meta, payloads, headerLen, json: String.fromCharCode(...new Uint8Array(buffer, 4, headerLen)) }
}

function bytesEqual(a: Uint8Array, b: Uint8Array) {
  if (a.byteLength !== b.byteLength) return { ok: false, diffAt: -1, lenA: a.byteLength, lenB: b.byteLength }
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return { ok: false, diffAt: i, lenA: a.byteLength, lenB: b.byteLength }
  }
  return { ok: true, diffAt: -1, lenA: a.byteLength, lenB: b.byteLength }
}

function ab(buf: Buffer) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

function makeSyntheticComponents(): ComponentSpec[] {
  const n = 64
  const x = new Float32Array(n)
  const y = new Float32Array(n)
  const z = new Float32Array(n)
  const nx = new Float32Array(n)
  const ny = new Float32Array(n)
  const nz = new Float32Array(n)
  const u = new Float32Array(n)
  const v = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    x[i] = Math.sin(i * 0.2) * 10
    y[i] = Math.cos(i * 0.15) * 5
    z[i] = i * 0.1 - 3
    nx[i] = Math.sin(i)
    ny[i] = Math.cos(i)
    nz[i] = 0.1
    u[i] = (i % 8) / 7
    v[i] = Math.floor(i / 8) / 7
  }
  const idx = new Float32Array(60)
  for (let i = 0; i < 20; i++) {
    idx[i * 3] = i % n
    idx[i * 3 + 1] = (i + 1) % n
    idx[i * 3 + 2] = (i + 2) % n
  }
  const mk = (
    sourceId: string,
    data: Float32Array,
    saveToId: string,
    saveToIndex: number,
    storageType: StorageType,
    needsPack: boolean,
  ): ComponentSpec => ({
    sourceId,
    data,
    saveToId,
    saveToIndex,
    needsSave: true,
    storageType,
    needsPack,
  })
  return [
    mk('x', x, 'position', 0, 'Int16Array', true),
    mk('y', y, 'position', 1, 'Int16Array', true),
    mk('z', z, 'position', 2, 'Int16Array', true),
    mk('nx', nx, 'normal', 0, 'Int8Array', true),
    mk('ny', ny, 'normal', 1, 'Int8Array', true),
    mk('nz', nz, 'normal', 2, 'Int8Array', true),
    mk('s', u, 'uv', 0, 'Int16Array', true),
    mk('t', v, 'uv', 1, 'Int16Array', true),
    mk('indices', idx, 'indices', 0, 'Uint16Array', false),
  ]
}

type CaseResult = {
  name: string
  payloadMatch: boolean
  attrResults: { id: string; ok: boolean; detail: string }[]
  ourBytes: number
  oracleBytes: number
}

function compareOursVsOracle(
  name: string,
  components: ComponentSpec[],
  meshType: MeshType,
): CaseResult {
  // Strip bbox from our encode by comparing payloads only
  const ours = encodeComponents(components, {
    meshType,
    sortByByteSize: true,
    packStyle: 'lusion',
  })
  const oracle = lusionOracleEncode(components, { meshType })

  const A = splitBuf(ours)
  const B = splitBuf(oracle)

  // Compare attribute order
  const orderA = A.meta.attributes.map((a) => a.id).join(',')
  const orderB = B.meta.attributes.map((a) => a.id).join(',')

  const attrResults: CaseResult['attrResults'] = []
  let payloadMatch = orderA === orderB

  if (orderA !== orderB) {
    attrResults.push({
      id: '_order',
      ok: false,
      detail: `order ours=${orderA} oracle=${orderB}`,
    })
  }

  for (const id of Object.keys(B.payloads)) {
    const eq = bytesEqual(A.payloads[id]!, B.payloads[id]!)
    attrResults.push({
      id,
      ok: eq.ok,
      detail: eq.ok
        ? `identical ${eq.lenA} bytes`
        : `DIFF at ${eq.diffAt} (len ${eq.lenA} vs ${eq.lenB})`,
    })
    if (!eq.ok) payloadMatch = false
  }

  // Meta fields that matter (ignore bbox ours-only)
  for (const a of B.meta.attributes) {
    const oa = A.meta.attributes.find((x) => x.id === a.id)
    if (!oa) {
      attrResults.push({ id: a.id + ':meta', ok: false, detail: 'missing in ours' })
      payloadMatch = false
      continue
    }
    const same =
      oa.storageType === a.storageType &&
      oa.needsPack === a.needsPack &&
      oa.componentSize === a.componentSize
    if (!same) {
      attrResults.push({
        id: a.id + ':meta',
        ok: false,
        detail: `meta mismatch ours=${JSON.stringify(oa)} oracle=${JSON.stringify(a)}`,
      })
      payloadMatch = false
    }
  }

  return {
    name,
    payloadMatch,
    attrResults,
    ourBytes: ours.byteLength,
    oracleBytes: oracle.byteLength,
  }
}

async function liveSiteCompare(plyPath: string) {
  // Dynamic import playwright
  let playwright: typeof import('playwright')
  try {
    playwright = await import('playwright')
  } catch {
    return { ok: false, reason: 'playwright not installed' as string }
  }

  const { chromium } = playwright
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const downloadPromise = page.waitForEvent('download', { timeout: 60000 }).catch(() => null)

  try {
    await page.goto('https://ply2buf.lusion.co/', { waitUntil: 'networkidle', timeout: 60000 })
    // The tool uses drag-drop; try file input if any, else use CDP Page.setInputFiles via locator
    const input = await page.$('input[type=file]')
    if (input) {
      await input.setInputFiles(plyPath)
    } else {
      // synthesize drop via DataTransfer in page — harder; use page.evaluate with file read
      // Fallback: skip
      await browser.close()
      return { ok: false, reason: 'no file input on page (drop-only UI)' }
    }

    // Wait a bit for parse, click Export
    await page.waitForTimeout(1500)
    const exportBtn = page.getByText('Export', { exact: true }).first()
    await exportBtn.click()
    const download = await downloadPromise
    if (!download) {
      await browser.close()
      return { ok: false, reason: 'no download after Export' }
    }
    const livePath = resolve(OUT, 'live-from-lusion.buf')
    await download.saveAs(livePath)
    await browser.close()

    // Local convert with lusion preset
    const ply = ab(readFileSync(plyPath))
    const local = plyToBuf(ply, { preset: 'lusion' })
    writeFileSync(resolve(OUT, 'local-lusion-preset.buf'), Buffer.from(local))

    const live = ab(readFileSync(livePath))
    const L = splitBuf(live)
    const O = splitBuf(local)

    const attrCmp: Record<string, boolean> = {}
    for (const id of Object.keys(L.payloads)) {
      attrCmp[id] = bytesEqual(L.payloads[id]!, O.payloads[id] ?? new Uint8Array()).ok
    }
    return {
      ok: Object.values(attrCmp).every(Boolean) &&
        L.meta.attributes.map((a) => a.id).join() === O.meta.attributes.map((a) => a.id).join(),
      liveMeta: L.meta,
      localMeta: O.meta,
      attrCmp,
      liveBytes: live.byteLength,
      localBytes: local.byteLength,
    }
  } catch (e) {
    await browser.close().catch(() => {})
    return { ok: false, reason: String(e) }
  }
}

async function main() {
  const lines: string[] = []
  const p = (s = '') => lines.push(s)

  p('# Deep compare: ours vs Lusion oracle')
  p(`Generated: ${new Date().toISOString()}`)
  p('')
  p('Oracle = encode loop copied from `ply2buf.lusion.co` reference `index.js` (`_exportBinary` / `math.mix`).')
  p('')

  // --- A: synthetic Lusion defaults ---
  p('## A. Synthetic mesh (Lusion-style Int16 position / Int8 normal)')
  const syn = makeSyntheticComponents()
  const caseA = compareOursVsOracle('synthetic-lusion', syn, 'Mesh')
  p(`Payload byte-identical: **${caseA.payloadMatch ? 'YES' : 'NO'}**`)
  p(`Size ours=${caseA.ourBytes} oracle=${caseA.oracleBytes} (JSON may differ if we add bbox)`)
  for (const a of caseA.attrResults) {
    p(`- ${a.ok ? 'OK' : 'FAIL'} ${a.id}: ${a.detail}`)
  }
  p('')

  // --- B: same synthetic but EverSwap-style storages ---
  p('## B. Synthetic mesh (EverSwap-style Float32 position / Uint16 normal)')
  const synE = makeSyntheticComponents().map((c) => {
    if (c.saveToId === 'position')
      return { ...c, storageType: 'Float32Array' as const, needsPack: false }
    if (c.saveToId === 'normal')
      return { ...c, storageType: 'Uint16Array' as const, needsPack: true }
    return c
  })
  const caseB = compareOursVsOracle('synthetic-everswap', synE, 'Mesh')
  p(`Payload byte-identical: **${caseB.payloadMatch ? 'YES' : 'NO'}**`)
  for (const a of caseB.attrResults) {
    p(`- ${a.ok ? 'OK' : 'FAIL'} ${a.id}: ${a.detail}`)
  }
  p('')

  // --- C: production files → decode → re-encode ours vs oracle ---
  p('## C. EverSwap production files → decode → ours vs oracle re-encode')
  p('Same floats + same pack ranges + same storage → attribute payloads must match byte-for-byte.')
  p('')
  const files = readdirSync(MODELS).filter((f) => f.endsWith('.buf')).sort()
  let cPass = 0
  for (const f of files) {
    const src = ab(readFileSync(resolve(MODELS, f)))
    const { meta, attributes } = decodeBuf(src, 'everswap')
    const comps: ComponentSpec[] = []
    for (const m of meta.attributes) {
      const data = attributes[m.id]!
      const count = m.id === 'indices' ? meta.indexCount : meta.vertexCount
      for (let c = 0; c < m.componentSize; c++) {
        const col = new Float32Array(count)
        for (let i = 0; i < count; i++) col[i] = data[i * m.componentSize + c]!
        const pack = m.packedComponents?.[c]
        comps.push({
          sourceId: `${m.id}_${c}`,
          data: col,
          saveToId: m.id,
          saveToIndex: c,
          needsSave: true,
          storageType: m.storageType,
          needsPack: m.needsPack,
          packFrom: pack?.from,
          packTo: pack ? pack.from + pack.delta : undefined,
        })
      }
    }
    const r = compareOursVsOracle(f, comps, meta.meshType)
    if (r.payloadMatch) cPass++
    p(`### ${f}: ${r.payloadMatch ? 'PASS' : 'FAIL'}`)
    for (const a of r.attrResults.filter((x) => !x.ok)) {
      p(`- ${a.id}: ${a.detail}`)
    }
    if (r.payloadMatch) p('- all attribute payloads identical to Lusion oracle')
    p('')
  }
  p(`Production re-encode match: **${cPass}/${files.length}**`)
  p('')

  // --- D: fixture PLY through our presets ---
  p('## D. Fixture PLY presets (sanity)')
  const ply = ab(readFileSync(resolve(import.meta.dirname, '../test/fixtures/triangle.ply')))
  for (const preset of ['lusion', 'everswap'] as const) {
    const mesh = parsePly(ply)
    const comps = plyToComponents(mesh, { preset })
    const r = compareOursVsOracle(`triangle-${preset}`, comps, mesh.meshTypeHint)
    p(`- ${preset}: ${r.payloadMatch ? 'PASS' : 'FAIL'} vs oracle`)
  }
  p('')

  // --- E: live site (optional) ---
  p('## E. Live ply2buf.lusion.co (optional)')
  if (LIVE) {
    const plyPath = resolve(import.meta.dirname, '../test/fixtures/triangle.ply')
    const live = await liveSiteCompare(plyPath)
    p('```json')
    p(JSON.stringify(live, null, 2))
    p('```')
  } else {
    p('_Skipped. Run with `--live` after `npm i -D playwright && npx playwright install chromium`._')
  }
  p('')

  // Verdict
  const allSynthetic = caseA.payloadMatch && caseB.payloadMatch
  p('## Verdict')
  p(`| Check | Result |`)
  p(`| --- | --- |`)
  p(`| Ours vs Lusion-oracle (synthetic Lusion defaults) | ${caseA.payloadMatch ? 'PASS — byte identical payloads' : 'FAIL'} |`)
  p(`| Ours vs Lusion-oracle (synthetic EverSwap style) | ${caseB.payloadMatch ? 'PASS — byte identical payloads' : 'FAIL'} |`)
  p(`| Ours vs Lusion-oracle (11 production re-encodes) | ${cPass}/${files.length} PASS |`)
  p('')
  p(
    allSynthetic && cPass === files.length
      ? '**Conclusion: for the same inputs, our `.buf` attribute binaries match Lusion’s encoder exactly.** JSON may include extra bbox fields ours adds; that does not affect mesh data.'
      : '**Conclusion: differences found — see FAIL details above.**',
  )

  const text = lines.join('\n')
  writeFileSync(resolve(OUT, 'DEEP_COMPARE.md'), text)
  console.log(text)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
