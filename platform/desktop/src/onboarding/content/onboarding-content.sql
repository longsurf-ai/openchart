-- Curated English onboarding content; no account data or execution state.
-- Written against onboarding-content-schema.sql, then upgraded by normal application migrations.

INSERT INTO "workspace" ("id", "revision", "created_at", "updated_at", "root")
VALUES (
  'wsp_88DzUWSvACBqXQ',
  1,
  1790640000000,
  1790640000000,
  onboarding_workspace_root()
);

INSERT INTO "dashboard" ("id", "revision", "created_at", "updated_at", "name", "favorite")
VALUES (
  'dsh_88JOx0yX7TH65p',
  1,
  1790318372207,
  1790318403216,
  'Bitcoin',
  0
);

INSERT INTO "chart" ("id", "revision", "created_at", "updated_at", "dashboard_id", "preset")
VALUES (
  'cht_88JOxucrF44TCe',
  1,
  1790318385577,
  1790655042269,
  'dsh_88JOx0yX7TH65p',
  '1'
);

INSERT INTO "chart_cell" ("id", "chart_id", "position", "resolution", "session", "adjustment")
VALUES (
  'ccl_muglcbdx',
  'cht_88JOxucrF44TCe',
  0,
  '1d',
  '24h',
  'raw'
);

INSERT INTO "chart_market_source" ("id", "cell_id", "position", "provider", "listing")
VALUES (
  'cms_muglcbdx',
  'ccl_muglcbdx',
  0,
  'binance',
  '{"symbol":"BTCUSDT","name":"BTC / USDT","class":"crypto","venue":"Binance","currency":"USDT"}'
);

INSERT INTO "chart_pane" ("id", "cell_id", "position")
VALUES (
  'cpn_muglcbdx',
  'ccl_muglcbdx',
  0
);

INSERT INTO "chart_pane" ("id", "cell_id", "position")
VALUES (
  'cpn_88OhWL4NIU2sOw',
  'ccl_muglcbdx',
  1
);

INSERT INTO "indicator" ("id", "revision", "created_at", "updated_at", "chart_id", "cell_id", "workspace_id", "script_path", "snapshot", "parameter_overrides")
VALUES (
  'ind_88OhWL4LDeh8C8',
  1,
  1790621813265,
  1790621813265,
  'cht_88JOxucrF44TCe',
  'ccl_muglcbdx',
  'wsp_88DzUWSvACBqXQ',
  'indicators/builtin/rsi.tea',
  '{"indicators/builtin/rsi.tea":"// @indicator {\"title\": \"RSI\", \"overlay\": false}\nsource = input.source(close, \"Source\")\nlength = input.int(14, \"Length\", minval = 1, maxval = 500)\nplot(\"value\", ta.rsi(source, length), \"Value\")\n"}',
  '{}'
);

INSERT INTO "chart_series" ("id", "cell_id", "pane_id", "position", "role", "market_source_id", "indicator_id", "output")
VALUES (
  'csr_88OhWL4MBCBZ5C',
  'ccl_muglcbdx',
  'cpn_88OhWL4NIU2sOw',
  0,
  'normal',
  NULL,
  'ind_88OhWL4LDeh8C8',
  'value'
);

INSERT INTO "chart_series" ("id", "cell_id", "pane_id", "position", "role", "market_source_id", "indicator_id", "output")
VALUES (
  'csr_muglcbdx',
  'ccl_muglcbdx',
  'cpn_muglcbdx',
  0,
  'main',
  'cms_muglcbdx',
  NULL,
  'price'
);

INSERT INTO "dashboard_widget" ("id", "dashboard_id", "position", "kind", "resource_id", "x", "y", "w", "h")
VALUES (
  'wdg_muglcbdx',
  'dsh_88JOx0yX7TH65p',
  0,
  'chart',
  'cht_88JOxucrF44TCe',
  0,
  0,
  12,
  24
);

INSERT INTO "drawing" ("id", "revision", "created_at", "updated_at", "dashboard_id", "provider", "listing", "data")
VALUES (
  'drw_88Ok2tkHEFFs02',
  1,
  1790624145294,
  1790624145294,
  'dsh_88JOx0yX7TH65p',
  'binance',
  '{"symbol":"BTCUSDT","name":"BTC / USDT","class":"crypto","venue":"Binance","currency":"USDT"}',
  '{
  "id": "9cc38473-08eb-498a-86ce-dc50c2f4e698",
  "type": "agent_session",
  "anchors": [],
  "style": {
    "lineColor": "174 86% 62%",
    "lineWidth": 1,
    "lineStyle": "solid",
    "textColor": "#000000",
    "fontSize": 12,
    "opacity": 1,
    "startCap": "none",
    "endCap": "none",
    "middlePoint": false,
    "priceLabels": false
  },
  "locked": true,
  "hidden": false,
  "range": {
    "from": 1730332800000,
    "to": 1790380800000
  }
}'
);

