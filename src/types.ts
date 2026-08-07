/** Shared types for Lusion-compatible .buf encode/decode. */

export type StorageType =
  | 'Float32Array'
  | 'Int8Array'
  | 'Uint8Array'
  | 'Int16Array'
  | 'Uint16Array'
  | 'Int32Array'
  | 'Uint32Array'

export type MeshType = 'Mesh' | 'Points' | 'LineSegments'

export type PackedComponent = {
  from: number
  delta: number
}

export type BufAttributeMeta = {
  id: string
  needsPack: boolean
  componentSize: number
  storageType: StorageType
  packedComponents?: PackedComponent[]
}

export type BufMeta = {
  vertexCount: number
  indexCount: number
  meshType: MeshType
  attributes: BufAttributeMeta[]
  boundingSphere?: { center: number[]; radius: number }
  boundingBox?: { min: number[]; max: number[] }
  sceneData?: unknown
}

/**
 * How to unpack packed attributes.
 * - `everswap`: `(raw + bias) / size * delta + from` — matches EverSwap / Lusion production loaders
 * - `schematic`: `(raw + bias) / (size - 1) * delta + from` — matches ply2buf “Load Schematic Buffer Code”
 */
export type UnpackMode = 'everswap' | 'schematic'

export type ComponentSpec = {
  /** Source PLY property name (or synthetic) */
  sourceId: string
  /** Per-vertex float values */
  data: Float32Array
  /** Target attribute id after remapping (e.g. position, uv) */
  saveToId: string
  /** Component index within target attribute (0=x, 1=y, …) */
  saveToIndex: number
  /** Include in export (Lusion “needs-save”) */
  needsSave: boolean
  storageType: StorageType
  needsPack: boolean
  /** Pack range; if omitted and needsPack, use data min/max */
  packFrom?: number
  packTo?: number
}

export type EncodeOptions = {
  meshType?: MeshType
  meshTypeHint?: MeshType
  indexCount?: number
  sceneData?: unknown
  /**
   * Sort attributes by byte size descending, then id descending.
   * Default true (matches Lusion ply2buf).
   */
  sortByByteSize?: boolean
  /**
   * Encode packing style.
   * - `lusion`: mix + typed-array truncate, no clamp (ply2buf)
   * - `rounded`: Math.round after mix with clamp (friendlier)
   * Default: `lusion`
   */
  packStyle?: 'lusion' | 'rounded'
}

export type ConvertOptions = EncodeOptions & {
  /**
   * Preset for default packing / storage when remapping is not overridden.
   * - `lusion`: position→Int16 packed, normal→Int8 packed (ply2buf UI defaults)
   * - `everswap`: position→Float32, normal→Uint16 packed (common EverSwap mountain exports)
   */
  preset?: 'lusion' | 'everswap'
  /** Force Float32 / no pack for these save-to ids */
  floatIds?: string[]
  /** Drop these save-to ids (or source ids) from export */
  exclude?: string[]
  /** Override component specs after auto-remap */
  components?: Partial<ComponentSpec>[]
}
