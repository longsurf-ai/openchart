# Logo catalog audit — 2026-09-25

The previous catalog bundled 7,608 entries, mostly arbitrary brand domains. This
revision keeps 1,087 logos: 571 publicly traded issuers and 516 traded crypto
assets. The bundle shrank from 65.2 MiB to about 8.1 MiB. All 30,577 aliases are
explicit in `assets/catalog.json`; every record includes listing evidence.

## Verification sources

- [SEC issuer/ticker/exchange directory](https://www.sec.gov/files/company_tickers_exchange.json):
  US-listed companies and reporting foreign/OTC issuers. Names/domains were
  reviewed before attaching a ticker; a same-name match alone was insufficient.
  US exchange symbols were also cross-checked against the 2026-09-25
  [Nasdaq directory](https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt)
  and [other-exchange directory](https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt),
  retaining native share-class, preferred, warrant and rights spellings.
- [iShares MSCI ACWI holdings](https://www.ishares.com/us/products/239600/ishares-msci-acwi-etf/latest-holdings.csv),
  dated 2026-09-23: home-market listings for international companies. Unlisted
  and suspended Russian holdings were excluded from matching.
- [iShares S&P 100 holdings](https://www.ishares.com/us/products/239723/ishares-s-p-100-etf/latest-holdings.csv),
  dated 2026-09-24: independent coverage baseline. All **101 equity share-class
  tickers** resolve, including both Alphabet share classes. Tests also cover
  **65 leading non-US holdings** from the ACWI snapshot, plus explicit names such
  as Tencent, Samsung, Nestlé, TSMC, LVMH and ASML.
- [Binance spot exchange information](https://data-api.binance.vision/api/v3/exchangeInfo):
  only active spot listings. Current names and logo images came from Binance's
  [asset metadata](https://www.binance.com/bapi/asset/v2/public/asset/asset/get-all-asset).
- [Coinbase products](https://api.exchange.coinbase.com/products) and
  [currency identities](https://api.exchange.coinbase.com/currencies), plus
  [Kraken pairs](https://api.kraken.com/0/public/AssetPairs) and
  [asset identities](https://api.kraken.com/0/public/Assets): verification of
  additional retained crypto assets and alternative/native pair identifiers.

These are dated evidence snapshots, not a live listing-status service. The
coverage baseline is checked in as `large-cap-coverage.json`, outside the shipped
assets. This is not an exhaustive directory of every public company or exchange.

## Corrections and removal policy

All original records were evaluated. Private brands, institutions, unrelated
subsidiary logos, unverified matches and obsolete/mismatched crypto identities
were removed from the bundle. Absence from the selected sources was treated as
insufficient evidence to distribute a logo, **not proof that a company is private
or a token is delisted everywhere**. The user's original logo repository remains
unchanged.

Examples of rejected source-CSV matches include `lucid.app` → Lucid Motors,
`genius.com` → Genius Group, `pandora.com` → Pandora jewelry, `vrtx.com` → Vertex
Inc., and `mplx.com` → Marathon Petroleum. Vertex Pharmaceuticals and MPLX now
have their own verified mappings. Duplicate issuer domains were consolidated
instead of making their shared ticker ambiguous.

Major missing images were added, including Mastercard, AbbVie, Palantir, Costco,
Chevron and many other S&P 100 companies. International coverage includes home
symbols and provider spellings such as `005930.KS`, `0700.HK`, `2330.TW`,
`NESN.SW`, `MC.PA` and `ASML.AS`.

Old crypto ticker/name associations were not blindly retained. Current exchange
images replace collisions/rebrands such as ACT, AMP, ATM, BLZ, ONG and SKY.
Unverified reused tickers such as the old CTR/PRL/BOS/CC/WINGS assets were removed.
NANO/XNO and BTT/BTTC were consolidated into one logo per project. BTC/XBT aliases
resolve to one Bitcoin logo. Historical MATIC and PAX spellings resolve to the
current POL and USDP project logos, following the issuers' documented
[Polygon migration](https://polygon.technology/blog/matic-to-pol-migration-is-now-live-everything-you-need-to-know),
[Pax Dollar rename](https://www.paxos.com/blog/the-digital-dollar-that-always-equals-a-dollar-paxos-standard-pax-is-now-pax-dollar-usdp)
and [Binance BitTorrent ticker convention](https://www.binance.com/en-PH/support/announcement/detail/2722e6da4f5141dd9b2fb07b5b1f3f75).
These are logo aliases, not a claim of price-series or token equivalence.
Every retained crypto has explicit USD and USDT pair aliases,
except meaningless self-pairs; additional actual quote currencies and native
exchange pair spellings are included.

## Ambiguity and safeguards

- `stock:ABT` / `NYSE:ABT` mean Abbott; `crypto:ABT` means Arcblock. Bare `ABT`
  remains ambiguous. Alerts qualify known stock/crypto classes without parsing
  ticker suffixes in the frontend.
- Market collisions still require a market identifier: `NYSE:DTE` is DTE Energy,
  while `XETRA:DTE` / `DTE.DE` is Deutsche Telekom. A class prefix alone cannot
  resolve every international ticker collision.
- Canonical IDs cannot be shadowed by another logo's aliases. For example,
  `crypto:TUSD` identifies TrueUSD, while `crypto:T-USD` identifies Threshold's
  dollar-pair logo.
- Schemas require nonempty listing evidence and safe asset paths. Tests reject
  duplicate IDs and missing evidence, check the independent coverage baseline,
  verify that every shipped image is referenced and readable, and preserve
  failures separately from absent or ambiguous matches.
