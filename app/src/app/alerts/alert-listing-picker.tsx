// Purpose: Let the Alerts add form choose the series a rule watches through the chart feature's symbol search.
import type { BarsSeries } from "@openchart/feed";
import { useState } from "react";

import { Button } from "@openchart/app/components/ui/button";
import { chooseBarsOptions } from "@openchart/app/features/chart/api/queries";
import { SymbolPicker } from "@openchart/app/features/chart/components/symbol-picker";

type AlertListingPickerProps = {
  value: BarsSeries | null;
  onChange: (value: BarsSeries | null) => void;
};

/**
 * A button showing the chosen symbol that opens the chart feature's symbol
 * dialog. The picked listing becomes a complete bars series: resolution,
 * session and adjustment retain the existing choices when supported, otherwise
 * use the new listing's chart defaults. Session and adjustment carry over only
 * within one provider. A listing without data stays open with its error.
 *
 * @example
 * <AlertListingPicker value={series} onChange={setSeries} />
 */
export function AlertListingPicker({
  value,
  onChange,
}: AlertListingPickerProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="w-full justify-start font-normal"
        onClick={() => setOpen(true)}
      >
        <span className="truncate">
          {value?.listing.symbol ?? "Select symbol"}
        </span>
      </Button>
      {open ? (
        <SymbolPicker
          onClose={() => setOpen(false)}
          onSelect={(selected, capabilities) => {
            onChange({
              ...selected,
              ...chooseBarsOptions(
                capabilities,
                value && value.provider !== selected.provider
                  ? { resolution: value.resolution }
                  : (value ?? undefined),
              ),
            });
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The `renderListingPicker` slot of the rule editor, shared by the Alerts page and chart alerts.
 *
 * @example
 * <AlertRuleDialog renderListingPicker={renderAlertListingPicker} {...rest} />
 */
export const renderAlertListingPicker = (props: AlertListingPickerProps) => (
  <AlertListingPicker {...props} />
);
