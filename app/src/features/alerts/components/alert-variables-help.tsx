// Purpose: Explain the Trigger template syntax without changing an action's draft.
import { Fragment, useId } from "react";
import { BracesIcon } from "lucide-react";
import { Button } from "@openchart/app/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@openchart/app/components/ui/popover";

// Reference copy for server/trigger/serialize.ts; this is not a token parser or
// an exhaustive catalog. Custom Tea can supply more fields at execution time.
const groups = [
  {
    title: "Always available",
    fields: [
      ["rule", "Alert rule name"],
      ["title", "Title from the triggered condition"],
      ["message", "Message from the triggered condition"],
      ["condition", "Condition identifier, e.g. alert"],
      ["time", "Event time in UTC (ISO 8601)"],
    ],
  },
  {
    title: "When supplied by the alert",
    fields: [
      ["symbol", "Market symbol, e.g. BTCUSDT"],
      ["provider", "Market data provider, e.g. binance"],
      ["resolution", "Bar interval, e.g. 5m"],
      ["value", "Value emitted by the condition, such as price, volume or RSI"],
      ["threshold", "Configured threshold, when the rule defines one"],
    ],
  },
] as const;

/** On-demand reference shared by notification and Agent actions. @example <AlertVariablesHelp /> */
export function AlertVariablesHelp() {
  const titleId = useId();
  return (
    <div className="mt-1 flex justify-end">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
          >
            <BracesIcon aria-hidden="true" />
            Variables
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="top"
          aria-labelledby={titleId}
          className="max-h-[var(--radix-popover-content-available-height)] w-96 max-w-[calc(100vw-2rem)] space-y-4 overflow-y-auto text-xs"
        >
          <div className="space-y-1">
            <h4 id={titleId} className="text-sm font-medium">
              Alert variables
            </h4>
            <p className="text-muted-foreground">
              Use these in notification messages or Agent instructions. Values
              are filled in when the alert fires.
            </p>
          </div>
          {groups.map((group) => (
            <section
              key={group.title}
              className="space-y-2"
              aria-label={group.title}
            >
              <h5 className="font-medium">{group.title}</h5>
              <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2">
                {group.fields.map(([name, description]) => (
                  <Fragment key={name}>
                    <dt>
                      <code>{`{${name}}`}</code>
                    </dt>
                    <dd className="text-muted-foreground">{description}</dd>
                  </Fragment>
                ))}
              </dl>
            </section>
          ))}
          <p className="text-muted-foreground">
            Custom alerts can also supply named text, numbers or booleans in
            their event data, parameters or emitted outputs. Use the field name,
            such as <code>{"{rsi}"}</code>. Multi-symbol alerts must supply the
            symbol for the market that triggered.
          </p>
          <div className="space-y-1">
            <p className="font-medium">Example: a price alert</p>
            <p>
              <code>{"{symbol} {title}: {value}"}</code>
            </p>
            <p className="text-muted-foreground">
              Becomes: BTCUSDT Price: 84524.01
            </p>
          </div>
          <p className="text-muted-foreground">
            Names are case-sensitive. Unavailable variables stay as written. To
            keep literal braces, write <code>{"\\{symbol\\}"}</code>. Only
            message text is replaced; attachments are unchanged.
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
}
