# Tea in OpenChart

The sibling `../tea/introduction.md` describes the Tea language. This page owns
only OpenChart's bindings, tools and persistence. Read the relevant resource
schema through `resource_read` before creating or changing saved objects.

For implementation examples, the sibling `../tea-lib/` contains the shipped
standard-library `.tea` sources as ordinary readable files. The default Workspace
also contains built-in indicator sources under `indicators/builtin/`. Resolve
that Workspace's root through its Resource when using a different workspace.
Use these alongside the language guide and generated API reference; copy a
built-in to a new file before adapting it.

## Author and verify

Use `tea_check` with exactly one of `source` (self-contained code) or `path`
(a file in the current workspace, or an absolute file path). A check returns
`declaration` (the `indicator()` header, or null), `definition` and
`alertOutputs`. `definition` is the compiled script as JSON: its parameter
declarations, the columns it reads with default parameters (`inputs`), its
`outputs`, and one child definition per named request. Its schemas use the
same Arrow JSON form as a config. Build the config from it. A check with config
also validates bindings; it fetches no market data.

Use `tea_run` with source/path, config, and finite `[from,to)` epoch
millisecond bounds to inspect values and events. A Bars input loads market data;
a Samples input (below) uses only the bars you supply.

Derive expected behavior from the user requirement before running. Compare
returned event times, payloads and relevant numerical columns; `status: ok` is
not a behavioral assertion. Fix failures and recheck the exact source/config
that will be saved (a rule that follows an Indicator is checked as described
in "Save a Tea Alert"). Report which cases were actually verified.

## Config

A config says what one script reads and how it runs. It always has `inputs`,
`map`, `parameters` and `requests`. This one reads one Bars series; copy it and
change the series fields:

```json
{
  "inputs": {
    "bars": {
      "_tag": "Bars",
      "provider": "yfinance",
      "listing": { "symbol": "AAPL", "currency": "USD" },
      "resolution": "1m",
      "session": "regular",
      "adjustment": "split",
      "schema": {
        "fields": [
          {
            "name": "open",
            "nullable": true,
            "type": { "name": "floatingpoint", "precision": "DOUBLE" },
            "children": []
          },
          {
            "name": "high",
            "nullable": true,
            "type": { "name": "floatingpoint", "precision": "DOUBLE" },
            "children": []
          },
          {
            "name": "low",
            "nullable": true,
            "type": { "name": "floatingpoint", "precision": "DOUBLE" },
            "children": []
          },
          {
            "name": "close",
            "nullable": true,
            "type": { "name": "floatingpoint", "precision": "DOUBLE" },
            "children": []
          },
          {
            "name": "volume",
            "nullable": true,
            "type": { "name": "floatingpoint", "precision": "DOUBLE" },
            "children": []
          },
          {
            "name": "hl2",
            "nullable": true,
            "type": { "name": "floatingpoint", "precision": "DOUBLE" },
            "children": []
          },
          {
            "name": "hlc3",
            "nullable": true,
            "type": { "name": "floatingpoint", "precision": "DOUBLE" },
            "children": []
          },
          {
            "name": "ohlc4",
            "nullable": true,
            "type": { "name": "floatingpoint", "precision": "DOUBLE" },
            "children": []
          },
          {
            "name": "hlcc4",
            "nullable": true,
            "type": { "name": "floatingpoint", "precision": "DOUBLE" },
            "children": []
          }
        ]
      }
    }
  },
  "map": {
    "open": ["bars", ["open"]],
    "high": ["bars", ["high"]],
    "low": ["bars", ["low"]],
    "close": ["bars", ["close"]],
    "volume": ["bars", ["volume"]],
    "hl2": ["bars", ["hl2"]],
    "hlc3": ["bars", ["hlc3"]],
    "ohlc4": ["bars", ["ohlc4"]],
    "hlcc4": ["bars", ["hlcc4"]]
  },
  "parameters": {},
  "requests": {}
}
```

- `inputs` names each data source. A Bars input reads one Feed series:
  `provider`, `listing`, `resolution`, `session` and `adjustment`. Its `schema`
  lists the columns it carries, in Arrow's JSON form: `open`, `high`, `low`,
  `close` and `volume` are required; `hl2`, `hlc3`, `ohlc4` and `hlcc4` are
  optional and computed from OHLC. Copy the schema as shown.
