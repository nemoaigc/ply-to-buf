import type { StorageType } from './types'

export type StorageInfo = {
  type: StorageType
  bytes: number
  from: number
  to: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Ctor: any
}

export const STORAGE: Record<StorageType, StorageInfo> = {
  Int8Array: { type: 'Int8Array', bytes: 1, from: -128, to: 127, Ctor: Int8Array },
  Uint8Array: { type: 'Uint8Array', bytes: 1, from: 0, to: 255, Ctor: Uint8Array },
  Int16Array: { type: 'Int16Array', bytes: 2, from: -32768, to: 32767, Ctor: Int16Array },
  Uint16Array: { type: 'Uint16Array', bytes: 2, from: 0, to: 65535, Ctor: Uint16Array },
  Int32Array: {
    type: 'Int32Array',
    bytes: 4,
    from: -2147483648,
    to: 2147483647,
    Ctor: Int32Array,
  },
  Uint32Array: {
    type: 'Uint32Array',
    bytes: 4,
    from: 0,
    to: 4294967295,
    Ctor: Uint32Array,
  },
  Float32Array: { type: 'Float32Array', bytes: 4, from: 0, to: 1, Ctor: Float32Array },
}

export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v))
}

/** Pick integer storage from value range (Lusion integer props / indices). */
export function pickIntegerStorage(min: number, max: number): StorageType {
  if (min < 0) {
    if (min >= -128 && max <= 127) return 'Int8Array'
    if (min >= -32768 && max <= 32767) return 'Int16Array'
    return 'Int32Array'
  }
  if (max <= 255) return 'Uint8Array'
  if (max <= 65535) return 'Uint16Array'
  return 'Uint32Array'
}

export function minMax(data: ArrayLike<number>): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!Number.isFinite(min)) return { min: 0, max: 0 }
  return { min, max }
}