INSERT INTO "drawing" ("id", "revision", "created_at", "updated_at", "dashboard_id", "provider", "listing", "data")
VALUES (
  'drw_88Ok5dFkYhbREX',
  1,
  1790624186018,
  1790625589560,
  'dsh_88JOx0yX7TH65p',
  'binance',
  '{"symbol":"BTCUSDT","name":"BTC / USDT","class":"crypto","venue":"Binance","currency":"USDT"}',
  '{
  "id": "chart-explain:9cc38473-08eb-498a-86ce-dc50c2f4e698:event:https://www.ap.org/the-definitive-source/behind-the-news/calling-the-2024-presidential-race-state-by-state/",
  "type": "annotation",
  "anchors": [],
  "style": {
    "lineColor": "#000000",
    "lineWidth": 1,
    "lineStyle": "solid",
    "textColor": "#000000",
    "fontSize": 12,
    "opacity": 1,
    "startCap": "none",
    "endCap": "none",
    "middlePoint": false,
    "priceLabels": false
  },
  "locked": false,
  "hidden": false,
  "time": 1730889240,
  "labelAnchor": {
    "time": 1743832829.4748335,
    "price": 57837.7138112498,
    "axisId": "right"
  },
  "title": "AP calls the U.S. election for Trump",
  "body": "On November 6, 2024, at 05:34 Eastern (10:34 UTC), AP called the presidential election for Donald Trump. Contemporary Reuters reporting linked Bitcoin strength to expectations of a more supportive crypto policy. The rally began before the formal call, so the announcement cannot explain the entire move; policy expectations were not yet implemented policy.",
  "sources": [
    {
      "title": "Calling the 2024 presidential race state by state — AP",
      "url": "https://www.ap.org/the-definitive-source/behind-the-news/calling-the-2024-presidential-race-state-by-state/"
    },
    {
      "title": "Bitcoin leaps to record high as traders lean towards Trump victory — Reuters",
      "url": "https://theprint.in/tech/bitcoin-leaps-to-record-high-as-traders-lean-towards-trump-victory/2343665/"
    },
    {
      "title": "Bitcoin jumps to record as Trump''s election turbocharges cryptocurrencies — Reuters",
      "url": "https://theprint.in/tech/bitcoin-jumps-to-record-as-trumps-election-turbocharges-cryptocurrencies/2351589/"
    }
  ],
  "sentiment": 1
}'
);

INSERT INTO "drawing" ("id", "revision", "created_at", "updated_at", "dashboard_id", "provider", "listing", "data")
VALUES (
  'drw_88Ok8CPp42EYAo',
  1,
  1790624224257,
  1790624224257,
  'dsh_88JOx0yX7TH65p',
  'binance',
  '{"symbol":"BTCUSDT","name":"BTC / USDT","class":"crypto","venue":"Binance","currency":"USDT"}',
  '{
  "id": "chart-explain:9cc38473-08eb-498a-86ce-dc50c2f4e698:event:https://www.investing.com/news/stock-market-news/us-treasury-secretary-says-situation-with-china-is-unsustainable-source-says-3996605",
  "type": "annotation",
  "anchors": [],
  "style": {
    "lineColor": "#000000",
    "lineWidth": 1,
    "lineStyle": "solid",
    "textColor": "#000000",
    "fontSize": 12,
    "opacity": 1,
    "startCap": "none",
    "endCap": "none",
    "middlePoint": false,
    "priceLabels": false
  },
  "locked": false,
  "hidden": false,
  "time": 1745280000,
  "title": "Bessent expects U.S.–China trade tensions to ease",
  "body": "On April 22, 2025, Treasury Secretary Scott Bessent described the U.S.–China tariff standoff as unsustainable at a private investor meeting. Reuters and AP reported the remarks that day, while formal talks had not started. Contemporary CoinDesk coverage linked Bitcoin strength to improving trade expectations. This was a change in expectations, not an announced tariff reduction, and other flows may also have contributed. The marker uses the public reporting date; the first publication minute is unconfirmed.",
  "sources": [
    {
      "title": "US Treasury Secretary says situation with China is unsustainable, source says — Reuters",
      "url": "https://www.investing.com/news/stock-market-news/us-treasury-secretary-says-situation-with-china-is-unsustainable-source-says-3996605"
    },
    {
      "title": "US Treasury secretary says trade war with China is not sustainable — AP",
      "url": "https://apnews.com/article/66668fa26957ece530a250fa8ea19faa"
    },
    {
      "title": "Bitcoin Tops $93K as Trump''s U.S-China Tariff Optimism Fuels Crypto Rally — CoinDesk",
      "url": "https://www.coindesk.com/markets/2025/04/22/bitcoin-tops-usd91k-as-trade-optimism-fuels-crypto-rally-but-demand-headwinds-remain"
    }
  ],
  "sentiment": 1
}'
);

