<p align="center">
  <a href="https://openchart.co">
    <img src="docs/assets/readme-hero.png" alt="OpenChart — Trade with charts, alerts, and your AI agents. Desktop screenshot with SOXX and Bitcoin charts, indicators, the Tea editor, and an AI agent conversation." width="100%">
  </a>
</p>

<p align="center">
  <a href="https://downloads.longsurf.ai/openchart/darwin/arm64/OpenChart.dmg">Download Desktop</a> ·
  <a href="docs/development.md#build">Self-hosting</a> ·
  <a href="#key-features">Features</a> ·
  <a href="https://openchart.co/tea">Tea</a>
</p>

<p align="center">
  <a href="https://openchart.co"><img src="https://img.shields.io/badge/Product-OpenChart-18181b?style=flat-square" alt="Product: OpenChart"></a>
  <a href="https://openchart.co/#pricing"><img src="https://img.shields.io/badge/pricing-free-2da44e?style=flat-square" alt="Desktop pricing: free"></a>
  <a href="https://discord.gg/PR4gfbMKUD"><img src="https://img.shields.io/badge/chat-Discord-5865F2?style=flat-square&amp;logo=discord&amp;logoColor=white" alt="Chat on Discord"></a>
  <a href="https://x.com/OpenChartHQ"><img src="https://img.shields.io/badge/follow-%40OpenChartHQ-18181b?style=flat-square&amp;logo=x&amp;logoColor=white" alt="Follow @OpenChartHQ on X"></a>
  <img src="https://img.shields.io/badge/subreddit-coming_soon-FF4500?style=flat-square&amp;logo=reddit&amp;logoColor=white" alt="Subreddit: coming soon">
  <a href="https://github.com/longsurf-ai/openchart/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/longsurf-ai/openchart/ci.yml?branch=main&amp;style=flat-square&amp;label=build&amp;logo=github" alt="Build status on main"></a>
</p>

## Quick start