- `map` says where each column the script reads comes from, as
  `"column": [input name, field path]`. The field path is usually the column
  name. It is longer for a value inside a struct: `["basis", "series"]` reads
  the number of a plot output `basis`. Every column the script reads with these
  parameters must be listed. That is checked against the script bound with
  these parameters, so an `input.source` parameter can need a column that
  `definition.inputs` (read with defaults) does not list. Extra columns are
  fine, so mapping every Bars column, as above, is normal.
- `parameters` are keyed by Tea declaration names (`length`), not labels
  (`Length`). Supply every declared parameter with its intended value, including
  defaults; never infer a parameter schema from visual labels.
- `requests` may hold a complete config per `request.security(...)` line,
  keyed by its variable name. Usually leave it `{}`: a child left out reads
  Bars of the listing its line names. Write that symbol as a ticker id,
  `provider:symbol`, such as `request.security("binance:ETHUSDT", "D", close)`;
  `syminfo.tickerid` is the script's own listing, and timeframe `""` keeps the
  script's timeframe. The provider must have that listing and serve the
  chart's session and adjustment, so a Binance chart cannot read Yahoo stocks
  this way. A config under
  `requests.daily` instead runs that child on exactly the inputs it names.

A NodeRef input reads another script that runs in the same call. These tools
give your script no other script to read, so a NodeRef fails. To read an
Indicator in an Alert, follow it instead (see below).

### Samples

To test on bars you supply, without fetching market data, give `tea_run` a
Samples input: copy the Bars input, change `"_tag"` to `"Samples"` and add
`rows`:

```json
[
  { "time": 60000, "open": 1, "high": 2, "low": 1, "close": 2, "volume": 5 },
  { "time": 120000, "open": 2, "high": 3, "low": 2, "close": 3, "volume": null }
]
```

Each row is a completed bar: `time` in epoch milliseconds, then `open`, `high`,
`low`, `close` and `volume` as finite numbers, or null for missing values. Times
strictly increase. Supply earlier rows when warmup needs them. A Samples input
keeps its series fields, so `syminfo` and `timeframe` work as with Bars. A
request child left out of `requests` loads Bars from Feed, so give each child
its own Samples to keep the whole run on supplied rows. Samples need a finite
window, so a saved Alert Rule takes Bars inputs only.

## Save a Tea Alert

An Alert Rule stores inline source in SQLite. Use `save_alert_rule` with
`{value: <the complete body below>}` to create it. For updates, first read the
Rule and also supply `rule: {id, expectedRevision}`. The shared Rule transition
compiles and validates every definition, including disabled Rules; generic
`resource_mutate` cannot write `alertable`. The value body is:

```json
{
  "name": "Descriptive name",
  "enabled": false,
  "repeat": true,
  "alertable": {
    "kind": "tea",
    "source": "complete Tea source here",
    "config": {
      "inputs": {
        "bars": {
          "_tag": "Bars",
          "provider": "yfinance",
          "listing": { "symbol": "AAPL", "currency": "USD" },
          "resolution": "1m",
          "session": "regular",
          "adjustment": "split",
          "schema": {
            "fields": [
              {
                "name": "open",
                "nullable": true,
                "type": { "name": "floatingpoint", "precision": "DOUBLE" },
                "children": []
              },
              {
                "name": "high",
                "nullable": true,
                "type": { "name": "floatingpoint", "precision": "DOUBLE" },
                "children": []
              },
              {
                "name": "low",
                "nullable": true,
                "type": { "name": "floatingpoint", "precision": "DOUBLE" },
                "children": []
              },
              {
                "name": "close",
                "nullable": true,
                "type": { "name": "floatingpoint", "precision": "DOUBLE" },
                "children": []
              },
              {
                "name": "volume",
                "nullable": true,
                "type": { "name": "floatingpoint", "precision": "DOUBLE" },
                "children": []
              },
              {
                "name": "hl2",
                "nullable": true,
                "type": { "name": "floatingpoint", "precision": "DOUBLE" },
                "children": []
              },
              {
                "name": "hlc3",
                "nullable": true,
                "type": { "name": "floatingpoint", "precision": "DOUBLE" },
                "children": []
              },
              {
                "name": "ohlc4",
                "nullable": true,
                "type": { "name": "floatingpoint", "precision": "DOUBLE" },
                "children": []
              },
              {
                "name": "hlcc4",
                "nullable": true,
                "type": { "name": "floatingpoint", "precision": "DOUBLE" },
                "children": []
              }
            ]
          }
        }
      },
      "map": {
        "open": ["bars", ["open"]],
        "high": ["bars", ["high"]],
        "low": ["bars", ["low"]],
        "close": ["bars", ["close"]],
        "volume": ["bars", ["volume"]],
        "hl2": ["bars", ["hl2"]],
        "hlc3": ["bars", ["hlc3"]],
        "ohlc4": ["bars", ["ohlc4"]],
        "hlcc4": ["bars", ["hlcc4"]]
      },
      "parameters": {},
      "requests": {}
    }
  }
}
```