INSERT INTO "drawing" ("id", "revision", "created_at", "updated_at", "dashboard_id", "provider", "listing", "data")
VALUES (
  'drw_88Ok9qjJ7ebTHl',
  1,
  1790624248838,
  1790625353946,
  'dsh_88JOx0yX7TH65p',
  'binance',
  '{"symbol":"BTCUSDT","name":"BTC / USDT","class":"crypto","venue":"Binance","currency":"USDT"}',
  '{
  "id": "chart-explain:9cc38473-08eb-498a-86ce-dc50c2f4e698:event:https://www.gov.uk/government/news/landmark-economic-deal-with-united-states-saves-thousands-of-jobs-for-british-car-makers-and-steel-industry",
  "type": "annotation",
  "anchors": [],
  "style": {
    "lineColor": "#000000",
    "lineWidth": 1,
    "lineStyle": "solid",
    "textColor": "#000000",
    "fontSize": 12,
    "opacity": 1,
    "startCap": "none",
    "endCap": "none",
    "middlePoint": false,
    "priceLabels": false
  },
  "locked": false,
  "hidden": false,
  "time": 1746662400,
  "labelAnchor": {
    "time": 1757382983.0924304,
    "price": 89136.38363288104,
    "axisId": "right"
  },
  "title": "U.S. and UK announce a trade framework",
  "body": "On May 8, 2025, Donald Trump and Keir Starmer announced a U.S.–UK trade framework. The UK government published the agreement that day. Reuters linked Bitcoin strength to the deal and hopes of easing trade friction, consistent with the nearby daily advance. The agreement did not eliminate all tariffs and cannot by itself explain the surrounding weeks. Time is recorded at date precision.",
  "sources": [
    {
      "title": "Landmark economic deal with United States saves thousands of jobs for British car makers and steel industry — GOV.UK",
      "url": "https://www.gov.uk/government/news/landmark-economic-deal-with-united-states-saves-thousands-of-jobs-for-british-car-makers-and-steel-industry"
    },
    {
      "title": "Bitcoin tops $100,000 on trade deal optimism — Reuters",
      "url": "https://www.investing.com/news/forex-news/bitcoin-tops-100000-on-trade-deal-optimism-4033755"
    },
    {
      "title": "What''s in the US-UK trade deal? A broad agreement with limited details — AP",
      "url": "https://apnews.com/article/f65fb13f17cfc14d0b5b8d267953d5c4"
    }
  ],
  "sentiment": 1
}'
);

INSERT INTO "drawing" ("id", "revision", "created_at", "updated_at", "dashboard_id", "provider", "listing", "data")
VALUES (
  'drw_88OkBhCOrDXeYk',
  1,
  1790624276339,
  1790654893506,
  'dsh_88JOx0yX7TH65p',
  'binance',
  '{"symbol":"BTCUSDT","name":"BTC / USDT","class":"crypto","venue":"Binance","currency":"USDT"}',
  '{
  "id": "chart-explain:9cc38473-08eb-498a-86ce-dc50c2f4e698:event:https://www.dailypress.senate.gov/monday-may-19-2025/",
  "type": "annotation",
  "anchors": [],
  "style": {
    "lineColor": "#000000",
    "lineWidth": 1,
    "lineStyle": "solid",
    "textColor": "#000000",
    "fontSize": 12,
    "opacity": 1,
    "startCap": "none",
    "endCap": "none",
    "middlePoint": false,
    "priceLabels": false
  },
  "locked": false,
  "hidden": false,
  "time": 1747704360,
  "labelAnchor": {
    "time": 1745528141.6015625,
    "price": 115794.30213917056,
    "axisId": "right"
  },
  "title": "U.S. Senate advances the GENIUS stablecoin bill",
  "body": "On May 19, 2025, the Senate voted 66–32 to invoke cloture on the motion to proceed to the GENIUS Act. The Senate press gallery recorded the result at 21:26 Eastern (May 20, 01:26 UTC). This procedural vote did not enact the bill. Contemporary Bloomberg coverage linked Bitcoin strength to expectations of clearer crypto regulation. It may explain part of the nearby May 20–22 move, but not gains before the vote or the full rally.",
  "sources": [
    {
      "title": "Monday, May 19, 2025 — U.S. Senate Daily Press",
      "url": "https://www.dailypress.senate.gov/monday-may-19-2025/"
    },
    {
      "title": "Senate advances legislation to regulate stablecoins, a form of cryptocurrency — AP",
      "url": "https://apnews.com/article/5b551cf99c288c4f6059ed1689d6fcb4"
    },
    {
      "title": "Bitcoin Touches Record High on Optimism Around US Regulations — Bloomberg",
      "url": "https://news.bloomberglaw.com/capital-markets/bitcoin-rises-to-record-on-optimism-around-us-regulations"
    }
  ],
  "sentiment": 1
}'
);

INSERT INTO "drawing" ("id", "revision", "created_at", "updated_at", "dashboard_id", "provider", "listing", "data")
VALUES (
  'drw_88OkDRmGRWTJDA',
  1,
  1790624302425,
  1790654904064,
  'dsh_88JOx0yX7TH65p',
  'binance',
  '{"symbol":"BTCUSDT","name":"BTC / USDT","class":"crypto","venue":"Binance","currency":"USDT"}',
  '{
  "id": "chart-explain:9cc38473-08eb-498a-86ce-dc50c2f4e698:event:https://apnews.com/article/4ad99ea3975a8b62d37bd04961feda55",
  "type": "annotation",
  "anchors": [],
  "style": {
    "lineColor": "#000000",
    "lineWidth": 1,
    "lineStyle": "solid",
    "textColor": "#000000",
    "fontSize": 12,
    "opacity": 1,
    "startCap": "none",
    "endCap": "none",
    "middlePoint": false,
    "priceLabels": false
  },
  "locked": false,
  "hidden": false,
  "time": 1768608000,
  "labelAnchor": {
    "time": 1774828800,
    "price": 118190.76306897875,
    "axisId": "right"
  },
  "title": "Trump threatens tariffs over Greenland",
  "body": "On January 17, 2026, Trump threatened 10% tariffs from February on eight European countries, tying the proposal to U.S. control of Greenland. AP reported the threat that day. CoinDesk and Reuters coverage on January 19–20 linked weaker crypto and risk assets to U.S.–Europe trade tensions. The marker records the public announcement, not implemented tariffs, and does not explain the entire decline into February.",
  "sources": [
    {
      "title": "Trump says 8 European countries will face 10% tariff for opposing US control of Greenland — AP",
      "url": "https://apnews.com/article/4ad99ea3975a8b62d37bd04961feda55"
    },
    {
      "title": "As tariff threat hits bitcoin, invisible hands may amplify swings — CoinDesk",
      "url": "https://www.coindesk.com/daybook-us/2026/01/20/as-tariff-threat-hits-bitcoin-invisible-hands-may-amplify-swings-crypto-daybook-americas"
    },
    {
      "title": "Wall Street posts biggest daily drop in three months, Trump Greenland tariff threat triggers wide selloff — Reuters",
      "url": "https://www.investing.com/news/stock-market-news/sp-nasdaq-futures-slide-to-onemonth-lows-on-greenland-concerns-4454381"
    }
  ],
  "sentiment": -1
}'
);

