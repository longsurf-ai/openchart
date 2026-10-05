# Bundled logo catalog

`catalog.json` owns canonical IDs, names, image paths, explicit identifiers and
listing evidence (`symbol`, `exchange`, `source`). There are **1,087 logos**:
**571 publicly traded companies** and **516 traded crypto assets**. The complete
asset directory is about **8.1 MiB**. See the adjacent `AUDIT.md` in the Provider
source directory for scope, verification and limitations.

Aliases are stored here, not generated at runtime. Examples include `BTCUSD`,
`BTCUSDT`, `BTC-USD`, `XBT/USD`, `BRK.B`, `BRK-B`, `0700.HK`, `NYSE:ABT`,
`stock:ABT` and `crypto:ABT`. A canonical ID always identifies its own logo;
ambiguous bare aliases return no logo. Listing evidence describes actual traded
securities/pairs; alias variants do not promise that every spelling or quote pair
is currently offered by a provider.

- `brands/`: reviewed company images. No download credentials or generated
  monograms are included.
- `company/`: existing company PNGs retained where appropriate.
- `crypto/`: current Binance asset images for its verified active spot assets;
  selected legacy assets independently verified on Coinbase or Kraken retain
  their existing SVGs.

Brand marks belong to their respective owners. Desktop copies this directory to
`main/assets/`. The backend reads metadata once and requested images on demand;
there are no runtime downloads. Unreferenced images are not shipped.