Fill in the actual source, its declared parameters and the config you checked,
with Bars inputs. Choose `enabled` as requested; false saves a paused rule. `repeat`
controls whether observation continues after its first fire; it does not turn a
persistent Tea condition into a crossing. The source must emit an alert via
`alertcondition` or `alert`, not merely plot or emit a boolean. Registry imports
such as `import geometry` are allowed; relative file imports are unavailable for
inline source. Re-read the saved rule and verify its source, config and settings.

A rule can instead follow an Indicator on a chart. Its config is then
`{"indicatorId": "<indicator id>", "parameters": {}, "requests": {}}`, with no
inputs or map: the rule runs on the market of the chart cell that shows the
Indicator, and reads the Indicator's numeric and plot outputs as
`indicator.<name>` columns, such as `input.series("indicator.rsi")`. OpenChart
builds its inputs and map when the rule runs. `parameters` and `requests`
belong to the rule's own script; the Indicator keeps its own parameters.

`tea_check` and `tea_run` can't take this config. Run `tea_check` without
config to compile the source and see the columns it reads, then save it with
`save_alert_rule`, which validates the rule against the Indicator on its chart.

Creating an Alert Rule is distinct from recording an Alert Event. A synthetic
Tea run creates neither Alert Events nor notifications. Triggers separately
configure notification or Agent actions. Do not claim an action fired merely
because a rule was saved or a sample produced an event.

## Add a desktop notification

`save_alert_rule` saves only the Rule. To send a desktop notification when it
fires, create an enabled `trigger` whose `event.ruleId` is the saved Rule's ID.
First read the Trigger schema with `resource_read` and `include_schema: true`,
then call `resource_mutate` with:

```json
{
  "resource": "trigger",
  "op": "create",
  "input": {
    "name": "Alert notification",
    "enabled": true,
    "event": { "kind": "alert", "ruleId": "<saved-rule-id>" },
    "target": {
      "kind": "notification",
      "message": "{title}: {message}"
    }
  }
}
```

Replace `<saved-rule-id>` with the ID returned by `save_alert_rule`. Re-read the
Trigger and Rule to verify the binding and their enabled states. A paused Rule
does not produce events, even when its notification Trigger is enabled.

OpenChart renders `target.message` when an event is dispatched. Use single-brace
`{token}` placeholders; keep them in the saved text so each event supplies its
own values. The same syntax applies to text parts of a Trigger's Agent prompt.

| Token         | Value                          |
| ------------- | ------------------------------ |
| `{title}`     | Event title                    |
| `{message}`   | Event message                  |
| `{rule}`      | Current Rule name              |
| `{condition}` | Alert output name              |
| `{time}`      | Event time as an ISO timestamp |

String, number and boolean fields in the event's `data` are also tokens. For
example, `alert(..., Payload.new(...))` can supply `data.symbol` for `{symbol}`;
the Trigger renderer reads event data, not the Rule's market binding. For
duplicate names, fixed tokens above win, followed by `data` fields, `data.parameters` fields, then
`data.values` fields. Nested objects, arrays and null are not token values.

Unknown tokens stay literal. Use `\{message\}` for literal `{message}` (written
as `"\\{message\\}"` in JSON); a backslash also escapes another backslash.
Replacement values are inserted once, without expanding placeholders inside them.

## File-backed indicators

A chart indicator references a Workspace `.tea` file. The file starts with an
`indicator("Name", overlay = true)` header that gives its title and pane. Check
source and bindings before attaching it, and discover chart write shapes from
the Chart Resource schema. Existing starter indicators live at
`indicators/builtin/`; copy a starter to a new path when editing. Inline Alert
source is a separate snapshot and will not follow later edits to a Workspace file.
