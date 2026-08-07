/**
 * Minimal PLY reader (ASCII + binary little/big endian).
 * Preserves raw properties for Lusion-style remapping.
 */

export type PlyProperty = {
  name: string
  type: string
  isList?: boolean
  countType?: string
  itemType?: string
}

export type PlyElement = {
  name: string
  count: number
  props: PlyProperty[]
}

export type PlyMesh = {
  comments: string[]
  /** Raw per-property vertex arrays */
  properties: Record<string, Float32Array>
  propertyTypes: Record<string, string>
  vertexCount: number
  /** Triangulated or line indices (flat) */
  indices: number[]
  meshTypeHint: 'Mesh' | 'Points' | 'LineSegments'
  /** From `comment sceneData {...}` */
  sceneData?: unknown
  /** From gply comment — winding was flipped while building indices */
  gplyFlip: boolean
}

function parseType(t: string): string {
  const map: Record<string, string> = {
    char: 'int8',
    uchar: 'uint8',
    short: 'int16',
    ushort: 'uint16',
    int: 'int32',
    uint: 'uint32',
    float: 'float32',
    double: 'float64',
    int8: 'int8',
    uint8: 'uint8',
    int16: 'int16',
    uint16: 'uint16',
    int32: 'int32',
    uint32: 'uint32',
    float32: 'float32',
    float64: 'float64',
  }
  return map[t] ?? t
}

function readNumber(
  view: DataView,
  offset: number,
  type: string,
  littleEndian: boolean,
): { value: number; size: number } {
  const t = parseType(type)
  switch (t) {
    case 'int8':
      return { value: view.getInt8(offset), size: 1 }
    case 'uint8':
      return { value: view.getUint8(offset), size: 1 }
    case 'int16':
      return { value: view.getInt16(offset, littleEndian), size: 2 }
    case 'uint16':
      return { value: view.getUint16(offset, littleEndian), size: 2 }
    case 'int32':
      return { value: view.getInt32(offset, littleEndian), size: 4 }
    case 'uint32':
      return { value: view.getUint32(offset, littleEndian), size: 4 }
    case 'float32':
      return { value: view.getFloat32(offset, littleEndian), size: 4 }
    case 'float64':
      return { value: view.getFloat64(offset, littleEndian), size: 8 }
    default:
      throw new Error(`Unknown PLY type ${type}`)
  }
}

function isFaceIndexList(name: string): boolean {
  return /indic/i.test(name)
}

function isIntegerType(type: string): boolean {
  const t = parseType(type)
  return !t.startsWith('float') && !t.startsWith('double')
}

