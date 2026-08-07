# Capability parity vs ply2buf.lusion.co

Last audited against the hosted tool’s client bundle (v1.0.0).

## Geometry path — matched

- PLY ASCII + binary little/big endian
- Face fan triangulation; 2-vertex faces → `LineSegments`
- `comment gply` winding flip
- `comment sceneData {json}` → `meta.sceneData`
- Attribute remapping (save-to-id / save-to-index) with Lusion default grouping
- `needs-save` / exclude
- Per-component storage type + needsPack + pack-from/pack-to
- Encode: `(v-from)/delta` → `mix(typedMin,typedMax,t)` with **no clamp**; TypedArray truncate
- Force `needsPack=false` when storage is 4 bytes
- Attribute order: byte size ↓ then id ↑ (localeCompare ascending)
- Bounding box / sphere from position
- Multi-file ZIP export (web)
- Schematic Three.js loader codegen

## Intentional differences

| Topic | Lusion | ply-to-buf |
| --- | --- | --- |
| Unpack in production EverSwap | `1/size` | Supports both `everswap` (`1/size`) and `schematic` (`1/(size-1)`) |
| Default position storage | Int16 packed | Same under `--preset lusion`; `--preset everswap` uses Float32 like EverSwap mountains |
| WebGL mesh preview / dat.GUI | Yes | No (conversion-focused UI) |
| Face-varying UVs | Supported | Not yet |
| LocalStorage remembering UI toggles | Yes | No |

## Not in scope

- Texture painting / WebP generation
- Camera path authoring
- Shipping Lusion’s proprietary minified app JS
