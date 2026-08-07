import { STORAGE, mix, clamp, minMax } from './storage'
import type {
  BufAttributeMeta,
  BufMeta,
  ComponentSpec,
  EncodeOptions,
  MeshType,
  StorageType,
} from './types'

function strToUint8(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}

type PreparedAttr = {
  id: string
  componentSize: number
  count: number
  storageType: StorageType
  needsPack: boolean
  packRanges: { from: number; delta: number }[]
  components: Float32Array[]
  byteSize: number
}

/**
 * Lusion sort: higher byteSize first; on tie, lower id first (localeCompare ascending).
 */
export function sortHighToLowByteSize(a: PreparedAttr, b: PreparedAttr): number {
  if (a.byteSize === b.byteSize) {
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  }
  return b.byteSize - a.byteSize
}

function groupComponents(components: ComponentSpec[]): Map<string, ComponentSpec[]> {
  const map = new Map<string, ComponentSpec[]>()
  for (const c of components) {
    if (!c.needsSave) continue
    const list = map.get(c.saveToId) ?? []
    list.push(c)
    map.set(c.saveToId, list)
  }
  for (const [, list] of map) {
    list.sort((a, b) => a.saveToIndex - b.saveToIndex)
  }
  return map
}

function prepare(components: ComponentSpec[], options: EncodeOptions): PreparedAttr[] {
  const groups = groupComponents(components)
  const prepared: PreparedAttr[] = []

  for (const [id, comps] of groups) {
    const first = comps[0]!
    let storageType = first.storageType
    let needsPack = first.needsPack
    const byteSize = STORAGE[storageType].bytes
    if (byteSize === 4) needsPack = false

    const count = first.data.length
    for (const c of comps) {
      if (c.data.length !== count) {
        throw new Error(`Attribute "${id}": component length mismatch (${c.sourceId})`)
      }
    }

    const packRanges: { from: number; delta: number }[] = []
    if (needsPack) {
      for (const c of comps) {
        let from = c.packFrom
        let to = c.packTo
        if (from === undefined || to === undefined) {
          const mm = minMax(c.data)
          from = from ?? mm.min
          to = to ?? mm.max
        }
        packRanges.push({ from, delta: Math.max(to - from, 0) })
      }
    }

    prepared.push({
      id,
      componentSize: comps.length,
      count,
      storageType,
      needsPack,
      packRanges,
      components: comps.map((c) => c.data),
      byteSize,
    })
  }

  if (options.sortByByteSize !== false) {
    prepared.sort(sortHighToLowByteSize)
  }

  return prepared
}

function inferMeshType(
  indexCount: number,
  explicit?: MeshType,
  hint?: MeshType,
): MeshType {
  if (explicit) return explicit
  if (hint) return hint
  return indexCount > 0 ? 'Mesh' : 'Points'
}

/** Encode remapped components into a Lusion-compatible .buf ArrayBuffer. */
export function encodeComponents(
  components: ComponentSpec[],
  options: EncodeOptions = {},
): ArrayBuffer {
  const prepared = prepare(components, options)
  const indexAttr = prepared.find((a) => a.id === 'indices')
  const vertexAttr = prepared.find((a) => a.id !== 'indices')
  const vertexCount = vertexAttr?.count ?? 0
  const indexCount = options.indexCount ?? indexAttr?.count ?? 0
  const meshType = inferMeshType(indexCount, options.meshType, options.meshTypeHint)

  const meta: BufMeta = {
    vertexCount,
    indexCount,
    meshType,
    attributes: prepared.map((a) => {
      const m: BufAttributeMeta = {
        id: a.id,
        needsPack: a.needsPack,
        componentSize: a.componentSize,
        storageType: a.storageType,
      }
      if (a.needsPack) {
        m.packedComponents = a.packRanges.map((p) => ({
          from: p.from,
          delta: p.delta,
        }))
      }
      return m
    }),
  }

  if (options.sceneData !== undefined) {
    meta.sceneData = options.sceneData
  }

  const pos = prepared.find((a) => a.id === 'position')
  if (pos && pos.componentSize >= 3) {
    const mins = [Infinity, Infinity, Infinity]
    const maxs = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < pos.count; i++) {
      for (let c = 0; c < 3; c++) {
        const v = pos.components[c]![i]!
        mins[c] = Math.min(mins[c]!, v)
        maxs[c] = Math.max(maxs[c]!, v)
      }
    }
    meta.boundingBox = { min: mins, max: maxs }
    const center = mins.map((m, i) => (m + maxs[i]!) * 0.5)
    const radius = Math.hypot(
      maxs[0]! - center[0]!,
      maxs[1]! - center[1]!,
      maxs[2]! - center[2]!,
    )
    meta.boundingSphere = { center, radius }
  }

  let json = JSON.stringify(meta)
  const pad = (4 - (json.length % 4)) % 4
  json += ' '.repeat(pad)
  const jsonBytes = strToUint8(json)

  const chunks: Uint8Array[] = []
  const headerLen = new Uint8Array(4)
  new DataView(headerLen.buffer).setUint32(0, json.length, true)
  chunks.push(headerLen)
  chunks.push(jsonBytes)

  const packStyle = options.packStyle ?? 'lusion'

  for (const a of prepared) {
    const info = STORAGE[a.storageType]
    const out = new info.Ctor(a.count * a.componentSize)
    let h = 0
    for (let i = 0; i < a.count; i++) {
      for (let c = 0; c < a.componentSize; c++) {
        let v = a.components[c]![i]!
        if (a.needsPack) {
          const pr = a.packRanges[c]!
          const t = pr.delta > 0 ? (v - pr.from) / pr.delta : 0
          if (packStyle === 'rounded') {
            v = Math.round(mix(info.from, info.to, clamp(t, 0, 1)))
          } else {
            v = mix(info.from, info.to, t)
          }
        }
        out[h++] = v
      }
    }
    chunks.push(new Uint8Array(out.buffer, out.byteOffset, out.byteLength))
  }

  let total = 0
  for (const c of chunks) total += c.byteLength
  const buffer = new ArrayBuffer(total)
  const view = new Uint8Array(buffer)
  let offset = 0
  for (const c of chunks) {
    view.set(c, offset)
    offset += c.byteLength
  }
  return buffer
}
