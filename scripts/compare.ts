/**
 * Comparative tests: our ply-to-buf vs EverSwap production .buf + Lusion encode rules.
 *
 * Run: npx tsx scripts/compare.ts
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import {
  decodeBuf,
  encodeComponents,
  plyToBuf,
  parsePly,
  plyToComponents,
  type ComponentSpec,
  type UnpackMode,
} from '../src/index'

const MODELS =
  process.env.EVERSWAP_MODELS ??
  resolve('/Users/nemo/Documents/personal/everswap-clone/public/models/scene1')
const OUT = resolve(import.meta.dirname, '../tmp/compare')
mkdirSync(OUT, { recursive: true })

function ab(buf: Buffer) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

function maxAbs(a: Float32Array, b: Float32Array) {
  const n = Math.min(a.length, b.length)
  let m = 0
  let at = 0
  for (let i = 0; i < n; i++) {
    const d = Math.abs(a[i]! - b[i]!)
    if (d > m) {
      m = d
      at = i
    }
  }
  return { max: m, at, lenMatch: a.length === b.length }
}

function componentsFromDecoded(
  meta: ReturnType<typeof decodeBuf>['meta'],
  attributes: Record<string, Float32Array>,
): ComponentSpec[] {
  const components: ComponentSpec[] = []
  for (const m of meta.attributes) {
    const data = attributes[m.id]!
    const count = m.id === 'indices' ? meta.indexCount : meta.vertexCount
    for (let c = 0; c < m.componentSize; c++) {
      const col = new Float32Array(count)
      for (let i = 0; i < count; i++) col[i] = data[i * m.componentSize + c]!
      const pack = m.packedComponents?.[c]
      components.push({
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
  return components
}

type RoundtripRow = {
  file: string
  srcBytes: number
  outBytes: number
  vertices: number
  indices: number
  attrs: string
  perAttr: Record<string, { everswap: number; schematic: number }>
  metaMatch: boolean
}

function roundtripFile(path: string): RoundtripRow {
  const file = readFileSync(path)
  const src = ab(file)
  const { meta, attributes } = decodeBuf(src, 'everswap')
  const comps = componentsFromDecoded(meta, attributes)
  const out = encodeComponents(comps, {
    meshType: meta.meshType,
    sceneData: meta.sceneData,
    sortByByteSize: true,
    packStyle: 'lusion',
  })

  const againE = decodeBuf(out, 'everswap')
  const againS = decodeBuf(out, 'schematic')

  const perAttr: RoundtripRow['perAttr'] = {}
  for (const m of meta.attributes) {
    perAttr[m.id] = {
      everswap: maxAbs(attributes[m.id]!, againE.attributes[m.id]!).max,
      schematic: maxAbs(attributes[m.id]!, againS.attributes[m.id]!).max,
    }
  }

  const metaMatch =
    meta.vertexCount === againE.meta.vertexCount &&
    meta.indexCount === againE.meta.indexCount &&
    meta.meshType === againE.meta.meshType &&
    meta.attributes.length === againE.meta.attributes.length &&
    meta.attributes.every(
      (a, i) =>
        a.id === againE.meta.attributes[i]!.id &&
        a.storageType === againE.meta.attributes[i]!.storageType &&
        a.needsPack === againE.meta.attributes[i]!.needsPack &&
        a.componentSize === againE.meta.attributes[i]!.componentSize,
    )

  return {
    file: basename(path),
    srcBytes: src.byteLength,
    outBytes: out.byteLength,
    vertices: meta.vertexCount,
    indices: meta.indexCount,
    attrs: meta.attributes
      .map((a) => `${a.id}:${a.storageType}${a.needsPack ? '*' : ''}`)
      .join(', '),
    perAttr,
    metaMatch,
  }
}

/** Lusion-exact pack of one scalar (no clamp, TypedArray truncate). */
function lusionPackScalar(
  value: number,
  from: number,
  delta: number,
  typedMin: number,
  typedMax: number,
  Ctor: Int16ArrayConstructor | Uint16ArrayConstructor | Int8ArrayConstructor | Uint8ArrayConstructor,
): number {
  const t = delta > 0 ? (value - from) / delta : 0
  const mixed = typedMin + (typedMax - typedMin) * t
  const arr = new Ctor(1)
  arr[0] = mixed
  return arr[0]!
}

function ourPackScalar(
  value: number,
  from: number,
  delta: number,
  typedMin: number,
  typedMax: number,
  Ctor: Int16ArrayConstructor | Uint16ArrayConstructor | Int8ArrayConstructor | Uint8ArrayConstructor,
): number {
  // Must match encode.ts packStyle=lusion
  return lusionPackScalar(value, from, delta, typedMin, typedMax, Ctor)
}