INSERT INTO "drawing" ("id", "revision", "created_at", "updated_at", "dashboard_id", "provider", "listing", "data")
VALUES (
  'drw_88OkFHgyIkPpRf',
  1,
  1790624329793,
  1790624329793,
  'dsh_88JOx0yX7TH65p',
  'binance',
  '{"symbol":"BTCUSDT","name":"BTC / USDT","class":"crypto","venue":"Binance","currency":"USDT"}',
  '{
  "id": "chart-explain:9cc38473-08eb-498a-86ce-dc50c2f4e698:event:https://www.whitehouse.gov/releases/2026/01/wide-acclaim-for-president-trumps-nomination-of-kevin-warsh-as-fed-chair/",
  "type": "annotation",
  "anchors": [],
  "style": {
    "lineColor": "#000000",
    "lineWidth": 1,
    "lineStyle": "solid",
    "textColor": "#000000",
    "fontSize": 12,
    "opacity": 1,
    "startCap": "none",
    "endCap": "none",
    "middlePoint": false,
    "priceLabels": false
  },
  "locked": false,
  "hidden": false,
  "time": 1769731200,
  "title": "Trump selects Kevin Warsh to lead the Fed",
  "body": "On January 30, 2026, Trump announced Kevin Warsh as his choice for the next Federal Reserve chair, with White House confirmation that day. Reuters had already linked speculation about Warsh and his balance-sheet views to crypto liquidity concerns before the announcement. This concerns tighter liquidity expectations, not an actual policy change. The decline began earlier and overlapped with other risk-asset pressure; the announcement cannot explain the whole January–February selloff. Time is recorded at date precision.",
  "sources": [
    {
      "title": "Wide Acclaim for President Trump''s Nomination of Kevin Warsh as Fed Chair — White House",
      "url": "https://www.whitehouse.gov/releases/2026/01/wide-acclaim-for-president-trumps-nomination-of-kevin-warsh-as-fed-chair/"
    },
    {
      "title": "Bitcoin slips as Fed chair speculation hits risky assets — Reuters",
      "url": "https://www.investing.com/news/economy-news/bitcoin-slips-as-fed-chair-speculation-hits-risky-assets-4475101"
    },
    {
      "title": "Bitcoin Falls Below $80,000, Continuing Decline As Liquidity Worries Mount — Reuters",
      "url": "https://www.itiger.com/news/2608077423"
    }
  ],
  "sentiment": -1
}'
);

INSERT INTO "drawing" ("id", "revision", "created_at", "updated_at", "dashboard_id", "provider", "listing", "data")
VALUES (
  'drw_88OkIglNxSAEP0',
  1,
  1790624380503,
  1790655050892,
  'dsh_88JOx0yX7TH65p',
  'binance',
  '{"symbol":"BTCUSDT","name":"BTC / USDT","class":"crypto","venue":"Binance","currency":"USDT"}',
  '{
  "id": "chart-explain:9cc38473-08eb-498a-86ce-dc50c2f4e698:event:https://home.treasury.gov/news/press-releases/sb0607",
  "type": "annotation",
  "anchors": [],
  "style": {
    "lineColor": "#000000",
    "lineWidth": 1,
    "lineStyle": "solid",
    "textColor": "#000000",
    "fontSize": 12,
    "opacity": 1,
    "startCap": "none",
    "endCap": "none",
    "middlePoint": false,
    "priceLabels": false
  },
  "locked": false,
  "hidden": false,
  "time": 1787097600,
  "labelAnchor": {
    "time": 1769515200,
    "price": 65817.58919904352,
    "axisId": "right"
  },
  "title": "U.S. Treasury expands long-bond buybacks",
  "body": "On August 19, 2026, the Treasury announced that the per-operation cap for long-end nominal liquidity-support buybacks would rise from $2 billion to at least $4 billion, effective September 9 through November 4. Contemporary Reuters coverage linked Bitcoin strength to lower long-term yields and a softer dollar; CoinDesk also highlighted short covering. This offers context for August 19–21, but reflects expectations after an announcement rather than immediate purchases. Treasury buybacks are not Federal Reserve quantitative easing and cannot explain the entire rally.",
  "sources": [
    {
      "title": "Treasury Announces Increased Sizes of Nominal Long-End Liquidity Support Buybacks Beginning September 9 — U.S. Treasury",
      "url": "https://home.treasury.gov/news/press-releases/sb0607"
    },
    {
      "title": "Trading Day: Bessent makes his mark — Reuters market commentary",
      "url": "https://ca.investing.com/news/economy-news/trading-day-bessent-makes-his-mark-4808924"
    },
    {
      "title": "Bitcoin rises above $80,000 as soft dollar, debasement fears boost momentum — Reuters",
      "url": "https://ca.investing.com/news/economy-news/bitcoin-rises-above-80000-as-soft-dollar-debasement-fears-boost-momentum-4814925"
    },
    {
      "title": "Bitcoin surged 25% from $64,000 to $78,500 after a Treasury tweak. Here''s why — CoinDesk",
      "url": "https://www.coindesk.com/markets/2026/08/22/how-a-treasury-buyback-tweak-helped-bitcoin-surge-nearly-25-in-days"
    }
  ],
  "sentiment": 1
}'
);

