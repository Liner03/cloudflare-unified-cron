import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectMenuOption {
  label: string;
  value: string;
}

export function SelectMenu({
  ariaLabel,
  className,
  disabled = false,
  onValueChange,
  options,
  value,
}: {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  onValueChange: (value: string) => void;
  options: SelectMenuOption[];
  value: string;
}) {
  return (
    <SelectPrimitive.Root
      disabled={disabled}
      onValueChange={onValueChange}
      value={value}
    >
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn("select-menu-trigger", className)}
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon asChild>
          <ChevronDown aria-hidden="true" size={15} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          align="start"
          className="select-menu-content"
          collisionPadding={12}
          position="popper"
          sideOffset={6}
        >
          <SelectPrimitive.Viewport className="select-menu-viewport">
            {options.map((option) => (
              <SelectPrimitive.Item
                className="select-menu-item"
                key={option.value}
                value={option.value}
              >
                <SelectPrimitive.ItemText>
                  {option.label}
                </SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="select-menu-indicator">
                  <Check aria-hidden="true" size={14} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
