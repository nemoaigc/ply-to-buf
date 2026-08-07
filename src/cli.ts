#!/usr/bin/env node
/**
 * CLI — offline replacement for ply2buf.lusion.co
 *
 *   ply-to-buf mesh.ply -o mesh.buf
 *   ply-to-buf mesh.ply -o mesh.buf --preset everswap --validate
 *   ply-to-buf --roundtrip file.buf
 *   ply-to-buf mesh.ply --schematic > loader.js
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { decodeBuf, generateSchematicCode } from './decode'
import { encodeComponents } from './encode'
import { plyToBuf } from './convert'
import { parsePly } from './ply/parse'
import { plyToComponents } from './remap'
import type { ComponentSpec, ConvertOptions, UnpackMode } from './types'

function usage() {
  console.log(`Usage:
  ply-to-buf <input.ply> -o <output.buf> [options]
  ply-to-buf --roundtrip <file.buf>
  ply-to-buf <input.ply> --schematic [--everswap-unpack]

Options:
  -o, --out PATH          Output .buf path
  --preset lusion|everswap  Default packing (default: lusion)
  --float id,id           Force Float32 / no pack for attribute ids
  --exclude id,id         Drop attributes from export
  --mesh-type TYPE        Mesh | Points | LineSegments
  --validate              Print max |error| vs source (everswap unpack)
  --schematic             Print Three.js loader snippet to stdout
  --everswap-unpack       Schematic / validate use /size (EverSwap runtime)
  --no-sort               Keep attribute order (default: Lusion byte-size sort)
  --roundtrip PATH        Decode→re-encode an existing .buf
  -h, --help
`)
}

function parseArgs(argv: string[]) {
  const args = {
    _: [] as string[],
    out: '',
    validate: false,
    float: [] as string[],
    exclude: [] as string[],
    meshType: '' as ConvertOptions['meshType'] | '',
    preset: 'lusion' as 'lusion' | 'everswap',
    schematic: false,
    everswapUnpack: false,
    noSort: false,
    roundtrip: '',
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '-o' || a === '--out') args.out = argv[++i]!
    else if (a === '--validate') args.validate = true
    else if (a === '--float')
      args.float = argv[++i]!.split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--exclude')
      args.exclude = argv[++i]!.split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--mesh-type') args.meshType = argv[++i] as ConvertOptions['meshType']
    else if (a === '--preset') args.preset = argv[++i] as 'lusion' | 'everswap'
    else if (a === '--schematic') args.schematic = true
    else if (a === '--everswap-unpack') args.everswapUnpack = true
    else if (a === '--no-sort') args.noSort = true
    else if (a === '--roundtrip') args.roundtrip = argv[++i]!
    else if (a === '--help' || a === '-h') {
      usage()
      process.exit(0)
    } else if (a.startsWith('-')) {
      console.error(`Unknown flag ${a}`)
      usage()
      process.exit(1)
    } else args._.push(a)
  }
  return args
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let m = 0
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!))
  return m
}

function toInterleaved(components: ComponentSpec[], id: string): Float32Array | null {
  const comps = components
    .filter((c) => c.saveToId === id && c.needsSave)
    .sort((a, b) => a.saveToIndex - b.saveToIndex)
  if (!comps.length) return null
  const count = comps[0]!.data.length
  const out = new Float32Array(count * comps.length)
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < comps.length; c++) {
      out[i * comps.length + c] = comps[c]!.data[i]!
    }
  }
  return out
}

function roundtripBuf(path: string, unpackMode: UnpackMode) {
  const file = readFileSync(path)
  const ab = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
  const { meta, attributes } = decodeBuf(ab, unpackMode)

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

  const out = encodeComponents(components, {
    meshType: meta.meshType,
    sceneData: meta.sceneData,
    sortByByteSize: true,
  })
  const again = decodeBuf(out, unpackMode)

  console.log(`Round-trip ${path}`)
  console.log(
    `  vertices=${meta.vertexCount} indices=${meta.indexCount} attrs=${meta.attributes.length}`,
  )
  console.log(`  out bytes=${out.byteLength} (src=${ab.byteLength})`)
  for (const m of meta.attributes) {
    const d = maxAbsDiff(attributes[m.id]!, again.attributes[m.id]!)
    console.log(`  ${m.id}: max|Δ|=${d.toExponential(3)}`)
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const unpackMode: UnpackMode = args.everswapUnpack ? 'everswap' : 'schematic'

  if (args.roundtrip) {
    roundtripBuf(resolve(args.roundtrip), args.everswapUnpack ? 'everswap' : 'everswap')
    return
  }

  const input = args._[0]
  if (!input) {
    usage()
    process.exit(1)
  }

  const inPath = resolve(input)
  const plyBytes = readFileSync(inPath)
  const plyAb = plyBytes.buffer.slice(
    plyBytes.byteOffset,
    plyBytes.byteOffset + plyBytes.byteLength,
  )

  const convertOpts: ConvertOptions = {
    preset: args.preset,
    floatIds: args.float,
    exclude: args.exclude,
    meshType: args.meshType || undefined,
    sortByByteSize: !args.noSort,
  }

  if (args.schematic) {
    const out = plyToBuf(plyAb, convertOpts)
    const { meta } = decodeBuf(out, unpackMode)
    console.log(
      generateSchematicCode(meta, {
        includeSceneScript: true,
        unpackMode,
      }),
    )
    return
  }

  const outPath = resolve(args.out || inPath.replace(/\.ply$/i, '.buf'))
  const mesh = parsePly(plyAb)
  const components = plyToComponents(mesh, convertOpts)
  const out = plyToBuf(plyAb, convertOpts)

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, Buffer.from(out))

  const { meta, attributes } = decodeBuf(out, 'everswap')
  console.log(`Wrote ${outPath}`)
  console.log(
    `  ${meta.meshType} vertices=${meta.vertexCount} indices=${meta.indexCount} bytes=${out.byteLength}`,
  )
  for (const a of meta.attributes) {
    const pack = a.needsPack ? `pack ${a.storageType}` : a.storageType
    console.log(`  - ${a.id} ×${a.componentSize} (${pack})`)
  }

  if (args.validate) {
    console.log('Validate vs PLY (everswap unpack):')
    const ids = new Set(components.filter((c) => c.needsSave).map((c) => c.saveToId))
    for (const id of ids) {
      const src = toInterleaved(components, id)
      const dst = attributes[id]
      if (!src || !dst) {
        console.log(`  ${id}: MISSING`)
        continue
      }
      console.log(`  ${id}: max|Δ|=${maxAbsDiff(src, dst).toExponential(3)}`)
    }
  }
}

main()
