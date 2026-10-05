# Charts animation sources

The captures in [square/](square/) come from OpenChart Desktop at commit
`f443b1d`, using an isolated development profile and a native 800 × 800 window.
The interface reflows into that square window; no landscape image is stretched
or letterboxed. They show an ETHUSDT daily chart from Binance in the app's dark
theme, with the sidebar collapsed. The UI was exercised through its actual controls:

1. Open **Indicators**, select **Bollinger Bands** in the Study library, and
   choose **Add to chart**.
2. Open **Chart type** and enable **Volume Profile**.
3. Open **Chart grid** and choose **4 × 4** in the **16** row.

The final native layout contains sixteen different Binance markets, configured
through the app before capture: ETH, BTC, SOL, BNB, XRP, ADA, DOGE, AVAX, LINK,
DOT, LTC, TRX, NEAR, ATOM, SUI, and APT, all quoted in USDT. The existing ETH cell
keeps its indicator and profile. [tickers.json](square/tickers.json) records the
configured symbols and their verified UI labels.

[storyboard.png](storyboard.png) was generated with the built-in Image Generation
tool from these captures. The [generation prompt](storyboard.prompt.txt) and
[correction prompt](storyboard-correction.prompt.txt) preserve the instructions.
The original landscape captures beside the storyboard document its references.
The storyboard supplies the motion sequence and camera direction. Its original
7.5-second timing is played at 12 seconds in the finished animation;
the original screenshots remain authoritative for UI geometry and text.

The animation source lives in [charts-animation.html](../charts-animation.html).
It choreographs the real captures with cursor motion, camera movement, and
transitions. The resulting GIF is 12 seconds at 800 × 800 and 20 fps, with close-ups
of the controls and results and a full view of the final grid. It is an
edited product demonstration, not a continuous screen recording.

From the repository root, regenerate it with:

```sh
just --command node scripts/render-readme-charts.mjs
```

The renderer uses the workspace's Playwright dependency, its Chromium browser,
and FFmpeg. It keeps temporary render files outside the repository.
