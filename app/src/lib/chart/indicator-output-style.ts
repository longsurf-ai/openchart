// Purpose: Apply product-specific indicator names, theme colors, bands, and axis defaults.

export type IndicatorOutputSeriesType =
  "Line" | "Histogram" | "Area" | "Candlestick";

export type IndicatorOutputStyleInput = {
  definitionName?: string | null;
  outputName: string;
  seriesType: IndicatorOutputSeriesType;
  /** Declaration order supplies distinct defaults for otherwise unrecognized outputs. */
  outputIndex?: number;
};

type IndicatorColorName =
  | "blue"
  | "orange"
  | "teal"
  | "cyan"
  | "purple"
  | "magenta"
  | "amber"
  | "green"
  | "muted";

const INDICATOR_COLOR_FALLBACKS: Record<IndicatorColorName, string> = {
  blue: "#4f8df7",
  orange: "#e79b3a",
  teal: "#4dbd9b",
  cyan: "#46bfe0",
  purple: "#a27ae8",
  magenta: "#e16672",
  amber: "#e6b94e",
  green: "#55b86a",
  muted: "#9aa1ad",
};

const INDICATOR_COLOR_ORDER: readonly IndicatorColorName[] = [
  "blue",
  "orange",
  "teal",
  "cyan",
  "purple",
  "magenta",
  "amber",
  "green",
];

const LEGACY_INDICATOR_DEFAULT_COLORS = new Set([
  "#2962ff",
  "#ff6d00",
  "#26a69a",
  "#4dd0e1",
  "#9b6df3",
  "#f06292",
  "#f2c94c",
  "#66bb6a",
  "#8a8f98",
  "#ff5252",
  "#b2dfdb",
  "#ffcdd2",
  "#6978d5",
  "#d99a38",
  "#3fa987",
  "#31a9c8",
  "#8f74df",
  "#d66b88",
  "#6975d3",
  "#3aa682",
  "#d04343",
  "#1bbdee",
  "#fb8f23",
  "#8e66ea",
  "#394ac6",
  "#2d8065",
  "#b42d2d",
  "#0982ae",
  "#d0670b",
  "#5f36bf",
]);

const MOVING_AVERAGE_RIBBON_OUTPUT_COLORS: Record<string, string> = {
  ma1: "#2f6cff",
  ma2: "#357dff",
  ma3: "#3c8dff",
  ma4: "#429dff",
  ma5: "#48adff",
  ma6: "#4dbdff",
  ma7: "#9145d9",
  ma8: "#9b4bd6",
  ma9: "#a551d2",
  ma10: "#af57ce",
  ma11: "#b95dca",
  ma12: "#c363c6",
};

const MOVING_AVERAGE_RIBBON_DISPLAY_NAMES: Record<string, string> = {
  ma1: "EMA 3",
  ma2: "EMA 5",
  ma3: "EMA 8",
  ma4: "EMA 10",
  ma5: "EMA 12",
  ma6: "EMA 15",
  ma7: "EMA 30",
  ma8: "EMA 35",
  ma9: "EMA 40",
  ma10: "EMA 45",
  ma11: "EMA 50",
  ma12: "EMA 60",
};

function resolveCssColor(value: string): string | null {
  if (typeof document === "undefined" || !document.body) return null;
  const el = document.createElement("span");
  el.style.position = "absolute";
  el.style.pointerEvents = "none";
  el.style.visibility = "hidden";
  el.style.color = value;
  document.body.append(el);
  const resolved = getComputedStyle(el).color.trim();
  el.remove();
  return resolved || null;
}

function indicatorColor(name: IndicatorColorName): string {
  const fallback = INDICATOR_COLOR_FALLBACKS[name];
  if (typeof document === "undefined") return fallback;
  const token = getComputedStyle(document.documentElement)
    .getPropertyValue(`--indicator-${name}`)
    .trim();
  if (!token) return fallback;
  return resolveCssColor(token) ?? fallback;
}

function colorWithAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const value = hex[1]!;
    const red = Number.parseInt(value.slice(0, 2), 16);
    const green = Number.parseInt(value.slice(2, 4), 16);
    const blue = Number.parseInt(value.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(color);
  if (!rgb) return color;
  return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`;
}

function indicatorColorAlpha(name: IndicatorColorName, alpha: number): string {
  return colorWithAlpha(indicatorColor(name), alpha);
}

function normalizeStyleKey(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function titleFromKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

export function indicatorOutputDisplayName(input: {
  definitionName?: string | null;
  outputName: string;
}): string {
  const definition = normalizeStyleKey(input.definitionName);
  const output = normalizeStyleKey(input.outputName);

  if (definition === "movingaverageribbon") {
    return (
      MOVING_AVERAGE_RIBBON_DISPLAY_NAMES[output] ??
      titleFromKey(input.outputName)
    );
  }

  if (definition === "macd") {
    if (output === "macd") return "MACD";
    if (output === "signal") return "Signal";
    if (output === "histogram") return "Histogram";
  }

  if (definition === "rsi") {
    if (output === "rsi") return "RSI";
    if (output === "rsima") return "RSI-based MA";
    if (output === "upperband") return "Upper Band";
    if (output === "middleband") return "Middle Band";
    if (output === "lowerband") return "Lower Band";
  }

  if (definition === "stochastic" || definition === "stochasticrsi") {
    if (output === "k") return "%K";
    if (output === "d") return "%D";
  }

  if (definition === "aroon") {
    if (output === "aroonup") return "Aroon Up";
    if (output === "aroondown") return "Aroon Down";
  }

  if (
    definition === "bollingerbands" ||
    definition === "donchianchannels" ||
    definition === "envelopes" ||
    definition === "keltnerchannel" ||
    definition === "pricechannel"
  ) {
    if (output === "upper") return "Upper";
    if (output === "middle") return "Middle";
    if (output === "lower") return "Lower";
  }

  if (
    definition === "averagedirectionalindex" ||
    definition === "directionalmovement"
  ) {
    if (output === "plusdi") return "+DI";
    if (output === "minusdi") return "-DI";
    if (output === "adx") return "ADX";
  }

  if (definition === "chandekrollstop") {
    if (output === "longstop") return "Long Stop";
    if (output === "shortstop") return "Short Stop";
  }

  if (definition === "fishertransform") {
    if (output === "fisher") return "Fisher";
    if (output === "trigger") return "Trigger";
  }

  if (definition === "vortexindicator") {
    if (output === "viplus") return "VI+";
    if (output === "viminus") return "VI-";
  }

  if (output === "accdist") return "A/D";
  if (output === "averageprice") return "Average Price";
  if (output === "aroonup") return "Aroon Up";
  if (output === "aroondown") return "Aroon Down";
  if (output === "bbw") return "BBW";
  if (output === "chaikinoscillator") return "Chaikin Oscillator";
  if (output === "chaikinvolatility") return "Chaikin Volatility";
  if (output === "connorsrsi") return "Connors RSI";
  if (output === "coppock") return "Coppock";
  if (output === "histogram") return "Histogram";
  if (output === "linreg") return "Linear Regression";
  if (output === "longstop") return "Long Stop";
  if (output === "massindex") return "Mass Index";
  if (output === "mcginley") return "McGinley";
  if (output === "medianprice") return "Median Price";
  if (output === "percentb") return "%B";
  if (output === "priceoscillator") return "Price Oscillator";
  if (output === "shortstop") return "Short Stop";
  if (output === "stdev") return "StdDev";
  if (output === "supertrend") return "SuperTrend";
  if (output === "typicalprice") return "Typical Price";
  if (output === "ultimateoscillator") return "UO";
  if (output === "volumeoscillator") return "Volume Oscillator";

  const uppercaseOutputs = new Set([
    "alma",
    "cmo",
    "cmf",
    "dema",
    "efi",
    "eom",
    "hma",
    "kst",
    "lsma",
    "mfi",
    "obv",
    "pvt",
    "rci",
    "roc",
    "rsi",
    "rvi",
    "sma",
    "smma",
    "sar",
    "tsi",
    "tema",
    "trix",
    "uo",
    "ema",
    "wpr",
    "wma",
    "vwma",
    "vwap",
    "cci",
    "atr",
  ]);
  if (uppercaseOutputs.has(output)) return input.outputName.toUpperCase();

  return titleFromKey(input.outputName);
}

function defaultColorNameForIndicatorOutput(
  input: IndicatorOutputStyleInput,
): IndicatorColorName {
  const definition = normalizeStyleKey(input.definitionName);
  const output = normalizeStyleKey(input.outputName);

  if (definition === "movingaverageribbon") {
    return "blue";
  }

  if (definition === "macd") {
    if (output === "signal") return "orange";
    if (output === "histogram") return "teal";
    return "blue";
  }

  if (definition === "rsi") {
    if (output === "rsima") return "amber";
    if (
      output === "upperband" ||
      output === "middleband" ||
      output === "lowerband"
    )
      return "muted";
    return "purple";
  }

  if (definition === "stochastic" || definition === "stochasticrsi") {
    return output === "d" ? "orange" : "blue";
  }

  if (definition === "aroon") {
    return output === "aroondown" || output === "down" ? "magenta" : "green";
  }

  if (
    definition === "bollingerbands" ||
    definition === "donchianchannels" ||
    definition === "envelopes" ||
    definition === "pricechannel"
  ) {
    if (output === "middle" || output === "basis") return "amber";
    if (output === "lower") return "cyan";
    return "blue";
  }

  if (definition === "keltnerchannel") {
    if (output === "middle" || output === "basis") return "amber";
    if (output === "lower") return "cyan";
    return "purple";
  }

  if (
    definition === "averagedirectionalindex" ||
    definition === "directionalmovement"
  ) {
    if (output === "plusdi") return "green";
    if (output === "minusdi") return "magenta";
    return "amber";
  }

  if (definition === "vortexindicator") {
    return output === "viminus" || output === "minus" ? "magenta" : "green";
  }

  if (
    definition === "fishertransform" ||
    definition === "knowsurething" ||
    definition === "relativevigorindex"
  ) {
    return output === "signal" || output === "trigger" ? "orange" : "blue";
  }

  if (definition === "priceoscillator") {
    return "orange";
  }

  if (definition === "chandekrollstop") {
    return output === "shortstop" ? "magenta" : "green";
  }

  switch (definition) {
    case "acceleratoroscillator":
    case "awesomeoscillator":
    case "balanceofpower":
    case "netvolume":
    case "volume":
      return "teal";
    case "averageprice":
    case "medianprice":
    case "typicalprice":
      return "muted";
    case "arnaudlegouxmovingaverage":
    case "hullmovingaverage":
    case "leastsquaresmovingaverage":
    case "linearregressioncurve":
    case "smoothedmovingaverage":
    case "sma":
      return "blue";
    case "doubleema":
    case "ema":
      return "orange";
    case "tripleema":
    case "wma":
      return "purple";
    case "vwma":
      return "cyan";
    case "vwap":
      return "teal";
    case "choppinessindex":
    case "connorsrsi":
    case "relativevolatilityindex":
      return "purple";
    case "chandemomentumoscillator":
    case "cci":
      return "magenta";
    case "massindex":
    case "standarddeviation":
    case "atr":
      return "amber";
    case "accumulationdistribution":
    case "chaikinmoneyflow":
    case "easeofmovement":
    case "eldersforceindex":
    case "obv":
    case "pricevolumetrend":
      return "teal";
    case "chaikinoscillator":
    case "coppockcurve":
    case "momentum":
    case "rateofchange":
    case "trix":
    case "truestrengthindicator":
      return "blue";
    case "mfi":
    case "supertrend":
      return "green";
    case "chaikinvolatility":
    case "parabolicsar":
    case "rankcorrelationindex":
    case "ultimateoscillator":
    case "volumeoscillator":
    case "williamsr":
      return "cyan";
    case "mcginleydynamic":
      return "teal";
    default:
      if (input.outputIndex === undefined)
        return input.seriesType === "Histogram" ? "teal" : "blue";
      return (
        INDICATOR_COLOR_ORDER[
          input.outputIndex % INDICATOR_COLOR_ORDER.length
        ] ?? "blue"
      );
  }
}

function isChannelOutput(definition: string, output: string): boolean {
  return (
    (output === "upper" || output === "middle" || output === "lower") &&
    (definition === "bollingerbands" ||
      definition === "donchianchannels" ||
      definition === "envelopes" ||
      definition === "keltnerchannel" ||
      definition === "pricechannel")
  );
}

function isOverlayTrendDefinition(definition: string): boolean {
  return (
    definition === "sma" ||
    definition === "ema" ||
    definition === "wma" ||
    definition === "vwma" ||
    definition === "arnaudlegouxmovingaverage" ||
    definition === "hullmovingaverage" ||
    definition === "doubleema" ||
    definition === "tripleema" ||
    definition === "leastsquaresmovingaverage" ||
    definition === "linearregressioncurve" ||
    definition === "mcginleydynamic" ||
    definition === "movingaverageribbon" ||
    definition === "smoothedmovingaverage" ||
    definition === "vwap" ||
    definition === "supertrend"
  );
}

export function defaultIndicatorOutputSeriesOptions(
  input: IndicatorOutputStyleInput,
): Record<string, unknown> {
  const definition = normalizeStyleKey(input.definitionName);
  const output = normalizeStyleKey(input.outputName);
  const color = indicatorColor(defaultColorNameForIndicatorOutput(input));
  if (input.seriesType === "Histogram") {
    const base = {
      color,
      base: 0,
      positiveColor: indicatorColor("teal"),
      positiveFadedColor: indicatorColorAlpha("teal", 0.32),
      negativeColor: indicatorColor("magenta"),
      negativeFadedColor: indicatorColorAlpha("magenta", 0.32),
    };
    if (definition !== "macd") return base;
    return {
      ...base,
      color: indicatorColor("magenta"),
    };
  }

  if (
    definition === "rsi" &&
    (output === "upperband" ||
      output === "middleband" ||
      output === "lowerband")
  ) {
    return {
      color,
      lineWidth: 1,
      lineStyle: output === "middleband" ? "dotted" : "dashed",
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      fadeGradient: false,
    };
  }

  if (isChannelOutput(definition, output)) {
    return {
      color,
      lineWidth: 1,
      lineStyle: output === "middle" ? "dashed" : "solid",
      fadeGradient: false,
    };
  }

  if (definition === "parabolicsar") {
    return {
      color,
      lineWidth: 1,
      lineStyle: "dotted",
      fadeGradient: false,
    };
  }

  if (definition === "movingaverageribbon") {
    return {
      color:
        (input.outputIndex === undefined
          ? MOVING_AVERAGE_RIBBON_OUTPUT_COLORS[output]
          : Object.values(MOVING_AVERAGE_RIBBON_OUTPUT_COLORS)[
              input.outputIndex %
                Object.keys(MOVING_AVERAGE_RIBBON_OUTPUT_COLORS).length
            ]) ?? color,
      lineWidth: 1,
      fadeGradient: false,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
    };
  }

  if (isOverlayTrendDefinition(definition)) {
    return {
      color,
      lineWidth: 1,
      fadeGradient: false,
    };
  }

  return {
    color,
    lineWidth: 1,
    fadeGradient: false,
  };
}

function isLegacyIndicatorDefaultColor(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = normalizeColorValue(value);
  return normalized !== null && LEGACY_INDICATOR_DEFAULT_COLORS.has(normalized);
}

function normalizeColorValue(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{6})$/i.exec(trimmed);
  if (hex) return `#${hex[1]}`;

  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(trimmed);
  if (!rgb) return null;
  return `#${[rgb[1], rgb[2], rgb[3]]
    .map((component) =>
      Math.max(0, Math.min(255, Number(component)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function hasOption(options: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(options, key);
}

export function upgradeLegacyIndicatorOutputSeriesOptions(
  input: IndicatorOutputStyleInput,
  currentOptions: Record<string, unknown>,
): Record<string, unknown> {
  const definition = normalizeStyleKey(input.definitionName);
  const output = normalizeStyleKey(input.outputName);
  const next = defaultIndicatorOutputSeriesOptions(input);
  const patch: Record<string, unknown> = {};

  for (const key of [
    "color",
    "positiveColor",
    "positiveFadedColor",
    "negativeColor",
    "negativeFadedColor",
  ]) {
    if (
      hasOption(next, key) &&
      isLegacyIndicatorDefaultColor(currentOptions[key])
    ) {
      patch[key] = next[key];
    }
  }

  if (
    currentOptions.lineWidth === 2 &&
    hasOption(next, "lineWidth") &&
    (isOverlayTrendDefinition(definition) ||
      isChannelOutput(definition, output))
  ) {
    patch.lineWidth = next.lineWidth;
  }

  return patch;
}

export function indicatorBandFillOptions(input: {
  definitionName?: string | null;
  outputName: string;
  targetSeriesId: string;
}): Record<string, unknown> {
  const definition = normalizeStyleKey(input.definitionName);
  const output = normalizeStyleKey(input.outputName);
  if (definition !== "rsi" || output !== "upperband") return {};
  return {
    bandFillToSeriesId: input.targetSeriesId,
    bandFillColor: "rgba(155, 109, 243, 0.12)",
  };
}

export function indicatorAxisOptions(input: {
  definitionName?: string | null;
}): Record<string, unknown> {
  const definition = normalizeStyleKey(input.definitionName);
  if (definition !== "rsi") return {};
  return {
    autoScale: false,
    visibleExtent: { min: 0, max: 100 },
    margins: { top: 0.06, bottom: 0.06 },
  };
}
