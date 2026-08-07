import { encodeComponents } from './encode'
import { parsePly } from './ply/parse'
import { plyToComponents } from './remap'
import type { ConvertOptions } from './types'

/** Parse PLY bytes and encode a Lusion-compatible .buf */
export function plyToBuf(ply: ArrayBuffer, options: ConvertOptions = {}): ArrayBuffer {
  const mesh = parsePly(ply)
  const components = plyToComponents(mesh, options)
  return encodeComponents(components, {
    ...options,
    meshTypeHint: mesh.meshTypeHint,
    sceneData: options.sceneData ?? mesh.sceneData,
    indexCount: mesh.indices.length,
  })
}

export { plyToComponents, parsePly }
