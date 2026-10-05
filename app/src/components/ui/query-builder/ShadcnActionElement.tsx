/* eslint @typescript-eslint/no-unused-vars: ["error", {"argsIgnorePattern": "^_"}] -- Query-only props are removed before forwarding DOM props. */
import * as React from "react";
import type { ActionProps } from "react-querybuilder";
import { Button } from "@openchart/app/components/ui/button";

/**
 * @group Props
 */
export type ShadcnActionProps = ActionProps;

/**
 * @group Components
 */
export const ShadcnActionElement = ({
  className,
  handleOnClick,
  label,
  title,
  disabled,
  disabledTranslation,
  testID,
  rules: _rules,
  ruleOrGroup: _rg,
  path: _path,
  level: _level,
  context: _context,
  validation: _validation,
  schema: _schema,
  ...otherProps
}: ShadcnActionProps): React.JSX.Element => (
  <Button
    {...otherProps}
    data-testid={testID}
    type="button"
    variant="ghost"
    size="sm"
    aria-label={title}
    className={className}
    title={disabledTranslation && disabled ? disabledTranslation.title : title}
    disabled={disabled && !disabledTranslation}
    onClick={(e: React.MouseEvent) => handleOnClick(e)}
  >
    {disabledTranslation && disabled ? disabledTranslation.label : label}
  </Button>
);
