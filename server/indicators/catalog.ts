// Purpose: Discover bundled indicators through authored goals, explanations and recreation prompts; Tea files own executable metadata.
import { featuredStudies } from "./featured-studies";

/** User purposes for exploring the library, rather than technical indicator families. */
export const indicatorGoalKeys = [
  "follow-trends",
  "find-breakouts",
  "find-reversals",
  "understand-volatility",
  "read-volume",
  "read-structure",
] as const;
/** A discovery purpose; one indicator can help answer several purposes. */
export type IndicatorGoal = (typeof indicatorGoalKeys)[number];

const indicatorTemplates = [
  {
    id: "accelerator-oscillator",
    name: "Accelerator Oscillator",
    category: "Momentum",
  },
  {
    id: "aroon",
    name: "Aroon",
    category: "Momentum",
  },
  {
    id: "average-directional-index",
    name: "Average Directional Index",
    category: "Momentum",
  },
  {
    id: "awesome-oscillator",
    name: "Awesome Oscillator",
    category: "Momentum",
  },
  {
    id: "balance-of-power",
    name: "Balance of Power",
    category: "Momentum",
  },
  {
    id: "cci",
    name: "CCI",
    category: "Momentum",
  },
  {
    id: "chande-momentum-oscillator",
    name: "Chande Momentum Oscillator",
    category: "Momentum",
  },
  {
    id: "connors-rsi",
    name: "Connors RSI",
    category: "Momentum",
  },
  {
    id: "coppock-curve",
    name: "Coppock Curve",
    category: "Momentum",
  },
  {
    id: "directional-movement",
    name: "Directional Movement",
    category: "Momentum",
  },
  {
    id: "fisher-transform",
    name: "Fisher Transform",
    category: "Momentum",
  },
  {
    id: "know-sure-thing",
    name: "Know Sure Thing",
    category: "Momentum",
  },
  {
    id: "macd",
    name: "MACD",
    category: "Momentum",
  },
  {
    id: "mass-index",
    name: "Mass Index",
    category: "Momentum",
  },
  {
    id: "momentum",
    name: "Momentum",
    category: "Momentum",
  },
  {
    id: "price-oscillator",
    name: "Price Oscillator",
    category: "Momentum",
  },
  {
    id: "rsi",
    name: "RSI",
    category: "Momentum",
  },
  {
    id: "rank-correlation-index",
    name: "Rank Correlation Index",
    category: "Momentum",
  },
  {
    id: "rate-of-change",
    name: "Rate Of Change",
    category: "Momentum",
  },
  {
    id: "relative-vigor-index",
    name: "Relative Vigor Index",
    category: "Momentum",
  },
  {
    id: "relative-volatility-index",
    name: "Relative Volatility Index",
    category: "Momentum",
  },
  {
    id: "stochastic",
    name: "Stochastic",
    category: "Momentum",
  },
  {
    id: "stochastic-rsi",
    name: "Stochastic RSI",
    category: "Momentum",
  },
  {
    id: "trix",
    name: "TRIX",
    category: "Momentum",
  },
  {
    id: "true-strength-indicator",
    name: "True Strength Indicator",
    category: "Momentum",
  },
  {
    id: "ultimate-oscillator",
    name: "Ultimate Oscillator",
    category: "Momentum",
  },
  {
    id: "vortex-indicator",
    name: "Vortex Indicator",
    category: "Momentum",
  },
  {
    id: "williams-r",
    name: "Williams %R",
    category: "Momentum",
  },
  {
    id: "arnaud-legoux-moving-average",
    name: "Arnaud Legoux Moving Average",
    category: "Trend",
  },
  {
    id: "average-price",
    name: "Average Price",
    category: "Trend",
  },
  {
    id: "double-ema",
    name: "Double EMA",
    category: "Trend",
  },
  {
    id: "ema",
    name: "EMA",
    category: "Trend",
  },
  {
    id: "envelopes",
    name: "Envelopes",
    category: "Trend",
  },
  {
    id: "hull-moving-average",
    name: "Hull Moving Average",
    category: "Trend",
  },
  {
    id: "least-squares-moving-average",
    name: "Least Squares Moving Average",
    category: "Trend",
  },
  {
    id: "linear-regression-curve",
    name: "Linear Regression Curve",
    category: "Trend",
  },
  {
    id: "mcginley-dynamic",
    name: "McGinley Dynamic",
    category: "Trend",
  },
  {
    id: "median-price",
    name: "Median Price",
    category: "Trend",
  },
  {
    id: "moving-average-ribbon",
    name: "Moving Average Ribbon",
    category: "Trend",
  },
  {
    id: "sma",
    name: "SMA",
    category: "Trend",
  },
  {
    id: "smoothed-moving-average",
    name: "Smoothed Moving Average",
    category: "Trend",
  },
  {
    id: "triple-ema",
    name: "Triple EMA",
    category: "Trend",
  },
  {
    id: "typical-price",
    name: "Typical Price",
    category: "Trend",
  },
  {
    id: "vwma",
    name: "VWMA",
    category: "Trend",
  },
  {
    id: "wma",
    name: "WMA",
    category: "Trend",
  },
  {
    id: "atr",
    name: "ATR",
    category: "Volatility",
  },
  {
    id: "bollinger-bands",
    name: "Bollinger Bands",
    category: "Volatility",
  },
  {
    id: "bollinger-bands-b",
    name: "Bollinger Bands %B",
    category: "Volatility",
  },
  {
    id: "bollinger-bands-width",
    name: "Bollinger Bands Width",
    category: "Volatility",
  },
  {
    id: "chaikin-volatility",
    name: "Chaikin Volatility",
    category: "Volatility",
  },
  {
    id: "chande-kroll-stop",
    name: "Chande Kroll Stop",
    category: "Volatility",
  },
  {
    id: "choppiness-index",
    name: "Choppiness Index",
    category: "Volatility",
  },
  {
    id: "donchian-channels",
    name: "Donchian Channels",
    category: "Volatility",
  },
  {
    id: "keltner-channel",
    name: "Keltner Channel",
    category: "Volatility",
  },
  {
    id: "parabolic-sar",
    name: "Parabolic SAR",
    category: "Volatility",
  },
  {
    id: "price-channel",
    name: "Price Channel",
    category: "Volatility",
  },
  {
    id: "standard-deviation",
    name: "Standard Deviation",
    category: "Volatility",
  },
  {
    id: "supertrend",
    name: "SuperTrend",
    category: "Volatility",
  },
  {
    id: "accumulation-distribution",
    name: "Accumulation/Distribution",
    category: "Volume",
  },
  {
    id: "chaikin-money-flow",
    name: "Chaikin Money Flow",
    category: "Volume",
  },
  {
    id: "chaikin-oscillator",
    name: "Chaikin Oscillator",
    category: "Volume",
  },
  {
    id: "ease-of-movement",
    name: "Ease of Movement",
    category: "Volume",
  },
  {
    id: "elder-s-force-index",
    name: "Elder's Force Index",
    category: "Volume",
  },
  {
    id: "mfi",
    name: "MFI",
    category: "Volume",
  },
  {
    id: "net-volume",
    name: "Net Volume",
    category: "Volume",
  },
  {
    id: "obv",
    name: "OBV",
    category: "Volume",
  },
  {
    id: "price-volume-trend",
    name: "Price Volume Trend",
    category: "Volume",
  },
  {
    id: "session-volume-profile",
    name: "Session Volume Profile",
    category: "Volume",
  },
  {
    id: "vwap",
    name: "VWAP",
    category: "Volume",
  },
  {
    id: "volume",
    name: "Volume",
    category: "Volume",
  },
  {
    id: "volume-oscillator",
    name: "Volume Oscillator",
    category: "Volume",
  },
] as const;

