// Purpose: Menu pieces for Radix's controlled, virtual-anchor menu primitive.
import * as MenuPrimitive from "@radix-ui/react-menu";
import { CheckIcon, ChevronRightIcon, CircleIcon } from "lucide-react";
import { useState, type ComponentPropsWithoutRef, type ReactNode } from "react";

import {
  menuChoiceClassName,
  menuContentClassName,
  menuItemClassName,
  menuSubContentClassName,
  menuSubTriggerClassName,
} from "@openchart/app/components/ui/menu-styles";
import { cn } from "@openchart/app/utils/cn";

export const Menu = MenuPrimitive.Root;
export const MenuAnchor = MenuPrimitive.Anchor;
export const MenuRadioGroup = MenuPrimitive.RadioGroup;

export function MenuContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        className={cn(menuContentClassName, className)}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

export function MenuItem({
  className,
  variant = "default",
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.Item> & {
  variant?: "default" | "destructive";
}) {
  return (
    <MenuPrimitive.Item
      data-variant={variant}
      className={cn(menuItemClassName, className)}
      {...props}
    />
  );
}

export function MenuCheckboxItem({
  className,
  children,
  indicatorPosition = "start",
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.CheckboxItem> & {
  indicatorPosition?: "start" | "end";
}) {
  return (
    <MenuPrimitive.CheckboxItem
      className={cn(
        menuChoiceClassName,
        indicatorPosition === "end" && "pl-2 pr-8",
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "pointer-events-none absolute flex size-3.5 items-center justify-center",
          indicatorPosition === "end" ? "right-2" : "left-2",
        )}
      >
        <MenuPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

export function MenuRadioItem({
  className,
  children,
  indicatorPosition = "start",
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.RadioItem> & {
  indicatorPosition?: "start" | "end";
}) {
  return (
    <MenuPrimitive.RadioItem
      className={cn(
        menuChoiceClassName,
        indicatorPosition === "end" && "pl-2 pr-8",
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "pointer-events-none absolute flex size-3.5 items-center justify-center",
          indicatorPosition === "end" ? "right-2" : "left-2",
        )}
      >
        <MenuPrimitive.ItemIndicator>
          <CircleIcon className="size-2 fill-current" />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  );
}

export function MenuLabel({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.Label>) {
  return (
    <MenuPrimitive.Label
      className={cn("px-2 py-1.5 text-sm font-medium", className)}
      {...props}
    />
  );
}

export function MenuSeparator({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export function MenuSub({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <MenuPrimitive.Sub open={open} onOpenChange={setOpen}>
      {children}
    </MenuPrimitive.Sub>
  );
}

export function MenuSubTrigger({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.SubTrigger>) {
  return (
    <MenuPrimitive.SubTrigger
      className={cn(menuSubTriggerClassName, className)}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </MenuPrimitive.SubTrigger>
  );
}

export function MenuSubContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.SubContent>) {
  return (
    <MenuPrimitive.SubContent
      className={cn(menuSubContentClassName, className)}
      {...props}
    />
  );
}
