# Cancún 2026 player assets

Resolved from the asset manifests in the user-provided
`Offsite2026-tracker.zip`, exported from Lovable commit
`b707affbd42c5fc97bba78f26934a3a1c703a1a4`.

Source mappings:

- `KMR-Waldenburg-*.otf` → `src/assets/waldenburg-*.otf.asset.json`
- `paradisus.webp` → `src/assets/paradisus.jpg.asset.json`
- `noise-texture.webp` → `src/assets/noise-texture.jpg.asset.json`

The two images are lossless WebP encodes of the source PNG assets, reducing the
cold player load while preserving identical pixels. Do not replace or restyle
these independently of the Offsite portal; re-export from the portal when its
approved visual system changes.