[Download Desktop for macOS (Apple Silicon)](https://downloads.longsurf.ai/openchart/darwin/arm64/OpenChart.dmg),
open the disk image, and install OpenChart.

To run Desktop from source, install [Node.js 24](https://nodejs.org/en/download),
[npm 11.11.1](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm/),
[Bun 1.4.2](https://bun.sh/docs/installation), and [Just](https://just.systems/man/en/),
then run:

```sh
git clone https://github.com/longsurf-ai/openchart.git
cd openchart
just install --frozen-lockfile
just desktop
```

`just install` also initializes and builds Tea, a programming language built for analyzing market, by the same team.
Follow the [setup guide](https://openchart.co/docs/getting-started/)
for your first chart and alert, or the [development guide](docs/development.md)
for building and packaging the app.

Desktop is free. AI usage follows your agent provider's plan; optional Cloud
market data is priced separately.

## Key features

<table>
  <tr>
    <td width="50%" valign="top">
      <a href="https://openchart.co/#charts"><img src="docs/assets/feature-charts.gif" alt="A real OpenChart chart gains Bollinger Bands and Volume Profile, then expands to a sixteen-chart 4-by-4 grid." width="100%"></a>
      <h3>Charts without software quotas</h3>
      <p>Add indicators and Volume Profile, then expand to a 4×4 grid. No software plan limits on charts, indicators, or price and indicator alerts.</p>
    </td>
    <td width="50%" valign="top">
      <a href="https://openchart.co/#agents"><img src="docs/assets/feature-agents.png" alt="Codex, Claude, and Gemini models in a floating model-list illustration." width="100%"></a>
      <h3>Use your own agents</h3>
      <p>Use your Claude, Codex, and Gemini models to research markets, build indicators, and set up alerts with the accounts you already have.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <a href="https://openchart.co/#alerts-market-watch"><img src="docs/assets/feature-market-watch.gif" alt="A plain-language request becomes Tea monitors and an alert that asks Codex to investigate an illustrative market move." width="100%"></a>
      <h3>Describe what to watch</h3>
      <p>Tell your agent what matters. It builds Tea monitors that evaluate incoming data and investigate when a condition fires.</p>
    </td>
    <td width="50%" valign="top">
      <a href="https://openchart.co/#auto-explain"><img src="docs/assets/feature-explain.gif" alt="Select a chart range, research the move, and expand annotations with linked sources." width="100%"></a>
      <h3>Explain what moved the chart</h3>
      <p>Select a range and let your agent research the move, with source-linked annotations pinned to the bars.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <a href="https://openchart.co/#alerts"><img src="docs/assets/feature-drawing-alert.gif" alt="Draw a wedge, create an alert, and watch a breakout trigger agent research in this illustrated workflow." width="100%"></a>
      <h3>Draw it, get alerted</h3>
      <p>Draw a line or zone on the chart. When price crosses it, an alert can ask your agent to research the move.</p>
    </td>
    <td width="50%" valign="top">
      <a href="https://openchart.co/tea"><img src="docs/assets/feature-tea.png" alt="The website's Tea editor illustration showing a custom MACD indicator and volume-confirmed alerts." width="100%"></a>
      <h3>Write your own market logic in Tea</h3>
      <p>Build custom indicators and conditions with functions, loops, state, and collections that evaluate as data flows in. <a href="https://openchart.co/tea">Explore Tea →</a></p>
    </td>
  </tr>
</table>

## Staying updated

[Star OpenChart](https://github.com/longsurf-ai/openchart) to support the project
and help more people discover it.

[![A cursor clicks Star on the OpenChart GitHub repository, changing it to Starred.](docs/assets/star-openchart.gif)](https://github.com/longsurf-ai/openchart)

## Contributing

Help improve OpenChart through code, indicators, documentation, and feedback.

- **Code:** Start with the [development guide](docs/development.md) and
  [architecture](docs/architecture/code-organization.md). Run `just check` before
  submitting a pull request.
- **Indicators:** Improve OpenChart's built-in studies, or contribute to the
  [Tea compiler and runtime](https://github.com/longsurf-ai/tea).
- **Documentation:** Fix an unclear explanation, improve a setup guide, or add a
  useful example.
- **Ideas and feedback:** Tell us what you are building on
  [Discord](https://discord.gg/PR4gfbMKUD), or open an
  [issue](https://github.com/longsurf-ai/openchart/issues) with a bug report or
  feature request.

### Contributors

Thanks to everyone helping build OpenChart.

<p>
  <a href="https://github.com/longsurf-ai/openchart/graphs/contributors"><img src="https://contrib.rocks/image?repo=longsurf-ai/openchart" alt="OpenChart contributors"></a>
  <a href="https://openai.com/codex/"><img src="docs/assets/codex-contributor.svg" alt="Codex — AI coding collaborator" title="Codex — AI coding collaborator" width="64" height="64"></a>
  <a href="https://claude.com/product/claude-code"><img src="docs/assets/claude-contributor.svg" alt="Claude — AI coding collaborator" title="Claude — AI coding collaborator" width="64" height="64"></a>
</p>

## Community & contact

- [Discord](https://discord.gg/PR4gfbMKUD): Ask questions, share charts and
  indicators, and meet other users.
- [GitHub Issues](https://github.com/longsurf-ai/openchart/issues): Report
  reproducible bugs and suggest improvements.
- [X / @OpenChartHQ](https://x.com/OpenChartHQ): Follow release news and project
  updates.
- **Reddit:** Our subreddit is coming soon.

## Security disclosure

Report vulnerabilities privately to [security@longsurf.ai](mailto:security@longsurf.ai),
following our [security policy](SECURITY.md). Please do not disclose vulnerabilities
in public issues, pull requests, or community channels.

## License

OpenChart uses the [OpenChart License](LICENSE), based on Apache 2.0 with additional
conditions. See the license for usage and commercial terms. For commercial
licensing, contact [legal@longsurf.ai](mailto:legal@longsurf.ai).
