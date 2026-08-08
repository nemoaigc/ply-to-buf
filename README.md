# ply-to-buf

Offline **drop-in replacement** for [ply2buf.lusion.co](https://ply2buf.lusion.co/).

Converts PLY meshes into Lusion’s `.buf` format (JSON header + packed typed-array payloads) used by EverSwap and other Lusion WebGL sites — **no network dependency**.

Also supports **reverse** export: `.buf` → PLY, so you can recover meshes for Blender and build your own scenes on the same pipeline.

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
| **Reverse `.buf` → PLY** | Yes (`--to-ply`) |

**Unpack formula:** Lusion’s pasted “schematic” snippet uses `1/(size-1)`. EverSwap’s production loader uses `1/size`. Prefer **`everswap`** unpack when recovering EverSwap assets.

## Install

```bash
npm install
npm run build
```

## CLI

```bash
# PLY → .buf
npm run cli -- mesh.ply -o mesh.buf --preset everswap --validate

# .buf → PLY (recover mesh for Blender / new scenes)
npm run cli -- --to-ply path/to/SC_01_MOUNTAIN.buf -o mountain.ply
npm run cli -- --to-ply path/to/models/scene1 -o ./ply-export

npm run cli -- mesh.ply --schematic --everswap-unpack
npm run cli -- --roundtrip path/to/existing.buf
```

| Flag | Meaning |
| --- | --- |
| `--to-ply` | Reverse export `.buf` → `.ply` (file or directory) |
| `--binary` | Binary little-endian PLY instead of ASCII |
| `--no-custom` | Only position/normal/uv/color (drop shadowmask etc.) |
| `--preset lusion` | Position→Int16 packed, normal→Int8 (ply2buf UI defaults) |
| `--preset everswap` | Position→Float32, normal→Uint16 packed (EverSwap mountains) |
| `--float id,id` | Force Float32 / no pack |
| `--exclude id,id` | Drop attributes |
| `--validate` | Max absolute error vs source floats |
| `--schematic` | Print Three.js loader snippet |

## Own-scene workflow

```text
1. Reverse existing EverSwap .buf → PLY   (study topology / UV / channels)
2. Model your own props in Blender         (mid-poly shells + UV)
3. Paint or generate albedo WebP
4. PLY → .buf with --preset everswap
5. Load in Three.js + thin sky/fog shaders
```

## Web UI

```bash
npm run dev
# http://127.0.0.1:5174/
```

## Library

```ts
import { plyToBuf, decodeBuf, bufToPly } from 'ply-to-buf'

const buf = plyToBuf(plyArrayBuffer, { preset: 'everswap' })
const { ply } = bufToPly(buf, { unpackMode: 'everswap' })
```

## Layout

```text
ply-to-buf/
├── src/
│   ├── encode.ts / decode.ts
│   ├── ply/parse.ts
│   ├── ply/write.ts      # .buf → PLY
│   └── cli.ts
├── web/
├── test/
└── README.md
```

## License

MIT
