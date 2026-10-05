/* eslint @typescript-eslint/no-unused-vars: ["error", {"argsIgnorePattern": "^_"}] -- Query-only props are removed before forwarding DOM props. */
import * as React from "react";
import { useMemo } from "react";
import type { OptionList, VersatileSelectorProps } from "react-querybuilder";
import { isOptionGroupArray, useValueSelector } from "react-querybuilder";
import {
  Group as SelectGroup,
  Label as SelectLabel,
} from "@radix-ui/react-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openchart/app/components/ui/select";

/**
 * @group Props
 */
export type ShadcnValueSelectorProps = VersatileSelectorProps;

/**
 * @group Components
 */
export const ShadcnValueSelector = ({
  className,
  handleOnChange,
  options,
  value,
  title,
  disabled,
  multiple: _multiple,
  listsAsArrays: _listsAsArrays,
  testID,
  field: _field,
  fieldData: _fieldData,
  rule: _rule,
  ruleGroup: _ruleGroup,
  rules: _rules,
  path: _path,
  level: _level,
  context: _context,
  validation: _validation,
  schema: _schema,
  ...otherProps
}: ShadcnValueSelectorProps): React.JSX.Element => {
  const { onChange, val } = useValueSelector({ handleOnChange, value });

  const optionContent = useMemo(() => {
    const opts = options as OptionList;
    if (isOptionGroupArray(opts)) {
      return opts.map((og) => (
        <SelectGroup key={og.label}>
          <SelectLabel>{og.label}</SelectLabel>
          {og.options.map((opt) => (
            <SelectItem key={opt.name} value={opt.name}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectGroup>
      ));
    }
    return opts.map((opt) => (
      <SelectItem key={opt.name} value={opt.name}>
        {opt.label}
      </SelectItem>
    ));
  }, [options]);

  return (
    <Select
      {...otherProps}
      value={val as string}
      onValueChange={onChange}
      disabled={disabled}
    >
      <SelectTrigger data-testid={testID} className={className} title={title}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>{optionContent}</SelectContent>
    </Select>
  );
};
