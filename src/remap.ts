import { minMax, pickIntegerStorage } from './storage'
import type { ComponentSpec, ConvertOptions, StorageType } from './types'
import type { PlyMesh } from './ply/parse'

type DefaultMap = {
  saveToId: string
  saveToIndex: number
  needsSave: boolean
  storageType: StorageType
  needsPack: boolean
}

/**
 * Lusion `_getDefaultInfo` remapping rules.
 */
export function defaultRemap(
  propName: string,
  allProps: string[],
  propType: string,
  data: Float32Array,
  preset: 'lusion' | 'everswap',
): DefaultMap {
  const has = (n: string) => allProps.includes(n)

  // color
  if (
    (propName === 'red' || propName === 'green' || propName === 'blue') &&
    has('red') &&
    has('green') &&
    has('blue')
  ) {
    const idx = propName === 'red' ? 0 : propName === 'green' ? 1 : 2
    return {
      saveToId: 'color',
      saveToIndex: idx,
      needsSave: true,
      storageType: 'Uint8Array',
      needsPack: true,
    }
  }

  // sibling vector detection
  const last = propName.slice(-1)
  const prefix = propName.slice(0, -1)

  const hasXYZ = (p: string) => has(p + 'x') && has(p + 'y')
  const hasST = (p: string) => has(p + 's') && has(p + 't')
  const has12 = (p: string) => has(p + '1') && has(p + '2')

  if (
    (last === 'x' || last === 'y' || last === 'z' || last === 'w') &&
    (hasXYZ(prefix) || has(prefix + 'z') || has(prefix + 'w'))
  ) {
    let saveToId = prefix
    if (prefix === '') saveToId = 'position'
    else if (prefix === 'n') saveToId = 'normal'
    const saveToIndex = { x: 0, y: 1, z: 2, w: 3 }[last]!

    if (saveToId === 'position') {
      if (preset === 'everswap') {
        return {
          saveToId,
          saveToIndex,
          needsSave: true,
          storageType: 'Float32Array',
          needsPack: false,
        }
      }
      return {
        saveToId,
        saveToIndex,
        needsSave: true,
        storageType: 'Int16Array',
        needsPack: true,
      }
    }
    if (saveToId === 'normal') {
      if (preset === 'everswap') {
        return {
          saveToId,
          saveToIndex,
          needsSave: true,
          storageType: 'Uint16Array',
          needsPack: true,
        }
      }
      return {
        saveToId,
        saveToIndex,
        needsSave: true,
        storageType: 'Int8Array',
        needsPack: true,
      }
    }
    return {
      saveToId,
      saveToIndex,
      needsSave: true,
      storageType: 'Int16Array',
      needsPack: true,
    }
  }

  if ((last === 's' || last === 't') && hasST(prefix)) {
    const saveToIndex = last === 's' ? 0 : 1
    const saveToId = prefix === '' || prefix === 'texture_' ? 'uv' : `${prefix}uv`
    // Lusion: uv with index 2 defaults needs-save false — we only have 0/1
    return {
      saveToId: prefix === '' ? 'uv' : saveToId === 'texture_uv' ? 'uv' : saveToId,
      saveToIndex,
      needsSave: true,
      storageType: 'Int16Array',
      needsPack: true,
    }
  }

  // bare u/v
  if ((propName === 'u' || propName === 'v') && has('u') && has('v')) {
    return {
      saveToId: 'uv',
      saveToIndex: propName === 'u' ? 0 : 1,
      needsSave: true,
      storageType: 'Int16Array',
      needsPack: true,
    }
  }
  if (
    (propName === 'texture_u' || propName === 'texture_v') &&
    has('texture_u') &&
    has('texture_v')
  ) {
    return {
      saveToId: 'uv',
      saveToIndex: propName === 'texture_u' ? 0 : 1,
      needsSave: true,
      storageType: 'Int16Array',
      needsPack: true,
    }
  }

  if ((last === '1' || last === '2' || last === '3' || last === '4') && has12(prefix)) {
    return {
      saveToId: prefix,
      saveToIndex: parseInt(last, 10) - 1,
      needsSave: true,
      storageType: 'Int16Array',
      needsPack: true,
    }
  }

  // scalar / leftover
  const t = propType.toLowerCase()
  const isFloat = t.includes('float') || t.includes('double')
  if (!isFloat) {
    const { min, max } = minMax(data)
    return {
      saveToId: propName,
      saveToIndex: 0,
      needsSave: true,
      storageType: pickIntegerStorage(min, max),
      needsPack: false,
    }
  }

  return {
    saveToId: propName,
    saveToIndex: 0,
    needsSave: true,
    storageType: preset === 'everswap' ? 'Int16Array' : 'Int16Array',
    needsPack: true,
  }
}

export function plyToComponents(
  mesh: PlyMesh,
  options: ConvertOptions = {},
): ComponentSpec[] {
  const preset = options.preset ?? 'lusion'
  const allProps = Object.keys(mesh.properties)
  const exclude = new Set(options.exclude ?? [])
  const floatIds = new Set(options.floatIds ?? [])

  const components: ComponentSpec[] = []

  for (const name of allProps) {
    let data = mesh.properties[name]!
    // uchar color → 0–1 if looks like 0–255
    if (
      (name === 'red' || name === 'green' || name === 'blue') &&
      data.length &&
      minMax(data).max > 1
    ) {
      const scaled = new Float32Array(data.length)
      for (let i = 0; i < data.length; i++) scaled[i] = data[i]! / 255
      data = scaled
    }

    const d = defaultRemap(name, allProps, mesh.propertyTypes[name] ?? 'float', data, preset)

    if (exclude.has(name) || exclude.has(d.saveToId)) {
      d.needsSave = false
    }
    if (floatIds.has(d.saveToId)) {
      d.storageType = 'Float32Array'
      d.needsPack = false
    }

    // Apply optional overrides matching sourceId or saveToId
    const override = options.components?.find(
      (c) => c.sourceId === name || (c.saveToId === d.saveToId && c.saveToIndex === d.saveToIndex),
    )
    const spec: ComponentSpec = {
      sourceId: name,
      data,
      saveToId: override?.saveToId ?? d.saveToId,
      saveToIndex: override?.saveToIndex ?? d.saveToIndex,
      needsSave: override?.needsSave ?? d.needsSave,
      storageType: override?.storageType ?? d.storageType,
      needsPack: override?.needsPack ?? d.needsPack,
      packFrom: override?.packFrom,
      packTo: override?.packTo,
    }
    components.push(spec)
  }

  // indices — Lusion picks Int/Uint by value range (small meshes often Uint8)
  if (mesh.indices.length) {
    const data = Float32Array.from(mesh.indices)
    const { min, max } = minMax(data)
    components.push({
      sourceId: 'indices',
      data,
      saveToId: 'indices',
      saveToIndex: 0,
      needsSave: !exclude.has('indices'),
      storageType: pickIntegerStorage(min, max),
      needsPack: false,
    })
  }

  return components
}