INSERT INTO "drawing" ("id", "revision", "created_at", "updated_at", "dashboard_id", "provider", "listing", "data")
VALUES (
  'drw_88OkLhjAkb1OsW',
  1,
  1790624425421,
  1790625363880,
  'dsh_88JOx0yX7TH65p',
  'binance',
  '{"symbol":"BTCUSDT","name":"BTC / USDT","class":"crypto","venue":"Binance","currency":"USDT"}',
  '{
  "id": "chart-explain:9cc38473-08eb-498a-86ce-dc50c2f4e698:event:https://rollcall.com/factbase/trump/transcript/donald-trump-remarks-technology-leaders-white-house-august-19-2026/",
  "type": "annotation",
  "anchors": [],
  "style": {
    "lineColor": "#000000",
    "lineWidth": 1,
    "lineStyle": "solid",
    "textColor": "#000000",
    "fontSize": 12,
    "opacity": 1,
    "startCap": "none",
    "endCap": "none",
    "middlePoint": false,
    "priceLabels": false
  },
  "locked": false,
  "hidden": false,
  "time": 1787097600,
  "labelAnchor": {
    "time": 1813084467.1875,
    "price": 54461.133524712226,
    "axisId": "right"
  },
  "title": "Trump urges Congress to pass the CLARITY Act",
  "body": "On the afternoon of August 19, 2026, Trump urged Congress to pass the CLARITY Act during a public White House meeting with technology and crypto leaders. A transcript and pool reports recorded the remarks; Reuters reported subsequent Bitcoin and crypto-stock strength on August 20. The bill was still stalled in the Senate, so the remarks did not mean it had passed. The Treasury buyback announcement overlapped on the same day, making their individual effects difficult to separate. The marker uses the public date and cannot explain gains before the remarks.",
  "sources": [
    {
      "title": "Remarks: Donald Trump Speaks to Technology Leaders at the White House — August 19, 2026 — Roll Call / Factba.se",
      "url": "https://rollcall.com/factbase/trump/transcript/donald-trump-remarks-technology-leaders-white-house-august-19-2026/"
    },
    {
      "title": "Pool Reports of August 19, 2026 — American Presidency Project",
      "url": "https://www.presidency.ucsb.edu/documents/pool-reports-august-19-2026"
    },
    {
      "title": "Bitcoin, crypto shares climb after Trump pushes Clarity Act — Reuters",
      "url": "https://www.marketscreener.com/news/bitcoin-crypto-shares-climb-after-trump-pushes-clarity-act-ce7859d3d881f525"
    }
  ],
  "sentiment": 1
}'
);

INSERT INTO "drawing" ("id", "revision", "created_at", "updated_at", "dashboard_id", "provider", "listing", "data")
VALUES (
  'drw_88Olh0Ak3m45bE',
  1,
  1790625666179,
  1790654902537,
  'dsh_88JOx0yX7TH65p',
  'binance',
  '{"symbol":"BTCUSDT","name":"BTC / USDT","class":"crypto","venue":"Binance","currency":"USDT"}',
  '{
  "id": "chart-explain:9cc38473-08eb-498a-86ce-dc50c2f4e698:event:https://www.sec.gov/files/rules/exorders/2026/34-106402.pdf",
  "type": "annotation",
  "anchors": [],
  "style": {
    "lineColor": "#000000",
    "lineWidth": 1,
    "lineStyle": "solid",
    "textColor": "#000000",
    "fontSize": 12,
    "opacity": 1,
    "startCap": "none",
    "endCap": "none",
    "middlePoint": false,
    "priceLabels": false
  },
  "locked": false,
  "hidden": false,
  "time": 1789603200,
  "labelAnchor": {
    "time": 1783468800,
    "price": 104988.04152246728,
    "axisId": "right"
  },
  "title": "SEC grants a conditional tokenized-stock exemption",
  "body": "On September 17, 2026, the SEC issued a conditional exemption allowing qualifying platforms to trade tokenized U.S. stocks using automated market makers, effective immediately through September 17, 2031. This was an SEC action, not congressional passage of the CLARITY Act. Contemporary coverage associated the policy with improved crypto sentiment ahead of the September 18–21 advance, alongside short covering and spot demand. It is a possible indirect catalyst for Bitcoin, not a complete explanation. Potential benefits to Robinhood were expectations, not realized earnings or blanket approval of its existing products. Time is recorded at date precision.",
  "sources": [
    {
      "title": "SEC Release No. 34-106402: Temporary, Conditional Exemptions for Tokenized NMS Stock Trading",
      "url": "https://www.sec.gov/files/rules/exorders/2026/34-106402.pdf"
    },
    {
      "title": "Bitcoin surges to over 7-month high as tokenized-stock move lifts crypto sentiment — Investing.com (September 21, 2026)",
      "url": "https://uk.investing.com/news/cryptocurrency-news/bitcoin-climbs-toward-82k-as-tokenizedstock-move-boosts-crypto-sentiment-4875425"
    },
    {
      "title": "Bitcoin jumps above $81k as short squeeze offsets rate and regulatory pressure — Investing.com (September 18, 2026)",
      "url": "https://www.investing.com/news/cryptocurrency-news/bitcoin-junters-above-81k-as-short-squeeze-offsets-rate-and-regulatory-pressure-4908041"
    },
    {
      "title": "Coinbase, Robinhood, Circle could be early winners of SEC''s tokenized-stock push, analysts say — CoinDesk (September 20, 2026)",
      "url": "https://www.coindesk.com/business/2026/09/20/coinbase-robinhood-circle-could-be-early-winners-of-sec-s-tokenized-stock-push-analysts-say"
    }
  ],
  "sentiment": 1
}'
);