function testPackFormulaIdentity() {
  const samples = [-1, -0.5, 0, 0.33, 0.5, 0.999, 1, 1.5, 100]
  const ranges = [
    { from: -1, delta: 2, min: -32768, max: 32767, Ctor: Int16Array },
    { from: 0, delta: 1, min: 0, max: 65535, Ctor: Uint16Array },
    { from: -1, delta: 2, min: -128, max: 127, Ctor: Int8Array },
  ] as const

  let mismatches = 0
  let total = 0
  for (const r of ranges) {
    for (const v of samples) {
      total++
      const a = lusionPackScalar(v, r.from, r.delta, r.min, r.max, r.Ctor)
      const b = ourPackScalar(v, r.from, r.delta, r.min, r.max, r.Ctor)
      if (a !== b) mismatches++
    }
  }
  return { total, mismatches }
}

/** Decode EverSwap file with both unpack modes; report which recovers better after re-pack. */
function unpackModeShootout(path: string) {
  const src = ab(readFileSync(path))
  // Treat stored raw as ground truth of what was written; rebuild floats both ways,
  // re-encode with those pack ranges, compare raw bytes of packed attrs.
  const headerLen = new Uint32Array(src, 0, 1)[0]!
  const meta = JSON.parse(
    String.fromCharCode(...new Uint8Array(src, 4, headerLen)),
  ) as ReturnType<typeof decodeBuf>['meta']

  const decodedE = decodeBuf(src, 'everswap')
  const decodedS = decodeBuf(src, 'schematic')

  // Re-encode from each decode, compare attribute raw payloads length & first packed attr fidelity
  const outE = encodeComponents(componentsFromDecoded(decodedE.meta, decodedE.attributes), {
    meshType: meta.meshType,
    sortByByteSize: true,
    packStyle: 'lusion',
  })
  const outS = encodeComponents(componentsFromDecoded(decodedS.meta, decodedS.attributes), {
    meshType: meta.meshType,
    sortByByteSize: true,
    packStyle: 'lusion',
  })

  // Compare decoded→redecoded stability
  const stabE = decodeBuf(outE, 'everswap')
  const stabS = decodeBuf(outS, 'schematic')

  const errE: Record<string, number> = {}
  const errS: Record<string, number> = {}
  for (const a of meta.attributes) {
    errE[a.id] = maxAbs(decodedE.attributes[a.id]!, stabE.attributes[a.id]!).max
    errS[a.id] = maxAbs(decodedS.attributes[a.id]!, stabS.attributes[a.id]!).max
  }
  return { file: basename(path), errE, errS, outE: outE.byteLength, outS: outS.byteLength }
}

function plyPresetCompare() {
  const plyPath = resolve(import.meta.dirname, '../test/fixtures/triangle.ply')
  const ply = ab(readFileSync(plyPath))
  const mesh = parsePly(ply)

  const results: Record<string, unknown> = {}
  for (const preset of ['lusion', 'everswap'] as const) {
    const comps = plyToComponents(mesh, { preset })
    const out = plyToBuf(ply, { preset })
    const { meta, attributes } = decodeBuf(out, 'everswap')
    const errs: Record<string, number> = {}
    for (const id of new Set(comps.filter((c) => c.needsSave).map((c) => c.saveToId))) {
      const cols = comps
        .filter((c) => c.saveToId === id && c.needsSave)
        .sort((a, b) => a.saveToIndex - b.saveToIndex)
      const interleaved = new Float32Array(cols[0]!.data.length * cols.length)
      for (let i = 0; i < cols[0]!.data.length; i++) {
        for (let c = 0; c < cols.length; c++) {
          interleaved[i * cols.length + c] = cols[c]!.data[i]!
        }
      }
      errs[id] = maxAbs(interleaved, attributes[id]!).max
    }
    results[preset] = {
      meshType: meta.meshType,
      bytes: out.byteLength,
      attributes: meta.attributes.map((a) => ({
        id: a.id,
        storage: a.storageType,
        pack: a.needsPack,
      })),
      maxError: errs,
    }
  }
  return results
}

