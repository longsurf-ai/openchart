// Purpose: Curated copy for new-chat suggestions until recommendations are personalized.
import type { PromptSuggestion } from "./proactive";

/** Fixed suggestions, best first; the app shows a few at a time. Each prompt uses an existing Agent tool. */
export const starterPrompts: readonly PromptSuggestion[] = [
  {
    title:
      "📊  Find the 10 best-performing AI stocks of the past year and alert me to 10% drops",
    prompt:
      "Find me the top 10 performing AI-boosted stocks in the past 12 months and alert me if any of them drop by 10%.",
  },
  {
    title:
      "🧮  Build an indicator comparing beta-adjusted returns of major semiconductor stocks",
    prompt:
      "Build me an indicator comparing beta-adjusted relative performances of major semiconductor stocks.",
  },
  {
    title:
      "🪙  Monitor BTC and ETH live, research moves over 2%, and send me a notification",
    prompt:
      "Monitor BTC and ETH in real time and whenever they move more than 2%, start an agent to research the reason and send me a notification.",
  },
  {
    title:
      "🗓️  Brief me daily on the top 10 market movers, their catalysts and potential opportunities",
    prompt:
      "Give me a daily market briefing for the top 10 market movers, explain why they moved and whether there are potential opportunities.",
  },
  {
    title: "🚨  Alert me if BTC falls 5% in a day",
    prompt: "Alert me whenever BTCUSDT falls more than 5% within a day.",
  },
  {
    title: "🧮  Write an indicator that flags RSI divergences",
    prompt:
      "Write a custom indicator that marks bullish and bearish RSI divergences, then run it on SPY.",
  },
  {
    title: "📉  Find QQQ's biggest drawdowns since 2020",
    prompt:
      "Find the five largest drawdowns in QQQ since 2020 and how long each one took to recover.",
  },
  {
    title: "📈  Build a dashboard for BTC, ETH and SOL",
    prompt:
      "Create a dashboard with daily charts for BTCUSDT, ETHUSDT and SOLUSDT.",
  },
  {
    title: "🌅  Brief me on overnight crypto moves every morning",
    prompt:
      "Every weekday at 8:30 AM, brief me on how BTC, ETH and SOL moved overnight.",
  },
  {
    title: "⚖️  How volatile is TSLA compared to the S&P 500?",
    prompt:
      "Compare TSLA's 30-day realized volatility with SPY's over the past year.",
  },
  {
    title: "🔍  Which sector ETF is leading this quarter?",
    prompt:
      "Compare the major SPDR sector ETFs this quarter and tell me which one is leading and why.",
  },
  {
    title: "🗞️  Recap my alerts every Friday after the close",
    prompt:
      "Every Friday after the market close, recap which of my alerts fired this week and what the price did afterward.",
  },
];