INSERT INTO "drawing" ("id", "revision", "created_at", "updated_at", "dashboard_id", "provider", "listing", "data")
VALUES (
  'drw_88PJ1VybVTwnxW',
  1,
  1790656447923,
  1790656447923,
  'dsh_88JOx0yX7TH65p',
  'binance',
  '{"symbol":"BTCUSDT","name":"BTC / USDT","class":"crypto","venue":"Binance","currency":"USDT"}',
  '{
  "id": "95ced1c4-b640-4f52-9efc-4d3c9bf75f1c",
  "type": "ray",
  "anchors": [
    {
      "time": 1761264000,
      "price": 110034.31519421862,
      "axisId": "right"
    },
    {
      "time": 1776124800,
      "price": 86400.36234869016,
      "axisId": "right"
    }
  ],
  "style": {
    "lineColor": "#ffffff",
    "lineWidth": 1,
    "lineStyle": "solid",
    "textColor": "#ffffff",
    "fontSize": 12,
    "opacity": 1,
    "startCap": "none",
    "endCap": "none",
    "middlePoint": false,
    "priceLabels": false
  },
  "locked": false,
  "hidden": false
}'
);

INSERT INTO "alert_rule" ("id", "revision", "created_at", "updated_at", "name", "enabled", "repeat", "alertable_json")
VALUES (
  'alr_88PH5QdFSkCg4R',
  1,
  1790654659179,
  1790654659179,
  'BTC crosses $90,000',
  1,
  0,
  '{
  "kind": "tea",
  "source": "import ta\nop = input.string(\"greater_than\", \"Operator\", [\"crossing\", \"crossing_up\", \"crossing_down\", \"greater_than\", \"less_than\", \"entering_channel\", \"exiting_channel\", \"inside_channel\", \"outside_channel\", \"moving_up\", \"moving_down\", \"moving_up_percent\", \"moving_down_percent\"])\nthreshold = input.float(0.0, \"Threshold\")\nlower = input.float(0.0, \"Lower bound\")\nupper = input.float(1.0, \"Upper bound\")\namount = input.float(1.0, \"Change\", minval = 0.0)\nbars = input.int(1, \"Bars\", minval = 1)\nvalue = close\nprevious = value[1]\ncrossing_up = not na(previous) and previous < threshold and value >= threshold\ncrossing_down = not na(previous) and previous > threshold and value <= threshold\ncrossing = crossing_up or crossing_down\ngreater_than = value > threshold\nless_than = value < threshold\nchannel_valid = lower < upper\ninside_channel = channel_valid and value > lower and value < upper\noutside_channel = channel_valid and (value < lower or value > upper)\nentering_channel = channel_valid and not na(previous) and (previous < lower or previous > upper) and value >= lower and value <= upper\nexiting_channel = channel_valid and not na(previous) and previous >= lower and previous <= upper and outside_channel\nchange = ta.change(value, bars)\npercent = value[bars] == 0 ? na : ta.roc(value, bars)\nmoving_up = amount > 0 and change >= amount\nmoving_down = amount > 0 and change <= -amount\nmoving_up_percent = amount > 0 and percent >= amount\nmoving_down_percent = amount > 0 and percent <= -amount\ncondition = op == \"crossing\" ? crossing : op == \"crossing_up\" ? crossing_up : op == \"crossing_down\" ? crossing_down : op == \"greater_than\" ? greater_than : op == \"less_than\" ? less_than : op == \"entering_channel\" ? entering_channel : op == \"exiting_channel\" ? exiting_channel : op == \"inside_channel\" ? inside_channel : op == \"outside_channel\" ? outside_channel : op == \"moving_up\" ? moving_up : op == \"moving_down\" ? moving_down : op == \"moving_up_percent\" ? moving_up_percent : op == \"moving_down_percent\" ? moving_down_percent : false\nemit \"value\" value\nalertcondition(\"alert\", condition, \"Price\", \"Price met its condition\")",
  "config": {
    "parameters": {
      "threshold": 90000,
      "lower": 0,
      "upper": 1,
      "amount": 1,
      "bars": 1,
      "op": "crossing"
    },
    "inputs": {
      "provider": "binance",
      "listing": {
        "symbol": "BTCUSDT",
        "name": "BTC / USDT",
        "class": "crypto",
        "venue": "Binance",
        "currency": "USDT"
      },
      "resolution": "1d",
      "session": "24h",
      "adjustment": "raw"
    },
    "requests": {}
  }
}'
);