export function parsePly(buffer: ArrayBuffer): PlyMesh {
  const bytes = new Uint8Array(buffer)
  const textHead = new TextDecoder('ascii').decode(
    bytes.subarray(0, Math.min(bytes.length, 65536)),
  )
  const headerMatch = /end_header\r?\n/.exec(textHead)
  if (!headerMatch) throw new Error('Invalid PLY: missing end_header')
  const headerLength = headerMatch.index! + headerMatch[0].length
  const headerText = textHead.slice(0, headerLength)

  const comments: string[] = []
  const elements: PlyElement[] = []
  let format = 'ascii'
  let current: PlyElement | null = null
  let sceneData: unknown
  let gplyFlip = false

  for (const rawLine of headerText.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line === 'ply' || line.startsWith('end_header')) continue
    const parts = line.split(/\s+/)
    const tag = parts[0]
    if (tag === 'format') {
      format = parts[1]!
    } else if (tag === 'comment') {
      const rest = parts.slice(1).join(' ')
      if (rest.includes('gply')) {
        gplyFlip = true
      } else if (rest.startsWith('sceneData ')) {
        sceneData = JSON.parse(rest.slice('sceneData '.length))
      } else {
        comments.push(rest)
      }
    } else if (tag === 'element') {
      current = { name: parts[1]!, count: parseInt(parts[2]!, 10), props: [] }
      elements.push(current)
    } else if (tag === 'property' && current) {
      if (parts[1] === 'list') {
        current.props.push({
          name: parts[4]!,
          type: 'list',
          isList: true,
          countType: parts[2],
          itemType: parts[3],
        })
      } else {
        current.props.push({ name: parts[2]!, type: parts[1]! })
      }
    }
  }

  const littleEndian = format !== 'binary_big_endian'
  const isBinary = format.startsWith('binary')
  const vertexEl = elements.find((e) => e.name === 'vertex')
  const faceEl = elements.find((e) => e.name === 'face')
  if (!vertexEl) throw new Error('PLY has no vertex element')

  const properties: Record<string, Float32Array> = {}
  const propertyTypes: Record<string, string> = {}
  for (const p of vertexEl.props) {
    if (!p.isList) {
      properties[p.name] = new Float32Array(vertexEl.count)
      propertyTypes[p.name] = p.type
    }
  }

  const indices: number[] = []
  let isMesh = false
  let isLine = false

  const pushFace = (verts: number[]) => {
    if (verts.length === 2) {
      isLine = true
      indices.push(verts[0]!, verts[1]!)
      return
    }
    if (verts.length >= 3) {
      isMesh = true
      for (let h = 0; h < verts.length - 2; h++) {
        if (gplyFlip) {
          indices.push(verts[0]!, verts[h + 2]!, verts[h + 1]!)
        } else {
          indices.push(verts[0]!, verts[h + 1]!, verts[h + 2]!)
        }
      }
    }
  }

  if (isBinary) {
    let offset = headerLength
    const view = new DataView(buffer)
    for (let i = 0; i < vertexEl.count; i++) {
      for (const p of vertexEl.props) {
        if (p.isList) throw new Error('List properties on vertex not supported')
        const { value, size } = readNumber(view, offset, p.type, littleEndian)
        properties[p.name]![i] = value
        offset += size
      }
    }
    if (faceEl) {
      for (let i = 0; i < faceEl.count; i++) {
        for (const p of faceEl.props) {
          if (!p.isList) {
            const { size } = readNumber(view, offset, p.type, littleEndian)
            offset += size
            continue
          }
          const nRead = readNumber(view, offset, p.countType!, littleEndian)
          offset += nRead.size
          const verts: number[] = []
          for (let k = 0; k < nRead.value; k++) {
            const ir = readNumber(view, offset, p.itemType!, littleEndian)
            offset += ir.size
            verts.push(ir.value)
          }
          if (isFaceIndexList(p.name)) pushFace(verts)
        }
      }
    }
  } else {
    const body = new TextDecoder('ascii').decode(bytes.subarray(headerLength))
    const tokens = body.trim().split(/\s+/).filter(Boolean)
    let ti = 0
    for (let i = 0; i < vertexEl.count; i++) {
      for (const p of vertexEl.props) {
        if (p.isList) throw new Error('List on vertex unsupported')
        properties[p.name]![i] = parseFloat(tokens[ti++]!)
      }
    }
    if (faceEl) {
      for (let i = 0; i < faceEl.count; i++) {
        for (const p of faceEl.props) {
          if (!p.isList) {
            ti++
            continue
          }
          const n = parseInt(tokens[ti++]!, 10)
          const verts: number[] = []
          for (let k = 0; k < n; k++) verts.push(parseInt(tokens[ti++]!, 10))
          if (isFaceIndexList(p.name)) pushFace(verts)
        }
      }
    }
  }

  // Normalize uchar colors later in remap; keep raw here.
  void isIntegerType

  const meshTypeHint: PlyMesh['meshTypeHint'] = isMesh
    ? 'Mesh'
    : isLine
      ? 'LineSegments'
      : 'Points'

  return {
    comments,
    properties,
    propertyTypes,
    vertexCount: vertexEl.count,
    indices,
    meshTypeHint,
    sceneData,
    gplyFlip,
  }
}
