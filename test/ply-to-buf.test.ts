import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { decodeBuf, plyToBuf, parsePly, plyToComponents, encodeComponents, bufToPly } from '../src/index'

const fixturesDir = fileURLToPath(new URL('./fixtures/', import.meta.url))

const fixture = (name: string) => readFileSync(resolve(fixturesDir, name))

function ab(buf: Buffer) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

describe('parsePly', () => {
  it('parses triangle mesh with indices', () => {
    const mesh = parsePly(ab(fixture('triangle.ply')))
    expect(mesh.vertexCount).toBe(3)
    expect(mesh.indices).toEqual([0, 1, 2])
    expect(mesh.meshTypeHint).toBe('Mesh')
  })

  it('detects LineSegments + sceneData + gply', () => {
    const mesh = parsePly(ab(fixture('line_gply.ply')))
    expect(mesh.meshTypeHint).toBe('LineSegments')
    expect(mesh.gplyFlip).toBe(true)
    expect(mesh.sceneData).toEqual({ nodes: [{ name: 'cam' }] })
    expect(mesh.indices).toEqual([0, 1])
  })
})

describe('plyToBuf presets', () => {
  it('lusion default packs position as Int16', () => {
    const out = plyToBuf(ab(fixture('triangle.ply')), { preset: 'lusion' })
    const { meta } = decodeBuf(out, 'everswap')
    expect(meta.meshType).toBe('Mesh')
    const pos = meta.attributes.find((a) => a.id === 'position')!
    expect(pos.storageType).toBe('Int16Array')
    expect(pos.needsPack).toBe(true)
    const order = meta.attributes.map((a) => a.id)
    // byte-size desc, then id asc: Int16 (pos/uv) before Uint8 (indices) before Int8 (normal)
    expect(order).toEqual(['position', 'uv', 'indices', 'normal'])
  })

  it('everswap preset keeps position Float32', () => {
    const out = plyToBuf(ab(fixture('triangle.ply')), { preset: 'everswap' })
    const { meta } = decodeBuf(out)
    const pos = meta.attributes.find((a) => a.id === 'position')!
    expect(pos.storageType).toBe('Float32Array')
    expect(pos.needsPack).toBe(false)
    // Float32 sorts before Int16
    expect(meta.attributes[0]!.id).toBe('position')
  })

  it('validates packed attrs within quantization', () => {
    const ply = ab(fixture('triangle.ply'))
    const mesh = parsePly(ply)
    const comps = plyToComponents(mesh, { preset: 'everswap' })
    const out = encodeComponents(comps, {
      meshTypeHint: mesh.meshTypeHint,
      indexCount: mesh.indices.length,
    })
    const { attributes } = decodeBuf(out, 'everswap')
    const pos = attributes.position!
    expect(pos[0]).toBe(0)
    expect(pos[3]).toBe(1)
    const uv = attributes.uv!
    // uv pack error should be tiny
    expect(Math.abs(uv[2]! - 1)).toBeLessThan(1e-3)
  })
})

describe('exclude / needsSave', () => {
  it('can drop normals', () => {
    const out = plyToBuf(ab(fixture('triangle.ply')), {
      preset: 'everswap',
      exclude: ['normal'],
    })
    const { meta } = decodeBuf(out)
    expect(meta.attributes.find((a) => a.id === 'normal')).toBeUndefined()
  })
})

describe('buf → ply', () => {
  it('roundtrips mesh topology through PLY', () => {
    const buf = plyToBuf(ab(fixture('triangle.ply')), { preset: 'everswap' })
    const { ply, meta } = bufToPly(buf, { unpackMode: 'everswap' })
    expect(meta.vertexCount).toBe(3)
    expect(meta.indexCount).toBe(3)

    const again = parsePly(ply)
    expect(again.vertexCount).toBe(3)
    expect(again.indices).toEqual([0, 1, 2])
    expect(again.properties.x![0]).toBe(0)
    expect(again.properties.x![1]).toBe(1)
    expect(again.meshTypeHint).toBe('Mesh')
  })

  it('writes custom attrs from mountainish-style packing', () => {
    const buf = plyToBuf(ab(fixture('mountainish.ply')), { preset: 'everswap' })
    const { ply } = bufToPly(buf)
    const text = new TextDecoder().decode(ply)
    expect(text).toContain('property float x')
    expect(text).toContain('property float nx')
    expect(text).toContain('property float s')
    expect(text).toContain('element face')
  })
})
