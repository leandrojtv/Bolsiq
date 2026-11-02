import type { ReactNode } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../lib/cn.js";

export interface SelectOption {
  value: string;
  label: ReactNode;
}

export interface SelectProps {
  options: SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  /** Rotulo acessivel do gatilho. */
  label: string;
  placeholder?: string;
  className?: string;
}

export function Select({
  options,
  value,
  onValueChange,
  label,
  placeholder,
  className,
}: SelectProps) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger
        aria-label={label}
        className={cn(
          "inline-flex h-touch min-w-40 items-center justify-between gap-2 rounded-control border border-border-strong bg-surface px-3 text-text",
          className,
        )}
      >
        <SelectPrimitive.Value {...(placeholder === undefined ? {} : { placeholder })} />
        <SelectPrimitive.Icon>
          <ChevronDown aria-hidden="true" size={16} className="text-text-3" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-50 min-w-(--radix-select-trigger-width) overflow-hidden rounded-control border border-border-strong bg-surface p-1 text-text"
        >
          <SelectPrimitive.Viewport>
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                className="relative flex min-h-touch cursor-pointer items-center rounded-item pr-8 pl-3 outline-none select-none data-highlighted:bg-surface-2"
              >
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2">
                  <Check aria-hidden="true" size={14} className="text-accent" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