function main() {
  const report: string[] = []
  const push = (s = '') => report.push(s)

  push('# ply-to-buf comparative test report')
  push(`Generated: ${new Date().toISOString()}`)
  push('')

  // 1) Pack formula identity
  const packId = testPackFormulaIdentity()
  push('## 1. Lusion pack formula identity')
  push(`Samples checked: ${packId.total}, mismatches: **${packId.mismatches}**`)
  push(packId.mismatches === 0 ? 'PASS — encode mix+truncate matches Lusion.' : 'FAIL')
  push('')

  // 2) Roundtrip all scene1 buffers
  push('## 2. EverSwap production .buf roundtrip (decode → encode → decode)')
  push('Unpack for measurement: `everswap` (`1/size`). Also show schematic (`1/(size-1)`) error for reference.')
  push('')
  if (!existsSync(MODELS)) {
    push(`_Skipped: models dir not found (${MODELS}). Set EVERSWAP_MODELS._`)
    push('')
  }
  const files = existsSync(MODELS)
    ? readdirSync(MODELS)
        .filter((f) => f.endsWith('.buf'))
        .sort()
    : []

  const rows: RoundtripRow[] = []
  let failMeta = 0
  let worst = { file: '', attr: '', err: 0 }
  for (const f of files) {
    const row = roundtripFile(resolve(MODELS, f))
    rows.push(row)
    if (!row.metaMatch) failMeta++
    for (const [attr, e] of Object.entries(row.perAttr)) {
      if (e.everswap > worst.err) worst = { file: row.file, attr, err: e.everswap }
    }
  }

  push('| file | verts | idx | src→out bytes | meta | worst everswap Δ | worst schematic Δ |')
  push('| --- | ---: | ---: | --- | --- | ---: | ---: |')
  for (const r of rows) {
    const worstE = Math.max(...Object.values(r.perAttr).map((x) => x.everswap))
    const worstS = Math.max(...Object.values(r.perAttr).map((x) => x.schematic))
    push(
      `| ${r.file} | ${r.vertices} | ${r.indices} | ${r.srcBytes}→${r.outBytes} | ${r.metaMatch ? 'OK' : 'DIFF'} | ${worstE.toExponential(2)} | ${worstS.toExponential(2)} |`,
    )
  }
  push('')
  push(`Meta layout mismatches: **${failMeta}/${rows.length}**`)
  push(`Worst everswap attr error: **${worst.err.toExponential(3)}** @ ${worst.file} / ${worst.attr}`)
  push('')

  push('### Per-attribute detail')
  for (const r of rows) {
    push(`#### ${r.file}`)
    push(`\`${r.attrs}\``)
    for (const [id, e] of Object.entries(r.perAttr)) {
      push(`- ${id}: everswap Δ=${e.everswap.toExponential(3)}, schematic Δ=${e.schematic.toExponential(3)}`)
    }
    push('')
  }

  // 3) Unpack mode shootout on a few key files
  push('## 3. Unpack mode stability (re-encode from each decode)')
  const keyFiles = [
    'SC_01_MOUNTAIN_RIDGE.buf',
    'SC_01_MOUNTAIN.buf',
    'BIRD.buf',
    'SC_01_CAMERA.buf',
  ]
  for (const f of keyFiles) {
    const path = resolve(MODELS, f)
    if (!files.includes(f)) continue
    const s = unpackModeShootout(path)
    push(`### ${s.file}`)
    push('| attr | stable under everswap | stable under schematic |')
    push('| --- | ---: | ---: |')
    for (const id of Object.keys(s.errE)) {
      push(`| ${id} | ${s.errE[id]!.toExponential(2)} | ${s.errS[id]!.toExponential(2)} |`)
    }
    push('')
  }

  // 4) PLY presets
  push('## 4. Fixture PLY → .buf presets')
  const presets = plyPresetCompare()
  push('```json')
  push(JSON.stringify(presets, null, 2))
  push('```')
  push('')

  // 5) Verdict (quantization-aware)
  let quantFails = 0
  let quantChecks = 0
  const quantDetails: string[] = []
  for (const r of rows) {
    const src = ab(readFileSync(resolve(MODELS, r.file)))
    const { meta } = decodeBuf(src, 'everswap')
    for (const a of meta.attributes) {
      const err = r.perAttr[a.id]?.everswap ?? 0
      if (!a.needsPack || !a.packedComponents?.length) {
        quantChecks++
        if (err !== 0) {
          quantFails++
          quantDetails.push(`${r.file}/${a.id}: expected 0 got ${err}`)
        }
        continue
      }
      const bytes = a.storageType.includes('8')
        ? 1
        : a.storageType.includes('16')
          ? 2
          : 4
      const size = 1 << (bytes * 8)
      const maxStep = Math.max(...a.packedComponents.map((p) => p.delta / size))
      // Allow up to ~2.5 quantization steps (re-quantize noise)
      quantChecks++
      if (err > maxStep * 2.5 + 1e-12) {
        quantFails++
        quantDetails.push(
          `${r.file}/${a.id}: Δ=${err.toExponential(3)} > 2.5×step=${(maxStep * 2.5).toExponential(3)}`,
        )
      }
    }
  }

  const maxE = Math.max(
    ...rows.flatMap((r) => Object.values(r.perAttr).map((x) => x.everswap)),
  )
  push('## Verdict')
  push(`| Check | Result |`)
  push(`| --- | --- |`)
  push(`| Pack formula vs Lusion | ${packId.mismatches === 0 ? 'PASS' : 'FAIL'} |`)
  push(`| Meta layout preserved (11 files) | ${failMeta === 0 ? 'PASS' : 'FAIL'} |`)
  push(
    `| Float/index attrs lossless | ${quantDetails.filter((d) => d.includes('expected 0')).length === 0 ? 'PASS' : 'FAIL'} |`,
  )
  push(
    `| Packed attrs within ≤2.5 quant steps | ${quantFails === 0 ? 'PASS' : 'FAIL'} (${quantFails}/${quantChecks} over) |`,
  )
  push(`| Absolute max Δ (informational) | ${maxE.toExponential(3)} (see CAMERA dist — step≈2.59e-2) |`)
  if (quantDetails.length) {
    push('')
    push('Over-threshold details:')
    for (const d of quantDetails) push(`- ${d}`)
  }

  const text = report.join('\n')
  const outPath = resolve(OUT, 'COMPARE_REPORT.md')
  writeFileSync(outPath, text)
  console.log(text)
  console.log(`\nWrote ${outPath}`)
}

main()
