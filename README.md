# ply-to-buf

Offline **drop-in replacement** for [ply2buf.lusion.co](https://ply2buf.lusion.co/).

Converts PLY meshes into Lusion’s `.buf` format (JSON header + packed typed-array payloads) used by EverSwap and other Lusion WebGL sites — **no network dependency**.

## Honest capability note

This is **not** a pixel-perfect clone of Lusion’s GUI (no WebGL preview / dat.GUI). For the **geometry conversion path**, it matches ply2buf’s encode rules:

| Capability | Status |
| --- | --- |
| ASCII + binary PLY | Yes |
| Attribute remapping (`save-to-id` / index) | Yes (CLI + UI) |
| Per-component pack / storage / pack-from–to | Yes |
| `needs-save` exclude | Yes |
| Byte-size attribute sort (Lusion order) | Yes (default) |
| `Mesh` / `Points` / `LineSegments` | Yes |
| `comment sceneData …` | Yes |
| `gply` winding flip | Yes |
| Multi-file → `all.zip` | Yes (web UI) |
| Schematic loader snippet | Yes |
| Position packing allowed | Yes |
| Presets: Lusion defaults **and** EverSwap mountain style | Yes |

**Unpack formula:** Lusion’s pasted “schematic” snippet uses `1/(size-1)`. EverSwap’s production loader uses `1/size`. Both modes are supported (`--everswap-unpack` / decode option). Prefer **`everswap`** when feeding EverSwap-style runtimes.

## Install

```bash
npm install
npm run build
```

```bash
# one-shot without installing globally
npx tsx src/cli.ts mesh.ply -o mesh.buf --preset everswap --validate
```

## CLI

```bash
npm run cli -- mesh.ply -o mesh.buf --preset everswap --validate
npm run cli -- mesh.ply --schematic --everswap-unpack
npm run cli -- --roundtrip path/to/existing.buf
```

| Flag | Meaning |
| --- | --- |
| `--preset lusion` | Position→Int16 packed, normal→Int8 (ply2buf UI defaults) |
| `--preset everswap` | Position→Float32, normal→Uint16 packed (common EverSwap exports) |
| `--float id,id` | Force Float32 / no pack |
| `--exclude id,id` | Drop attributes |
| `--validate` | Max absolute error vs source floats |
| `--schematic` | Print Three.js loader snippet |

## Web UI

```bash
npm run dev
# http://127.0.0.1:5174/
```

Drop PLYs, edit remapping / pack ranges, export `.buf` or multi-file `all.zip`, copy schematic code.

## Library

```ts
import { plyToBuf, decodeBuf } from 'ply-to-buf'

const buf = plyToBuf(plyArrayBuffer, { preset: 'everswap' })
const { meta, attributes } = decodeBuf(buf, 'everswap')
```

## Layout

```text
ply-to-buf/
├── src/                 # library + CLI
│   ├── index.ts         # public API
│   ├── encode.ts        # .buf writer (Lusion pack rules)
│   ├── decode.ts        # reader + schematic codegen
│   ├── remap.ts         # PLY prop → attribute remapping
│   ├── convert.ts
│   ├── storage.ts
│   ├── types.ts
│   ├── cli.ts
│   └── ply/parse.ts
├── web/                 # offline local UI (Vite)
├── test/                # vitest + fixtures
├── package.json
└── README.md
```

## Format

```text
uint32 LE     JSON header length
UTF-8 JSON    padded with spaces to 4-byte alignment
binary        attribute payloads in attributes[] order
```

Pack (Lusion):

```text
t = (value - from) / delta          # no clamp
stored = mix(typedMin, typedMax, t) # TypedArray truncates toward 0
```

## License

MIT
