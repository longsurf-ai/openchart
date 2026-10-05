// Purpose: A concrete static multi-input Advanced alert using typed per-occurrence subjects.
import type { BarsSeries } from "@openchart/feed";
import * as Tea from "@openchart/tea";

/**
 * Create a definition for a fixed list of series against a benchmark.
 * Each named request computes its own one-bar percentage return. The root
 * compares it with the benchmark and with the previous five residual returns'
 * population deviation. Input paths keep occurrence identity correct even if
 * Parameters later rebinds a request. This is a static request tree; universe
 * discovery and dynamic request addition are not supported.
 * @example const definition = residualVolatilityExample(benchmark, fiftyStocks);
 */
export function residualVolatilityExample(
  benchmark: BarsSeries,
  subjects: readonly BarsSeries[],
): {
  readonly kind: "tea";
  readonly source: string;
  readonly config: Tea.NodeConfig;
} {
  const parameters = { window: 5, multiplier: 3 };
  return {
    kind: "tea",
    source: [
      "import ta",
      'window = input.int(5, "Volatility bars", minval = 2)',
      'multiplier = input.float(3.0, "Deviation multiple", minval = 0.0)',
      "struct Signal",
      "    array<string> input",
      "    float residual",
      "    float volatility",
      "benchmark = ta.roc(close, 1)",
      ...subjects.flatMap((subject, index) => [
        `stock_${index} = request.security(${JSON.stringify(subject.listing.symbol)}, "1", ta.roc(close, 1))`,
        `residual_${index} = stock_${index} - benchmark`,
        `volatility_${index} = ta.stdev(residual_${index}[1], window)`,
        `alert("residual", volatility_${index} > 0 and math.abs(residual_${index}) > multiplier * volatility_${index}, "Residual move", "Return exceeds its recent volatility", Signal.new(array.from("stock_${index}"), residual_${index}, volatility_${index}))`,
      ]),
    ].join("\n"),
    config: {
      ...Tea.barsInputs(benchmark),
      parameters,
      requests: Object.fromEntries(
        subjects.map((subject, index) => [
          `stock_${index}`,
          { ...Tea.barsInputs(subject), parameters, requests: {} },
        ]),
      ),
    },
  };
}
