// Purpose: Curate visually distinct built-in studies; executable defaults and rendering remain in their Tea sources.

/** The editorial collection shown in discovery order, with prompts that recreate actual source behavior. */
export const featuredStudies = [
  {
    id: "supertrend-regime",
    name: "Supertrend Regime",
    category: "Trend",
    goals: ["follow-trends"],
    headline: "See when a trend changes",
    description:
      "An ATR trail changes side when price crosses it. Teal marks the upward state and coral the downward state; the shaded space shows the distance from the price midpoint. A triangle appears only when a closed bar changes the state, and does not predict what happens next.",
    prompt:
      "Create a Supertrend overlay with ATR length 10 and multiplier 3. Draw separate teal upward and coral downward trails, fill between each active trail and the price midpoint, and label confirmed direction changes Trend up or Trend down.",
  },
  {
    id: "ichimoku-cloud",
    name: "Ichimoku Cloud",
    category: "Trend",
    goals: ["follow-trends"],
    headline: "Find your way through the cloud",
    description:
      "A cloud combines short, medium and longer price ranges. The 9/26-period midpoint lines form leading span A; the 52-period midpoint forms span B, both displayed 26 bars forward. Compare price with the cloud at its actual chart position; the forward offset is a display convention, not future data.",
    prompt:
      "Create the complete Ichimoku overlay with conversion 9, base 26, span B 52 and displacement 26. Plot conversion and base lines, fill between the forward-shifted leading spans by their relative direction, show closing price 26 bars behind, and label confirmed closes crossing above or below the currently displayed cloud.",
  },
  {
    id: "guppy-ribbon",
    name: "Guppy Ribbon",
    category: "Trend",
    goals: ["follow-trends"],
    headline: "Watch a trend gather breadth",
    description:
      "Two groups of moving averages show short and longer price trends. The teal group uses lengths 3, 5, 8, 10, 12 and 15; the violet group uses 30, 35, 40, 45, 50 and 60. Separation describes different average speeds, while compression shows the groups drawing together.",
    prompt:
      "Plot a Guppy ribbon using teal EMAs of 3, 5, 8, 10, 12 and 15 bars and violet EMAs of 30, 35, 40, 45, 50 and 60 bars. Fill within each group and mark a confirmed 15-period EMA crossing above the 30-period EMA as Ribbon expansion.",
  },
  {
    id: "heikin-ashi-trend",
    name: "Heikin-Ashi Trend",
    category: "Trend",
    goals: ["follow-trends"],
    headline: "Read the rhythm of a trend",
    description:
      "Average-price candles make sustained direction easier to see. These candles are calculated from real OHLC bars, but their bodies and wicks are derived values rather than prices at which trades necessarily occurred. Their own pane keeps this distinction from the original price chart.",
    prompt:
      "Create Heikin-Ashi candles in a separate pane. Use OHLC4 for the close, the previous Heikin-Ashi open/close midpoint for the open, and the extremes of raw high/low and the derived body for wicks. Color rising average candles teal and falling ones rose, and mark confirmed color changes.",
  },
  {
    id: "chandelier-exit",
    name: "Chandelier Exit",
    category: "Trend",
    goals: ["follow-trends"],
    headline: "Give a trend room to breathe",
    description:
      "Volatility-adjusted exit levels follow recent price extremes. The gold level is the 22-bar high minus three ATRs, while the violet level is the 22-bar low plus three ATRs. Their crossings describe the selected trailing rules; they are reference levels rather than placed orders.",
    prompt:
      "Plot Chandelier Exit using a 22-bar lookback and ATR length, with multiplier 3. Show the long and short exit levels as gold and violet step lines, and label closed-bar price crossings of those levels.",
  },
  {
    id: "donchian-breakout",
    name: "Donchian Breakout",
    category: "Volatility",
    goals: ["find-breakouts", "follow-trends"],
    headline: "Spot a move beyond the range",
    description:
      "The previous 20 bars define a channel that today can actually break. Teal and clay edges track prior highs and lows; triangles identify closed-bar crossings. The current bar is excluded from the channel so the breakout rule never moves its own target.",
    prompt:
      "Draw a filled Donchian channel using the highest high and lowest low of the previous 20 completed bars. Include the midpoint and annotate confirmed closes crossing above or below the previous channel.",
  },
  {
    id: "bollinger-squeeze",
    name: "Bollinger Squeeze",
    category: "Volatility",
    goals: ["find-breakouts", "understand-volatility"],
    headline: "Watch compression become expansion",
    description:
      "Narrow bands reveal unusually quiet price movement. A violet squeeze begins when bandwidth enters the lowest 20 percent of its 100-bar ranking window. Expansion markers require the first release bar to close outside a band; a squeeze alone says nothing about direction.",
    prompt:
      "Create 20-period Bollinger Bands at two standard deviations. Rank normalized bandwidth over 100 bars, shade rank values below 20 as a squeeze, label squeeze starts, and annotate releases only when the first bar leaving the squeeze closes above the upper band or below the lower band.",
  },
  {
    id: "squeeze-momentum",
    name: "Squeeze Momentum",
    category: "Momentum",
    goals: ["find-breakouts", "understand-volatility"],
    headline: "See energy build beneath price",
    description:
      "A momentum histogram sits beneath periods of compressed volatility. The background changes when two-deviation Bollinger Bands fit inside 1.5-ATR Keltner bands. Four bar colors distinguish positive/negative momentum that is growing or shrinking; the release diamond reports the end of compression.",
    prompt:
      "Create a 20-bar squeeze study in a separate pane. Detect two-standard-deviation Bollinger Bands inside EMA plus/minus 1.5 ATR. Plot the linear-regression endpoint of close minus the average of the range midpoint and SMA, use four colors for sign and direction of change, shade squeeze periods, and label confirmed releases.",
  },
  {
    id: "keltner-extension",
    name: "Keltner Extension",
    category: "Volatility",
    goals: ["find-breakouts", "understand-volatility"],
    headline: "Recognize an extended move",
    description:
      "ATR envelopes put price departures into volatility context. The center is a 20-period EMA, with bands two 10-period ATRs away. A marker identifies the first confirmed crossing outside an envelope; strong trends can remain outside rather than reverse immediately.",
    prompt:
      "Plot a 20-period EMA with envelopes two times the 10-period ATR above and below it. Use two subtly different filled halves and mark confirmed closes crossing beyond either envelope.",
  },
  {
    id: "relative-volume-breakout",
    name: "Relative Volume Breakout",
    category: "Volume",
    goals: ["find-breakouts", "read-volume"],
    headline: "Ask whether volume joins the move",
    description:
      "Volume multiples compare activity with the previous 20-bar average. The unusual-volume threshold defaults to 2×. Price markers additionally require a close beyond the previous 20-bar price range; ordinary high-volume bars remain visible without being called breakouts.",
    prompt:
      "Plot volume divided by the previous 20-bar average as columns with 1× and 2× guides. Highlight unusual volume by candle direction, and put a Volume breakout or Volume breakdown annotation on the price pane only when a confirmed unusual-volume bar also closes beyond the prior 20-bar range.",
  },
  {
    id: "rsi-divergence",
    name: "RSI Divergence",
    category: "Momentum",
    goals: ["find-reversals"],
    headline: "Notice when momentum disagrees",
    description:
      "Price and RSI can move in opposite directions at confirmed swing points. Rose lines connect higher price highs with lower RSI readings; teal lines connect lower lows with higher RSI readings. Each pivot needs five later bars to confirm, and the confirmation marker is placed when that information becomes available.",
    prompt:
      "Plot RSI(14) with 30 and 70 thresholds and subtle neutral shading. Compare successive price pivots confirmed with five bars on each side and at most 100 bars apart. Connect higher price highs with lower RSI values for bearish divergence, and lower price lows with higher RSI values for bullish divergence in both panes. Mark the confirmation bar rather than implying the divergence was known at the pivot.",
  },
  {
    id: "macd-momentum",
    name: "MACD Momentum",
    category: "Momentum",
    goals: ["find-reversals", "follow-trends"],
    headline: "See momentum strengthen and fade",
    description:
      "A four-color histogram separates momentum direction from acceleration. The gold MACD and violet signal lines show the 12/26/9 calculation, while the filled spread matches their difference. A confirmed upward crossover is a change in that relationship, not a promised price reversal.",
    prompt:
      "Create MACD with fast 12, slow 26 and signal 9. Draw a four-color histogram that distinguishes positive/negative and growing/shrinking values, plot and subtly fill between MACD and signal lines, add a zero guide, and annotate confirmed upward signal crossings.",
  },
  {
    id: "smi-extremes",
    name: "SMI Extremes",
    category: "Momentum",
    goals: ["find-reversals"],
    headline: "Locate price within its recent range",
    description:
      "The Stochastic Momentum Index measures distance from the range midpoint. Double smoothing turns this into a signed area around zero, with guides at −40 and +40 and a three-period signal line. A lower-zone exit marks a change in momentum, while extremes can persist.",
    prompt:
      "Calculate SMI over a 10-bar range using double EMA smoothing of 3. Plot the signed SMI as a two-color area, a three-period EMA signal, zero and ±40 guides, and annotate confirmed crossings back above −40.",
  },
  {
    id: "stochastic-rsi-zones",
    name: "Stochastic RSI Zones",
    category: "Momentum",
    goals: ["find-reversals"],
    headline: "Catch a turn inside an extreme",
    description:
      "Two smoothed lines place RSI within its own recent range. Filled crossings and 20/80 guides make changes near the edges easy to read. Markers require K to cross D while both the crossing value and the relevant threshold agree.",
    prompt:
      "Compute RSI(14), then its 14-bar stochastic position with three-bar K and D smoothing. Plot teal K and violet D with a directional fill, add 20/80 thresholds, and label confirmed bullish crosses below 20 and bearish crosses above 80.",
  },
  {
    id: "fisher-turns",
    name: "Fisher Turns",
    category: "Momentum",
    goals: ["find-reversals"],
    headline: "Make changes near extremes visible",
    description:
      "A nonlinear transform emphasizes changes near the edges of a price range. Gold and violet areas show its sign; the muted line is its previous value. Markers identify confirmed turns from beyond ±1.5, a descriptive threshold rather than a probability or universal reversal level.",
    prompt:
      "Normalize midpoint prices over 14 bars using the recursive Fisher calculation, clamp the normalized value to ±0.999, and plot the Fisher value as a signed two-color area with a previous-bar signal. Mark confirmed upward turns from below −1.5 and downward turns from above +1.5.",
  },
  {
    id: "anchored-vwap-bands",
    name: "Volume-Anchored VWAP Bands",
    category: "Volume",
    goals: ["read-volume", "follow-trends"],
    headline: "Follow value after a volume event",
    description:
      "A new volume peak restarts a volume-weighted price and its deviation bands. Each bar exceeding the previous 63 bars of volume becomes an anchor; before the first event, accumulation begins at the first supplied bar. The bands use weighted daily typical prices, not individual transaction prices.",
    prompt:
      "Anchor VWAP whenever volume exceeds every one of the previous 63 bars, beginning at the first supplied bar until the first such event. Accumulate typical-price times volume and its weighted square, draw a gold VWAP with bands at 1.5 weighted standard deviations, fill the envelope, and label confirmed volume anchors.",
  },
  {
    id: "money-flow-pressure",
    name: "Money Flow Pressure",
    category: "Volume",
    goals: ["read-volume"],
    headline: "Read pressure as an area",
    description:
      "Chaikin Money Flow combines volume with where each bar closes inside its range. Teal and rose areas sit on either side of zero, with reference thresholds at ±0.05. This is an OHLCV pressure estimate; it does not observe aggressor buy/sell orders.",
    prompt:
      "Calculate 21-period Chaikin Money Flow, using zero contribution for flat bars and zero when average volume is zero. Draw a teal positive and rose negative area around zero, add ±0.05 guides, and label confirmed threshold crossings.",
  },
  {
    id: "money-flow-extremes",
    name: "Money Flow Extremes",
    category: "Volume",
    goals: ["read-volume", "find-reversals"],
    headline: "Look for stretched volume-weighted momentum",
    description:
      "MFI weighs changes in typical price by traded volume. Tinted 0–20 and 80–100 zones make extreme readings visible, and arrows mark confirmed returns out of those zones. A return reports a change in this oscillator, not a verified shift in actual order flow.",
    prompt:
      "Plot Money Flow Index(14), shade the 0–20 and 80–100 zones, and label confirmed crossings back above 20 or below 80.",
  },
  {
    id: "obv-divergence",
    name: "OBV Divergence",
    category: "Volume",
    goals: ["read-volume", "find-reversals"],
    headline: "Compare price swings with cumulative volume",
    description:
      "On-balance volume may fail to follow a new price extreme. The area accumulates whole-bar volume by closing-price direction; connecting lines show opposite changes at successive confirmed price pivots. Confirmation takes five later bars, and OBV is a directional-volume proxy rather than transaction-level flow.",
    prompt:
      "Accumulate on-balance volume by close-to-close direction and plot it as a teal area. Compare successive price pivots confirmed by five bars on either side and at most 100 bars apart. Connect bearish and bullish divergences on both the price and OBV panes, with markers on the confirmation bars.",
  },
  {
    id: "force-index-bursts",
    name: "Force Index Bursts",
    category: "Volume",
    goals: ["read-volume", "follow-trends"],
    headline: "Find a volume-backed price impulse",
    description:
      "Price changes gain weight when more volume trades. A 13-period EMA of close-to-close change times volume forms signed columns, with guides at two standard deviations of its last 63 values. Bright bars and annotations show unusually large impulses relative to that window, not actual buyer/seller order flow.",
    prompt:
      "Calculate Elder Force Index as a 13-period EMA of close-to-close price change times volume. Plot signed teal and violet columns with guides at plus/minus two standard deviations over 63 bars. Brighten values beyond those guides and annotate confirmed outward threshold crossings.",
  },
  {
    id: "atr-percentile",
    name: "ATR Percentile",
    category: "Volatility",
    goals: ["understand-volatility"],
    headline: "Put today’s volatility in context",
    description:
      "A percentile compares relative ATR with its own recent history. ATR(14) is divided by absolute closing price and ranked across 100 bars. The 20/80 guides identify quieter and more volatile windows; a percentile is not a probability of a future move.",
    prompt:
      "Rank 100 times ATR(14) divided by absolute close over a 100-bar window. Plot the percentile as an area with different colors below 20, between 20 and 80, and above 80. Add threshold guides and annotate confirmed crossings above 80.",
  },
  {
    id: "choppiness-regime",
    name: "Choppiness Regime",
    category: "Volatility",
    goals: ["understand-volatility"],
    headline: "Separate a trend from a churn",
    description:
      "The path traveled is compared with the distance covered. A 14-bar Choppiness Index receives violet background above 61.8 and teal below 38.2. Lower values describe more directional movement, but do not say whether that direction is up or down.",
    prompt:
      "Compute the 14-bar Choppiness Index from summed true range divided by the high-low span. Show 38.2 and 61.8 guides, shade directional and choppy regimes, and annotate confirmed entries below 38.2. Return no value when the price span is zero.",
  },
  {
    id: "underwater-drawdown",
    name: "Underwater Drawdown",
    category: "Volatility",
    goals: ["understand-volatility"],
    headline: "See how far price is below its peak",
    description:
      "An underwater area measures the close below its rolling 252-bar high. A rose threshold defaults to a 10 percent decline. The rolling peak can expire as the window moves, and this depicts asset-price drawdown rather than the drawdown of a trading strategy.",
    prompt:
      "Plot 100 times close divided by the highest close of the last 252 bars minus 100 as an underwater area. Add zero and −10 percent guides, deepen the color below the threshold, and annotate confirmed crossings below it.",
  },
  {
    id: "regression-channel",
    name: "Regression Channel",
    category: "Volatility",
    goals: ["understand-volatility", "follow-trends"],
    headline: "Measure departures from a fitted trend",
    description:
      "A rolling least-squares curve is surrounded by residual bands. Each 50-bar fit uses the square-root mean squared residual of its own fitted line, with a multiplier of two. The envelope describes recent dispersion; it is neither a forecast nor a statistical confidence interval.",
    prompt:
      "Fit a 50-bar linear regression of close on every bar. Compute the RMS residual against that same fitted line across all 50 observations, draw bands two residual deviations from the endpoint, fill the channel, and annotate confirmed upper-band crossings.",
  },
  {
    id: "directional-strength",
    name: "Directional Strength",
    category: "Momentum",
    goals: ["understand-volatility", "follow-trends"],
    headline: "Distinguish direction from strength",
    description:
      "A filled spread separates positive and negative directional movement. Teal or rose indicates which DI line is higher, while the gold ADX measures strength independently. A marker appears when ADX crosses 25, a configurable reference rather than a universal trend guarantee.",
    prompt:
      "Plot +DI, −DI and ADX with length 14. Fill the space between the DI lines according to which is higher, draw a gold ADX and a threshold at 25, and label confirmed upward ADX threshold crossings.",
  },
  {
    id: "confirmed-swing-map",
    name: "Confirmed Swing Map",
    category: "Structure",
    goals: ["read-structure"],
    headline: "Read the sequence of highs and lows",
    description:
      "Confirmed turning points reveal the shape of price movement. Connecting segments and HH/HL/LH/LL labels compare successive highs and lows. A pivot requires five later bars, so labels sit on the historical pivot only after confirmation; this is a swing map, not a full Chan or Elliott-wave model.",
    prompt:
      "Detect strict price pivots with five bars on each side. Connect successive confirmed unambiguous pivot points, color segments by direction, and label higher highs, lower highs, higher lows and lower lows at the pivot. Only create them when the confirmation bar closes, and omit simultaneous high/low pivots from the connecting path.",
  },
  {
    id: "structure-breaks",
    name: "Structure Breaks",
    category: "Structure",
    goals: ["read-structure", "find-breakouts"],
    headline: "Notice a break of a confirmed swing",
    description:
      "A closed-bar crossing breaks the latest confirmed high or low. Horizontal segments connect the swing level to its first break, while unbroken levels remain visible. Five later bars are required to establish each pivot before any break can count.",
    prompt:
      "Track price pivots confirmed with five bars on both sides. Draw the latest unbroken high and low as steps, and on the first confirmed close crossing each level draw a horizontal segment from the pivot to the break plus a confirmation marker. Reset each tracked level only when a new pivot confirms.",
  },
  {
    id: "fair-value-gaps",
    name: "Fair Value Gap Zones",
    category: "Structure",
    goals: ["read-structure"],
    headline: "Track a gap and its return",
    description:
      "Three-bar gaps become shaded price zones. The current low above the high two bars earlier defines an upward gap; the inverse defines a downward gap, filtered by 0.15 ATR. Track the newest zone of each direction until price reaches its far edge; the geometry does not establish institutional orders or fair value.",
    prompt:
      "Detect confirmed three-bar upward and downward gaps at least 0.15 ATR(14) wide. Track the latest gap of each direction as a shaded rectangle, extend it through time until its far edge is touched, fade filled zones, and label formation and full-fill events.",
  },
  {
    id: "swing-fibonacci",
    name: "Swing Fibonacci",
    category: "Structure",
    goals: ["read-structure"],
    headline: "Map the retracement of a swing",
    description:
      "A confirmed swing supplies the endpoints for horizontal retracement levels. The 38.2, 50 and 61.8 percent levels sit inside a subtle zone, with endpoints also shown. The 50 percent guide is a conventional midpoint, and all levels are descriptive references rather than predictions.",
    prompt:
      "Use alternating price pivots confirmed with eight bars on each side to select the most recent completed swing. Draw its endpoint and origin, 38.2, 50 and 61.8 percent retracement levels, and a shaded 38.2–61.8 zone extending to the current bar. Keep the selected swing until another opposite pivot confirms.",
  },
  {
    id: "pivot-zones",
    name: "Confirmed Pivot Zones",
    category: "Structure",
    goals: ["read-structure"],
    headline: "Watch price revisit a known level",
    description:
      "Narrow areas turn confirmed pivots into explicit testable zones. Each zone uses a half-width of 0.3 ATR measured at its pivot and starts on the confirmation bar. The newest support and resistance remain active until a close passes their far edge; touches are observations, not proof of future rejection.",
    prompt:
      "Confirm price pivots with five bars on each side. Create support and resistance zones with half-width 0.3 ATR(14) measured at the pivot, beginning only at confirmation. Track the latest of each, hide it after a close beyond its far edge, and annotate the first bar of each visit into an active zone.",
  },
] as const;

/** Stable identities of the complete curated collection. */
export const featuredStudyIds = featuredStudies.map((study) => study.id);

/** Six complementary introductions used for the library's first view. */
export const featuredHeroIds = [
  "supertrend-regime",
  "bollinger-squeeze",
  "rsi-divergence",
  "anchored-vwap-bands",
  "money-flow-pressure",
  "confirmed-swing-map",
] as const;
