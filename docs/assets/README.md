# README visuals

## Hero

`dashboard-preview.png` is the user-supplied OpenChart Desktop screenshot. It
shows SOXX and Bitcoin charts, indicators, the Tea editor, and an AI agent
conversation. The bottom-left account avatar and name are blurred; the screenshot
retains its original framing.

The [privacy-edit prompt](dashboard-blur.prompt.txt) was applied with the built-in
Image Generation tool. Only its blurred avatar/name region was composited onto
the source; pixels outside that region are unchanged.

`readme-hero.html` combines that image with the app's bundled Inter
fonts and the canonical logo in `platform/desktop/assets/logo.svg`.
`readme-hero.png` is the rendered image used in the root README.

After `just install`, install the rendering browser once and regenerate the hero
from the repository root:

```sh
just --command npm --prefix platform/desktop exec -- playwright install chromium --only-shell
just --command node scripts/render-readme-hero.mjs
```

## Star animation

`star-openchart.html` is the editable source for the seven-second
`star-openchart.gif` loop. It uses the app's Inter fonts and shows an illustrative
GitHub Star interaction without a fabricated star count.

The sequence shows the repository, zooms in on Star as the cursor approaches,
clicks to change it to Starred, then zooms back out to show the full repository
and closing message before the next loop.

Open the HTML source in a browser to preview the animation. With the same
rendering browser installed and [FFmpeg](https://ffmpeg.org/) on your path,
regenerate the GIF from the repository root:

```sh
just --command node scripts/render-readme-star.mjs
```

The renderer prints the location of a contact sheet for visual review. Temporary
frames stay outside the repository.

## Contributor marks

`codex-contributor.svg` and `claude-contributor.svg` reuse the OpenAI and Claude
mark geometry from `app/src/components/ui/model-selector/logos.tsx`. They identify
AI coding collaborators alongside the live GitHub contributor image.

## Feature grid

The README uses a two-column HTML table so the layout works in GitHub Markdown.
The Charts animation uses real Desktop captures; the other visuals come from
[openchart.co](https://openchart.co):

| Asset                       | Website source                                                       | Treatment                                                                   |
| --------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `feature-charts.gif`        | [Native Charts captures](charts-ui/README.md)                        | Add Bollinger Bands, enable Volume Profile, and expand to a 4 × 4 grid      |
| `feature-drawing-alert.gif` | [Drawing alert film](https://openchart.co/btc-drawing-film/)         | 0.35–23.6 s, through breakout and research, with a closing hold and fade    |
| `feature-market-watch.gif`  | [Market-watch film](https://openchart.co/supply-chain-film/)         | 0.35–29.2 s, through the anomaly notification, with a closing hold and fade |
| `feature-explain.gif`       | [Select and Explain film](https://openchart.co/select-explain-film/) | 0.35–19.9 s, preserving the selection, research, and annotation sequence    |
| `feature-agents.png`        | Agents                                                               | Website model-list composition extended with Gemini                         |
| `feature-tea.png`           | Tea                                                                  | Editor illustration, contained without cropping                             |

The three website films retain their original pacing at 640 × 640 and 12 fps. The opening fade
is trimmed so each GIF begins with a visible frame. The two alert
excerpts stop before the website demos' simulated brokerage interactions.
The website films are illustrations of workflows, not recordings of a running application.
The market-watch company's name and news are illustrative; model names in the
Agents visual are examples, not a live availability list. Its floating-list
composition follows `openchart-cloud/packages/landing/src/tailark/components/agent-models/models-4.tsx`.
The README capture extends that composition with Gemini Pro / Flash family
labels. [gemini-mark.svg](gemini-mark.svg) preserves the geometry from that
repository's `components/ui/svgs/gemini.tsx`.

With the same browser and FFmpeg prerequisites as the Star renderer, plus curl,
refresh the feature assets from the public website:

```sh
just --command node scripts/render-readme-features.mjs
```

To refresh only the Agents card:

```sh
just --command node scripts/render-readme-features.mjs --agents-only
```

The renderer resolves the current exported videos from their review pages and
captures the website's existing static visuals. Source downloads stay in a
temporary directory and are removed after rendering.

The Charts asset has a separate source and renderer. Its Image Generation
storyboard, original Desktop captures, and prompts live in [charts-ui/](charts-ui/README.md).
To regenerate the edited 12-second demonstration from those captures:

```sh
just --command node scripts/render-readme-charts.mjs
```