/**
 * Built-in scripts the chart runs itself, such as the profile of the visible
 * range. Installed and read-only like catalog originals, but never listed for
 * users to add.
 */
export const chartBuiltins = [
  {
    id: "volume-profile-range",
    path: "indicators/builtin/volume-profile-range.tea",
  },
] as const;

/** A bundled source's stable identity; it selects an installed original, never an execution instance. */
export type BuiltinIndicatorId = (typeof indicatorTemplates)[number]["id"];

type IndicatorDiscovery = {
  readonly goals: readonly [IndicatorGoal, ...IndicatorGoal[]];
  readonly prompt: string;
  readonly description: string;
};

// Authored prompts recreate the bundled behavior; they are not historical generation records.
// This complete lookup cannot redefine inputs, defaults, outputs or execution bindings.
const indicatorDiscovery: Record<BuiltinIndicatorId, IndicatorDiscovery> = {
  "accelerator-oscillator": {
    goals: ["find-reversals", "follow-trends"],
    prompt:
      "Create an Accelerator Oscillator in a separate pane. Subtract the 34-period SMA of midpoint prices from the 5-period SMA, then subtract its 5-period SMA and plot the result as a histogram.",
    description:
      "Shows how the Awesome Oscillator is changing relative to its own short average. Bars above zero mean momentum is above that average; bars below zero mean it is below it. A change in sign describes a momentum shift, not a confirmed price reversal.",
  },
  aroon: {
    goals: ["follow-trends", "find-reversals"],
    prompt:
      "Plot 14-period Aroon Up and Aroon Down in a separate pane, measuring how recently the highest high and lowest low occurred.",
    description:
      "Compares the recency of highs and lows to show which direction is making new extremes. Up near 100 means a high occurred recently; Down near 100 means a low occurred recently. Their relative positions help identify changes in directional activity.",
  },
  "average-directional-index": {
    goals: ["follow-trends"],
    prompt:
      "Plot the Average Directional Index in a separate pane, using a 14-period directional-movement length and 14-period ADX smoothing. Show the ADX line only.",
    description:
      "Measures trend strength without choosing a bullish or bearish direction. A rising ADX indicates stronger directional movement; a falling ADX indicates weakening directional movement. Read its direction alongside the price chart, since the same ADX can accompany either an uptrend or a downtrend.",
  },
  "awesome-oscillator": {
    goals: ["follow-trends", "find-reversals"],
    prompt:
      "Plot an Awesome Oscillator histogram in a separate pane: the 5-period SMA of midpoint prices minus the 34-period SMA of midpoint prices.",
    description:
      "Compares short and longer averages of each bar's midpoint to show price momentum. Positive bars place the short average above the longer one; negative bars place it below. Shrinking bars show that the distance between the averages is narrowing.",
  },
  "balance-of-power": {
    goals: ["find-reversals"],
    prompt:
      "Plot Balance of Power in a separate pane as close minus open divided by high minus low. Use zero for bars whose high and low are equal.",
    description:
      "Shows the open-to-close move as a share of each bar's full range. Positive values mean the bar closed above its open; negative values mean it closed below. Values near zero indicate little net movement within the bar, even when its range was large.",
  },
  cci: {
    goals: ["find-reversals", "follow-trends"],
    prompt:
      "Plot a 14-period Commodity Channel Index in a separate pane, using closing prices by default and allowing the price source and length to be changed.",
    description:
      "Measures how far the selected price lies from its average relative to its usual deviation. Large positive values describe unusually high prices within the window; large negative values describe unusually low prices. Sustained extremes can accompany a strong trend rather than an immediate reversal.",
  },
  "chande-momentum-oscillator": {
    goals: ["find-reversals", "follow-trends"],
    prompt:
      "Plot a 14-period Chande Momentum Oscillator of closing prices in a separate pane. Allow the source and length to be changed.",
    description:
      "Compares the total upward and downward price changes within the window. Positive values favor upward momentum; negative values favor downward momentum. Moving back toward zero shows that the balance between the two is becoming more even.",
  },
  "connors-rsi": {
    goals: ["find-reversals"],
    prompt:
      "Create Connors RSI in a separate pane by averaging the 3-period RSI of close, the 2-period RSI of the up-or-down closing streak, and the 100-period percent rank of the one-bar percentage price change.",
    description:
      "Combines short-term price momentum, consecutive rising or falling closes, and the relative size of the latest change. High readings describe unusually strong recent upward movement; low readings describe unusually strong downward movement. The combined line provides context for short-term extremes without identifying a reversal by itself.",
  },
  "coppock-curve": {
    goals: ["follow-trends", "find-reversals"],
    prompt:
      "Plot a Coppock Curve in a separate pane: add the 14-period and 11-period percentage rates of change of close, then smooth the sum with a 10-period weighted moving average.",
    description:
      "Smooths two rates of price change into a longer view of momentum. A rising curve shows improving momentum across those lookbacks; a falling curve shows deterioration. A move through zero changes the sign of the smoothed combined momentum, while the bar interval determines the time horizon.",
  },
  "directional-movement": {
    goals: ["follow-trends", "find-reversals"],
    prompt:
      "Plot the Directional Movement system in a separate pane with 14-period directional-movement length and ADX smoothing. Show +DI, -DI and ADX as separate lines.",
    description:
      "Puts trend direction and strength in one pane. +DI above -DI favors upward directional movement; -DI above +DI favors downward movement. ADX measures the strength of that movement independently of its direction, so a line crossover is more useful when read with both ADX and price.",
  },
  "fisher-transform": {
    goals: ["find-reversals"],
    prompt:
      "Create a 14-period Fisher Transform of midpoint prices in a separate pane. Normalize each midpoint within the recent range, subtract 0.5, multiply by 0.66 and add 0.67 times the previous normalized value. Clamp to -0.999 through 0.999, then plot half the log of (1 + value) / (1 - value) plus half the previous Fisher value, with a one-bar-lagged signal line.",
    description:
      "Transforms the midpoint's position in its recent range to make changes near extremes easier to see. Compare the Fisher line with its previous-bar signal: crossings describe a turn in the transformed series. An extreme or crossing still needs price context; it does not establish a future turning point.",
  },
  "know-sure-thing": {
    goals: ["follow-trends", "find-reversals"],
    prompt:
      "Plot Know Sure Thing in a separate pane. Combine smoothed rates of change for 10, 15, 20 and 30 bars with weights 1, 2, 3 and 4; use SMA smoothing lengths 10, 10, 10 and 15, and add a 9-period SMA signal line.",
    description:
      "Combines momentum across four lookbacks, with greater weight on the longer ones. A KST line above its signal indicates that combined momentum is above its recent average; below the signal indicates the opposite. Its position relative to zero describes the sign of the combined rates of change.",
  },
  macd: {
    goals: ["follow-trends", "find-reversals"],
    prompt:
      "Create MACD in a separate pane using closing prices, fast length 12, slow length 26 and signal length 9. Plot the MACD and signal lines plus a teal histogram for nonnegative values and a red histogram for negative values.",
    description:
      "Shows the relationship between a fast and slow moving average, along with a smoothed signal line. The histogram is their MACD-to-signal difference: growing bars show that difference expanding, while shrinking bars show it narrowing. Line crossings and zero crossings describe different changes in momentum.",
  },
  "mass-index": {
    goals: ["understand-volatility", "find-reversals"],
    prompt:
      "Plot Mass Index in a separate pane. Divide the 9-period EMA of each bar's high-low range by a second 9-period EMA of that first EMA, then sum the ratios over 25 bars.",
    description:
      "Tracks changes in bar ranges using the ratio of single and double exponential smoothing. A rise means the recent range is growing relative to its more slowly smoothed measure. The index describes range behavior without indicating whether a subsequent price move will be upward or downward.",
  },
  momentum: {
    goals: ["follow-trends", "find-reversals"],
    prompt:
      "Plot Momentum in a separate pane as the current close minus the close 14 bars ago. Allow the source and lookback length to be changed.",
    description:
      "Shows the absolute price change over the selected lookback. Above zero means price is higher than it was that many bars ago; below zero means it is lower. Compare peaks and troughs with price to examine whether the size of recent moves is increasing or fading.",
  },
  "price-oscillator": {
    goals: ["follow-trends", "find-reversals"],
    prompt:
      "Plot a percentage Price Oscillator in a separate pane: 100 times the difference between the 12-period and 26-period EMAs of close, divided by the 26-period EMA.",
    description:
      "Expresses the distance between fast and slow exponential averages as a percentage of the slow average. Positive values place the fast average above the slow one; negative values place it below. Unlike an absolute difference, the percentage scale helps compare relative separation at different price levels.",
  },
  rsi: {
    goals: ["find-reversals", "follow-trends"],
    prompt:
      "Plot a 14-period Relative Strength Index of closing prices in a separate pane, with configurable source and length.",
    description:
      "Measures the balance between recent gains and losses on a scale from 0 to 100. High readings describe stronger recent gains; low readings describe stronger recent losses. Compare the line with price to examine fading momentum or possible divergence; this study plots RSI only and does not detect or annotate divergences automatically.",
  },
  "rank-correlation-index": {
    goals: ["follow-trends", "find-reversals"],
    prompt:
      "Plot a 9-period Rank Correlation Index of closing prices in a separate pane. Correlate price ranks with chronological ranks, handle tied prices with average ranks, and express the result on a -100 to 100 scale.",
    description:
      "Measures how closely the ordering of prices follows the ordering of time. Near 100 means prices are mostly rising in order; near -100 means they are mostly falling. Values near zero indicate less orderly direction, and a flat-price window has no defined correlation.",
  },
  "rate-of-change": {
    goals: ["follow-trends", "find-reversals"],
    prompt:
      "Plot the 14-period percentage Rate of Change of closing prices in a separate pane, with configurable source and lookback length.",
    description:
      "Measures percentage price change from the selected number of bars ago. Positive values indicate a higher price and negative values indicate a lower one. A rising line describes an improving lookback return, while a falling line describes a deteriorating return, even before either crosses zero.",
  },
  "relative-vigor-index": {
    goals: ["find-reversals", "follow-trends"],
    prompt:
      "Plot a 14-period Relative Vigor Index in a separate pane. Divide the SMA of symmetrically weighted close-open movement by the SMA of symmetrically weighted high-low range, and add a symmetrically weighted signal line.",
    description:
      "Compares smoothed open-to-close movement with the size of the bars' ranges. Positive values favor closes above opens; negative values favor closes below opens. Comparing the vigor line with its smoother signal can reveal changes in that balance.",
  },
  "relative-volatility-index": {
    goals: ["understand-volatility", "find-reversals"],
    prompt:
      "Plot a 14-period Relative Volatility Index in a separate pane. Calculate closing-price standard deviation, exponentially smooth its contributions on up-close and down-close bars separately, and plot the up contribution as a percentage of their sum.",
    description:
      "Separates closing-price volatility into contributions from rising and falling bars. Above 50 means more of the smoothed contribution came from rising closes; below 50 means more came from falling closes. The line measures the directional balance of volatility, not its absolute size.",
  },
  stochastic: {
    goals: ["find-reversals"],
    prompt:
      "Plot a 14-period Stochastic Oscillator in a separate pane. Smooth the close's position within the high-low range with a 3-period SMA for %K, then use a 3-period SMA of %K for %D.",
    description:
      "Shows where closes lie within their recent high-low range, with two smoothed lines. High readings place closes near the top of the range; low readings place them near the bottom. %K and %D crossings describe changes in this relative position, while sustained extremes can occur during a trend.",
  },
  "stochastic-rsi": {
    goals: ["find-reversals"],
    prompt:
      "Plot Stochastic RSI in a separate pane. Calculate a 14-period RSI of close, apply a 14-period stochastic calculation to that RSI, smooth %K with a 3-period SMA and %D with another 3-period SMA.",
    description:
      "Shows where RSI lies within its own recent range, making it more sensitive than RSI alone. High readings place RSI near the top of that range; low readings place it near the bottom. Read the two smoothed lines as momentum changes within RSI rather than direct price levels.",
  },
  trix: {
    goals: ["follow-trends", "find-reversals"],
    prompt:
      "Plot TRIX in a separate pane as the one-bar percentage rate of change of a closing-price series smoothed by three successive 14-period EMAs.",
    description:
      "Measures the change in a heavily smoothed price series to reduce short-term fluctuations. Positive values mean the triple-smoothed series is rising; negative values mean it is falling. Movement toward zero shows the smoothed change losing magnitude.",
  },
  "true-strength-indicator": {
    goals: ["follow-trends", "find-reversals"],
    prompt:
      "Plot a True Strength Indicator of closing prices in a separate pane using short smoothing length 13 and long smoothing length 25.",
    description:
      "Compares double-smoothed price changes with double-smoothed absolute changes. Above zero favors positive momentum and below zero favors negative momentum. A rising or falling line describes changes in this balance; this version does not add a separate signal line.",
  },
  "ultimate-oscillator": {
    goals: ["find-reversals", "follow-trends"],
    prompt:
      "Plot an Ultimate Oscillator in a separate pane. Compare buying pressure with true range over 7, 14 and 28 bars, combine their ratios with weights 4, 2 and 1, and scale the result to 0-100.",
    description:
      "Combines the close's position relative to the previous close and bar range across three lookbacks. High values mean stronger relative buying pressure across those windows; low values mean weaker pressure. The weighted combination provides a broader view than a single short lookback.",
  },
  "vortex-indicator": {
    goals: ["follow-trends", "find-reversals"],
    prompt:
      "Plot a 14-period Vortex Indicator in a separate pane. Divide the average absolute high-to-previous-low and low-to-previous-high movements by average true range, and show the positive and negative lines.",
    description:
      "Compares upward and downward movement between neighboring bars, normalized by true range. The positive line above the negative line favors upward movement; the reverse favors downward movement. Crossings show a change in their relative strength.",
  },
  "williams-r": {
    goals: ["find-reversals"],
    prompt:
      "Plot 14-period Williams %R in a separate pane, showing the close's position within the recent high-low range on a -100 to 0 scale.",
    description:
      "Places the close within the recent price range using a negative scale. Values near zero put it near the highest high; values near -100 put it near the lowest low. Leaving an extreme describes a change in range position, which should be read with the price trend.",
  },
  "arnaud-legoux-moving-average": {
    goals: ["follow-trends"],
    prompt:
      "Plot a 14-period Arnaud Legoux Moving Average of close on the price chart, using offset 0.85 and sigma 6, with configurable source and length.",
    description:
      "Smooths price using Gaussian weights centered toward the recent end of the window. A rising line describes a rising weighted price level; a falling line describes a falling one. Compare price with the line to see how far the current move sits from its smoothed level.",
  },
  "average-price": {
    goals: ["follow-trends"],
    prompt:
      "Plot the average of open, high, low and close for each bar directly on the price chart.",
    description:
      "Summarizes each bar with the equally weighted average of its four prices. The line shows changes in those per-bar averages without smoothing across time. Use it as an alternative view of the price path rather than a moving average.",
  },
  "double-ema": {
    goals: ["follow-trends"],
    prompt:
      "Plot a 14-period Double EMA of close on the price chart: twice the EMA minus the EMA of that EMA. Allow the source and length to be changed.",
    description:
      "Combines two levels of exponential smoothing to follow price with less lag than a single EMA of the same length. Its slope describes the smoothed direction, and price crossings show a change in relative position. Faster response can also produce more changes during sideways movement.",
  },
  ema: {
    goals: ["follow-trends"],
    prompt:
      "Plot a 14-period exponential moving average of closing prices on the price chart, with configurable source and length.",
    description:
      "Smooths price while giving greater weight to recent bars. A rising EMA shows a rising smoothed price level; a falling EMA shows a falling one. Compare price and the slope of the line to examine trend direction and short-term departures from it.",
  },
  envelopes: {
    goals: ["follow-trends", "find-reversals"],
    prompt:
      "Plot Envelopes on the price chart: a 14-period SMA of close with upper and lower lines 2.5% above and below it. Allow the source, length and percentage to be changed.",
    description:
      "Places fixed-percentage boundaries around a moving average. Price near or beyond a boundary is far from that smoothed level relative to the chosen percentage. These bands follow the average but do not automatically widen when volatility increases.",
  },
  "hull-moving-average": {
    goals: ["follow-trends"],
    prompt:
      "Plot a 14-period Hull Moving Average of closing prices on the price chart, with configurable source and length.",
    description:
      "Combines weighted averages to smooth price while reducing lag. Its slope makes changes in the smoothed direction easy to inspect. Sharp turns can respond quickly to price changes, so compare them with the surrounding price action rather than treating every turn as a new trend.",
  },
  "least-squares-moving-average": {
    goals: ["follow-trends"],
    prompt:
      "Plot a 14-period Least Squares Moving Average of close on the price chart by taking the endpoint of each rolling linear regression with zero offset.",
    description:
      "Plots the fitted endpoint of a straight-line regression through the recent prices. A rising line describes a rising fitted price path; a falling line describes a falling one. It is the current regression endpoint, not a forecast beyond the observed window.",
  },
  "linear-regression-curve": {
    goals: ["follow-trends"],
    prompt:
      "Plot a Linear Regression Curve on the price chart using closing prices, a 14-bar rolling regression window and zero offset.",
    description:
      "Connects the endpoints of successive linear fits through the selected price window. Its direction shows how those fitted endpoints change over time. This bundled version uses the same calculation as the Least Squares Moving Average and does not project future prices.",
  },
  "mcginley-dynamic": {
    goals: ["follow-trends"],
    prompt:
      "Plot a McGinley Dynamic of close on the price chart with length 14. Start from the source price, then update the previous value by the price difference divided by length times the fourth power of the price-to-previous-value ratio.",
    description:
      "Smooths price with an adjustment that changes according to the relationship between price and the previous line value. Its slope and price's position around it provide a view of the smoothed direction. The adaptive calculation behaves differently from a moving average with fixed weights.",
  },
  "median-price": {
    goals: ["follow-trends"],
    prompt:
      "Plot the midpoint of each bar's high and low directly on the price chart.",
    description:
      "Shows the center of each bar's high-low range. It offers a price path that is less dependent on where the bar happened to close, but it does not smooth between bars. Compare it with closes to see whether closing prices tend to sit above or below the middle of their ranges.",
  },
  "moving-average-ribbon": {
    goals: ["follow-trends"],
    prompt:
      "Plot a moving-average ribbon on the price chart with 10-, 20-, 50- and 100-period simple moving averages of close. Show all four as separate lines.",
    description:
      "Places four averages of different lengths on the same price chart. Shorter averages above longer ones show a rising alignment; the opposite shows a falling alignment. Changes in spacing reveal whether the different smoothed price levels are spreading apart or converging.",
  },
  sma: {
    goals: ["follow-trends"],
    prompt:
      "Plot a 14-period simple moving average of closing prices on the price chart, with configurable source and length.",
    description:
      "Shows the equally weighted average price over the selected window. A rising line means that average is increasing; a falling line means it is decreasing. Compare price with the line to inspect departures from its recent average, allowing for the delay introduced by smoothing.",
  },
  "session-volume-profile": {
    goals: ["read-volume", "read-structure"],
    prompt:
      "Draw a volume profile for each day, week or month over the price chart: spread every bar's volume across price rows, rising and falling volume side by side, and mark the row with the most volume.",
    description:
      "Shows at which prices each period traded the most. Long rows mark prices where much volume changed hands, which often act as reference levels later; short rows mark prices the market passed through quickly. The marked row is the period's point of control, its busiest price.",
  },
  "smoothed-moving-average": {
    goals: ["follow-trends"],
    prompt:
      "Plot a 14-period smoothed moving average of closing prices on the price chart using Wilder's RMA smoothing, with configurable source and length.",
    description:
      "Uses Wilder's smoothing to retain more influence from older prices than an EMA of the same length. Its gradual slope helps show the prevailing smoothed direction. The slower response can make short-lived price changes less visible in the line.",
  },
  "triple-ema": {
    goals: ["follow-trends"],
    prompt:
      "Plot a 14-period Triple EMA of close on the price chart: three times the first EMA minus three times the second successive EMA plus the third successive EMA.",
    description:
      "Combines three levels of exponential smoothing to reduce lag while retaining a smooth price path. Read its slope and price crossings to examine directional changes. The reduced lag can also make the line more sensitive to short-lived moves.",
  },
  "typical-price": {
    goals: ["follow-trends"],
    prompt:
      "Plot the average of each bar's high, low and close directly on the price chart.",
    description:
      "Combines the range endpoints and closing price into one value for each bar. It gives the close a role alongside the bar's range, without averaging across time. Use it as an alternative price source or compare its path with the close itself.",
  },
  vwma: {
    goals: ["follow-trends", "read-volume"],
    prompt:
      "Plot a 14-period volume-weighted moving average of close on the price chart, with configurable source and length.",
    description:
      "Weights each price by its bar's volume within a rolling window. Higher-volume bars have more influence on the line than lower-volume bars. Compare it with an equally weighted average to see how trading activity changes the smoothed price level.",
  },
  wma: {
    goals: ["follow-trends"],
    prompt:
      "Plot a 14-period weighted moving average of close on the price chart, giving linearly increasing weight to more recent bars.",
    description:
      "Smooths price with weights that increase toward the most recent bar. Its slope describes the weighted price direction, and it generally responds more quickly than a simple average of the same length. Compare that response with the price chart when examining a change in direction.",
  },
  atr: {
    goals: ["understand-volatility"],
    prompt:
      "Plot a 14-period Average True Range in a separate pane, with configurable length.",
    description:
      "Measures the smoothed size of price movement, including gaps from the previous close. Rising ATR means larger typical ranges; falling ATR means smaller ranges. ATR uses the instrument's price units and does not indicate whether prices are rising or falling.",
  },
  "bollinger-bands": {
    goals: ["understand-volatility", "find-reversals"],
    prompt:
      "Plot Bollinger Bands on the price chart using a 20-period average of close and upper and lower bands two standard deviations away. Show the basis and both bands, with configurable source, length and multiplier.",
    description:
      "Surrounds a moving average with bands that widen and narrow with price dispersion. Narrow bands show lower recent dispersion and wider bands show higher dispersion. A price touch or move outside a band describes relative position; it does not by itself confirm a breakout or reversal.",
  },
  "bollinger-bands-b": {
    goals: ["find-reversals", "understand-volatility"],
    prompt:
      "Plot Bollinger Bands %B in a separate pane using close, length 20 and a two-standard-deviation multiplier. Calculate the distance above the lower band as a share of the distance between both bands.",
    description:
      "Expresses price's position within its Bollinger Bands. Zero is the lower band, one is the upper band, and 0.5 is midway between them. Values below zero or above one place price outside the bands; they describe location rather than a trading instruction.",
  },
  "bollinger-bands-width": {
    goals: ["understand-volatility"],
    prompt:
      "Plot Bollinger Bands Width in a separate pane using close, length 20 and multiplier 2. Express the upper-to-lower band distance as a percentage of the basis.",
    description:
      "Shows Bollinger Band separation relative to the moving average. A declining line indicates the bands are contracting; a rising line indicates they are expanding. Compare current readings with the instrument's own history to inspect unusually quiet or dispersed periods.",
  },
  "chaikin-volatility": {
    goals: ["understand-volatility"],
    prompt:
      "Plot Chaikin Volatility in a separate pane as the 14-period percentage rate of change of the 14-period EMA of each bar's high-low range.",
    description:
      "Measures how quickly the smoothed high-low range is changing. Positive readings indicate a larger smoothed range than 14 bars ago; negative readings indicate a smaller one. Unlike ATR, the underlying range here does not include gaps from the previous close.",
  },
  "chande-kroll-stop": {
    goals: ["follow-trends", "understand-volatility"],
    prompt:
      "Plot Chande Kroll Stop lines on the price chart using ATR length 10, stop length 9 and factor 1. Take the 9-bar highest value of the 10-bar highest high minus ATR for the long line, and the 9-bar lowest value of the 10-bar lowest low plus ATR for the short line.",
    description:
      "Places two reference lines around recent price extremes using ATR-adjusted calculations. Their distance and movement reflect both the price range and volatility. These plotted levels are references only; the script does not place, manage or execute stop orders.",
  },
  "choppiness-index": {
    goals: ["understand-volatility", "follow-trends"],
    prompt:
      "Plot a 14-period Choppiness Index in a separate pane. Compare the sum of true ranges with the window's highest-high to lowest-low range using the standard logarithmic normalization.",
    description:
      "Compares total movement within the window with the net range it covers. Higher readings describe more back-and-forth movement relative to that range; lower readings describe more directional movement. The index measures this relationship without identifying the direction of a trend.",
  },
  "donchian-channels": {
    goals: ["follow-trends", "understand-volatility"],
    prompt:
      "Plot a 14-period Donchian Channel on the price chart with the highest high, lowest low and their midpoint. Include the current bar in the window.",
    description:
      "Marks the highest high and lowest low inside the rolling window, plus their midpoint. The channel's width shows the recent price range, and its edges show where new extremes form. Because this version includes the current bar, its boundaries update when that bar sets a new high or low.",
  },
  "keltner-channel": {
    goals: ["understand-volatility", "follow-trends"],
    prompt:
      "Plot a Keltner Channel of closing prices on the price chart using length 14 and multiplier 2. Show the basis and both channel lines, with configurable source, length and multiplier.",
    description:
      "Places range-based boundaries around a smoothed price basis. Wider channels describe larger recent ranges, while narrower channels describe smaller ranges. Compare price with the basis and boundaries to examine both direction and distance from its recent smoothed level.",
  },
  "parabolic-sar": {
    goals: ["follow-trends", "find-reversals"],
    prompt:
      "Plot Parabolic SAR on the price chart using start 0.02, increment 0.02 and maximum 0.2, with each parameter configurable.",
    description:
      "Tracks an accelerating price reference that switches sides when its reversal condition is met. Values below price describe the upward-tracking phase; values above price describe the downward-tracking phase. This version plots the SAR values and does not create orders or separate signal annotations.",
  },
  "price-channel": {
    goals: ["follow-trends", "understand-volatility"],
    prompt:
      "Plot a 14-period Price Channel on the price chart using the rolling highest high, lowest low and their midpoint, including the current bar.",
    description:
      "Shows the range occupied by the most recent bars. Read the upper and lower boundaries as rolling price extremes, and their separation as range width. This bundled version uses the same calculation as Donchian Channels and includes the current bar in each boundary.",
  },
  "standard-deviation": {
    goals: ["understand-volatility"],
    prompt:
      "Plot the 14-period standard deviation of closing prices in a separate pane, with configurable source and length.",
    description:
      "Measures how widely prices are dispersed around their average in the selected window. Higher readings mean greater dispersion and lower readings mean tighter clustering. Values use the instrument's price units, so compare them with that instrument's own history.",
  },
  supertrend: {
    goals: ["follow-trends", "understand-volatility"],
    prompt:
      "Plot SuperTrend on the price chart using ATR length 14 and factor 3, with configurable length and factor. Show the trend line only.",
    description:
      "Uses an ATR-based trailing calculation to follow price through upward and downward phases. The line's side relative to price provides the current phase, while its distance reflects the volatility factor. This version shows the line without buy/sell labels or order execution.",
  },
  "accumulation-distribution": {
    goals: ["read-volume", "find-reversals"],
    prompt:
      "Plot an Accumulation/Distribution line in a separate pane. Weight volume by the close's position within the high-low range and accumulate those values, using zero contribution for a zero-range bar.",
    description:
      "Accumulates volume weighted by where each bar closes in its range. Closes toward the high add positive contribution; closes toward the low add negative contribution. Compare the line's direction with price to inspect whether this range-based volume measure is moving with or against it.",
  },
  "chaikin-money-flow": {
    goals: ["read-volume", "find-reversals"],
    prompt:
      "Plot 14-period Chaikin Money Flow in a separate pane. Weight volume by each close's position within the high-low range, then divide its 14-period SMA by the 14-period SMA of volume.",
    description:
      "Measures the recent balance of range-position-weighted volume. Positive values favor volume on bars closing toward their highs; negative values favor bars closing toward their lows. It describes this closing-position relationship, rather than measuring actual buyer and seller transactions separately.",
  },
  "chaikin-oscillator": {
    goals: ["read-volume", "find-reversals"],
    prompt:
      "Plot a Chaikin Oscillator in a separate pane. Build the cumulative Accumulation/Distribution line from each close's range position and volume, then subtract its 10-period EMA from its 3-period EMA.",
    description:
      "Shows momentum in the Accumulation/Distribution line by comparing two smoothed versions. Positive values place the faster average above the slower one; negative values place it below. Movement toward zero shows that the difference between them is narrowing.",
  },
  "ease-of-movement": {
    goals: ["read-volume", "follow-trends"],
    prompt:
      "Plot 14-period Ease of Movement in a separate pane. Multiply the change in each bar's midpoint by its high-low range, divide by volume, and smooth the result with a 14-period SMA.",
    description:
      "Relates midpoint movement and range to the amount of traded volume. Positive values describe upward midpoint movement; negative values describe downward movement. Larger magnitudes indicate more movement relative to volume in this calculation, not a direct measure of order-book liquidity.",
  },
  "elder-s-force-index": {
    goals: ["read-volume", "follow-trends", "find-reversals"],
    prompt:
      "Plot Elder's Force Index in a separate pane as a 14-period EMA of the one-bar closing-price change multiplied by volume.",
    description:
      "Combines the direction and size of price changes with volume, then smooths them. Positive readings favor rising closes with volume; negative readings favor falling closes with volume. A diminishing magnitude can show that this combined measure is weakening even while price continues in one direction.",
  },
  mfi: {
    goals: ["read-volume", "find-reversals"],
    prompt:
      "Plot a 14-period Money Flow Index in a separate pane, using the average of high, low and close as the price source.",
    description:
      "Combines typical price and volume into a bounded money-flow measure. High values describe a greater share of positive money flow in the window; low values describe a greater share of negative flow. It provides context for price extremes without proving that a reversal is imminent.",
  },
  "net-volume": {
    goals: ["read-volume"],
    prompt:
      "Plot Net Volume as a histogram in a separate pane. Use positive volume when close rises from the previous close, negative volume when it falls, and zero when it is unchanged.",
    description:
      "Assigns each bar's volume a sign from its close-to-close price direction. Positive bars correspond to higher closes and negative bars to lower closes. This is signed bar volume, not actual buy-volume minus sell-volume from individual trades.",
  },
  obv: {
    goals: ["read-volume", "follow-trends", "find-reversals"],
    prompt:
      "Plot On-Balance Volume in a separate pane. Add volume on bars with a higher close, subtract it on bars with a lower close, and add zero on unchanged closes.",
    description:
      "Accumulates volume according to close-to-close price direction. A rising line means more accumulated volume has accompanied rising closes; a falling line means the opposite. Compare its direction with price rather than its absolute level, which depends on the available history.",
  },
  "price-volume-trend": {
    goals: ["read-volume", "follow-trends", "find-reversals"],
    prompt:
      "Plot Price Volume Trend in a separate pane by accumulating each bar's volume multiplied by its fractional close-to-close price change. Use zero contribution when the previous close is unavailable or zero.",
    description:
      "Accumulates volume weighted by the size and direction of the percentage price change. Larger changes contribute more than smaller changes at the same volume. Compare its direction with price; its absolute value depends on the available execution history.",
  },
  vwap: {
    goals: ["read-volume", "follow-trends"],
    prompt:
      "Plot cumulative VWAP on the price chart as cumulative typical-price times volume divided by cumulative volume. Accumulate over all available execution history, including warmup, without a session or daily reset.",
    description:
      "Shows the volume-weighted average of typical prices over the available execution history. Price above or below it is above or below that accumulated average. This version includes warmup history and does not reset at session boundaries, so it is not a session VWAP or an anchored VWAP tool.",
  },
  volume: {
    goals: ["read-volume"],
    prompt: "Plot each bar's traded volume as a histogram in a separate pane.",
    description:
      "Shows how much volume was recorded in each bar. Taller bars indicate greater activity and shorter bars indicate less. Compare volume with nearby bars and the accompanying price movement; volume alone does not distinguish buying from selling.",
  },
  "volume-oscillator": {
    goals: ["read-volume"],
    prompt:
      "Plot a Volume Oscillator in a separate pane using a 5-period fast EMA and 10-period slow EMA of volume. Show their difference as a percentage of the slow EMA.",
    description:
      "Compares short and longer averages of trading activity. Positive values mean the fast volume average is above the slow one; negative values mean it is below. It describes rising or falling activity without choosing the direction of price.",
  },
};

/** Bundled discovery content; parameters and outputs always belong to each Tea file. */
const originalCatalog = indicatorTemplates.map((entry) => ({
  ...entry,
  path: `indicators/builtin/${entry.id}.tea`,
  ...indicatorDiscovery[entry.id],
}));

/** Curated studies share the same install path and compiler-owned inputs as originals. */
export const indicatorCatalog: {
  id: string;
  name: string;
  category: string;
  path: string;
  goals: readonly IndicatorGoal[];
  prompt: string;
  description: string;
  discovery?: { rank: number; headline: string };
}[] = [
  ...originalCatalog,
  ...featuredStudies.map((entry, rank) => ({
    ...entry,
    path: `indicators/builtin/${entry.id}.tea`,
    discovery: { rank, headline: entry.headline },
  })),
];

/** Canonical paths of built-in originals in the default workspace; copies are ordinary files. */
export const builtinIndicatorPaths: ReadonlySet<string> = new Set(
  [...indicatorCatalog, ...chartBuiltins].map(({ path }) => path),
);