INSERT INTO "alert_rule" ("id", "revision", "created_at", "updated_at", "name", "enabled", "repeat", "alertable_json")
VALUES (
  'alr_88PJ36VVUmJn4G',
  1,
  1790656471595,
  1790656471595,
  'BTCUSDT Price Crossing ray',
  1,
  0,
  '{
  "kind": "drawing",
  "drawingId": "drw_88PJ1VybVTwnxW",
  "operator": "crossing",
  "inputs": {
    "provider": "binance",
    "listing": {
      "symbol": "BTCUSDT",
      "name": "BTC / USDT",
      "class": "crypto",
      "venue": "Binance",
      "currency": "USDT"
    },
    "resolution": "1d",
    "session": "24h",
    "adjustment": "raw"
  }
}'
);

INSERT INTO "trigger" ("id", "revision", "created_at", "updated_at", "name", "enabled", "event_json", "target_json")
VALUES (
  'trg_88PH5QdVas0hOh',
  1,
  1790640000000,
  1790640000000,
  'BTC $90,000 notification',
  1,
  '{
  "kind": "alert",
  "ruleId": "alr_88PH5QdFSkCg4R"
}',
  '{
  "kind": "notification",
  "message": "BTCUSDT crossed $90,000. Observed price: {value}."
}'
);

INSERT INTO "trigger" ("id", "revision", "created_at", "updated_at", "name", "enabled", "event_json", "target_json")
VALUES (
  'trg_onboardingBtcResearch',
  1,
  1790640000000,
  1790640000000,
  'Explain the BTC $90,000 crossing',
  1,
  '{
  "kind": "alert",
  "ruleId": "alr_88PH5QdFSkCg4R"
}',
  '{
  "kind": "agent_prompt",
  "prompt": {
    "agent": "analyst",
    "workspaceId": "wsp_88DzUWSvACBqXQ",
    "model": {
      "providerID": "codex",
      "modelID": "tier4"
    },
    "parts": [
      {
        "type": "text",
        "text": "BTCUSDT crossed $90,000. Review the triggering event: {rule}; bar time {time}; observed price {value}. Confirm the crossing direction, timestamp and current price, then explain relevant news, volume and RSI (14). Distinguish verified facts from possible causes and include source links. Read the prior chart explanation in session ses_rrbFx6CsSf2Xk8 and the Bitcoin dashboard dsh_88JOx0yX7TH65p for context. Give a concise English update with what would confirm or weaken the move. This is research, not an instruction to trade."
      }
    ]
  }
}'
);

INSERT INTO "trigger" ("id", "revision", "created_at", "updated_at", "name", "enabled", "event_json", "target_json")
VALUES (
  'trg_88PJ36VWSVX1cR',
  1,
  1790656471595,
  1790656471595,
  'BTCUSDT Price Crossing ray',
  1,
  '{
  "kind": "alert",
  "ruleId": "alr_88PJ36VVUmJn4G"
}',
  '{
  "kind": "notification",
  "message": "{symbol} {title}: {value}"
}'
);

INSERT INTO "trigger" ("id", "revision", "created_at", "updated_at", "name", "enabled", "event_json", "target_json")
VALUES (
  'trg_88PJ36VXyWjsaK',
  1,
  1790656471595,
  1790656471595,
  'BTCUSDT Price Crossing ray',
  1,
  '{
  "kind": "alert",
  "ruleId": "alr_88PJ36VVUmJn4G"
}',
  '{
  "kind": "agent_prompt",
  "prompt": {
    "agent": "analyst",
    "workspaceId": "wsp_88DzUWSvACBqXQ",
    "parts": [
      {
        "type": "workflow",
        "workflow": "default:workflows/multi-angle-research.workflow.ts",
        "args": {
          "question": "should I buy bitcoin right now"
        }
      }
    ],
    "model": {
      "providerID": "codex",
      "modelID": "tier4"
    }
  }
}'
);

INSERT INTO "agent_session_bindings" ("id", "key", "created_at", "updated_at")
VALUES (
  'asb_88Ok2tmrH7P61U',
  'drawing:drw_88Ok2tkHEFFs02',
  1790624145305,
  1790624145305
);

INSERT INTO "agent_sessions" ("id", "parent_id", "kind", "binding_id", "anchors", "title", "compacting_at", "archived_at", "created_at", "updated_at")
VALUES (
  'ses_rrbFx6CsSf2Xk8',
  NULL,
  'chart_explain',
  'asb_88Ok2tmrH7P61U',
  NULL,
  'Explain BTCUSDT and watch $90,000',
  NULL,
  NULL,
  1790624145305,
  1790640003000
);

INSERT INTO "agent_messages" ("id", "session_id", "role", "data", "created_at", "updated_at")
VALUES (
  'msg_88Ok2tyjNlPwRa',
  'ses_rrbFx6CsSf2Xk8',
  'user',
  '{
  "time": {
    "created": 1790640000000
  },
  "agent": "analyst",
  "model": {
    "providerID": "codex",
    "modelID": "tier4"
  },
  "workspaceId": "wsp_88DzUWSvACBqXQ"
}',
  1790640000000,
  1790640000500
);

INSERT INTO "agent_parts" ("id", "message_id", "data", "created_at", "updated_at")
VALUES (
  'prt_onboardingSelection',
  'msg_88Ok2tyjNlPwRa',
  '{
  "type": "plugin_input",
  "input": {
    "type": "chart_explain",
    "drawingId": "drw_88Ok2tkHEFFs02",
    "resolution": "1d",
    "session": "24h",
    "adjustment": "raw"
  }
}',
  1790640000000,
  1790640000000
);

INSERT INTO "agent_parts" ("id", "message_id", "data", "created_at", "updated_at")
VALUES (
  'prt_onboardingQuestion',
  'msg_88Ok2tyjNlPwRa',
  '{
  "type": "text",
  "text": "Explain the major moves in this BTCUSDT selection and annotate the key events."
}',
  1790640000001,
  1790640000001
);

INSERT INTO "agent_messages" ("id", "session_id", "role", "data", "created_at", "updated_at")
VALUES (
  'msg_88Ok2w53uEfL3b',
  'ses_rrbFx6CsSf2Xk8',
  'assistant',
  json_set('{
  "time": {
    "created": 1790640001000,
    "completed": 1790640001500
  },
  "agent": "analyst",
  "triggeringUserMessageID": "msg_88Ok2tyjNlPwRa",
  "modelID": "tier4",
  "providerID": "codex",
  "path": {
    "cwd": "",
    "root": ""
  },
  "cost": 0,
  "tokens": {
    "input": 0,
    "output": 0,
    "reasoning": 0,
    "cache": {
      "read": 0,
      "write": 0
    }
  },
  "finish": "stop"
}', '$.path.cwd', onboarding_workspace_root(), '$.path.root', onboarding_workspace_root()),
  1790640001000,
  1790640001500
);

INSERT INTO "agent_parts" ("id", "message_id", "data", "created_at", "updated_at")
VALUES (
  'prt_onboardingExplanation',
  'msg_88Ok2w53uEfL3b',
  '{
  "type": "text",
  "text": "I added **9 event annotations** to :resource[Bitcoin]{name=dashboard/dsh_88JOx0yX7TH65p}, with sources, public dates, and limits on what each event can explain.\n\nThe selected daily chart runs from October 31, 2024 to September 26, 2026:\n\n- **November 2024:** expectations for U.S. crypto policy shifted around the presidential election. Bitcoin was already rising before AP called the result.\n- **April–May 2025:** trade-deal expectations and progress on stablecoin legislation coincided with improving risk appetite.\n- **January–February 2026:** tariff tensions and expectations about Federal Reserve leadership contributed to liquidity concerns. They do not explain the entire selloff.\n- **August–September 2026:** Treasury buyback plans and crypto-market policy developments coincided with renewed strength, alongside short covering and spot demand.\n\nOpen any chart annotation to inspect its sources. The annotations distinguish confirmed events from possible price effects; moves without sufficient evidence remain unexplained.\n\n**RSI (14)** is shown below the price chart. It helps you compare momentum across the selected period; a reading alone is not a trading signal."
}',
  1790640001000,
  1790640001000
);

INSERT INTO "agent_messages" ("id", "session_id", "role", "data", "created_at", "updated_at")
VALUES (
  'msg_onboardingAlertRequest',
  'ses_rrbFx6CsSf2Xk8',
  'user',
  '{
  "time": {
    "created": 1790640002000
  },
  "agent": "analyst",
  "model": {
    "providerID": "codex",
    "modelID": "tier4"
  },
  "workspaceId": "wsp_88DzUWSvACBqXQ"
}',
  1790640002000,
  1790640002500
);

INSERT INTO "agent_parts" ("id", "message_id", "data", "created_at", "updated_at")
VALUES (
  'prt_onboardingAlertQuestion',
  'msg_onboardingAlertRequest',
  '{
  "type": "text",
  "text": "Set an alert when BTCUSDT crosses $90,000 in either direction. Notify me and have the agent explain the move."
}',
  1790640002000,
  1790640002000
);

INSERT INTO "agent_messages" ("id", "session_id", "role", "data", "created_at", "updated_at")
VALUES (
  'msg_onboardingAlertResult',
  'ses_rrbFx6CsSf2Xk8',
  'assistant',
  json_set('{
  "time": {
    "created": 1790640003000,
    "completed": 1790640003500
  },
  "agent": "analyst",
  "triggeringUserMessageID": "msg_onboardingAlertRequest",
  "modelID": "tier4",
  "providerID": "codex",
  "path": {
    "cwd": "",
    "root": ""
  },
  "cost": 0,
  "tokens": {
    "input": 0,
    "output": 0,
    "reasoning": 0,
    "cache": {
      "read": 0,
      "write": 0
    }
  },
  "finish": "stop"
}', '$.path.cwd', onboarding_workspace_root(), '$.path.root', onboarding_workspace_root()),
  1790640003000,
  1790640003500
);

INSERT INTO "agent_parts" ("id", "message_id", "data", "created_at", "updated_at")
VALUES (
  'prt_onboardingAlertAnswer',
  'msg_onboardingAlertResult',
  '{
  "type": "text",
  "text": "Saved :resource[BTC crosses $90,000]{name=alert_rule/alr_88PH5QdFSkCg4R}.\n\nIt monitors Binance BTCUSDT using the daily chart and fires once when price crosses $90,000 in either direction. A desktop notification and an Agent research update are attached. The Agent will check the crossing, recent news, volume, and RSI, then publish its explanation.\n\nYou can review the condition and actions from the alert in the sidebar. Connect Codex in Settings → Models to enable the Agent action."
}',
  1790640003000,
  1790640003000
);
