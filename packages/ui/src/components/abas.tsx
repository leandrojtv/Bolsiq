"use client";

import type { ReactNode } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "../lib/cn.js";

export interface TabItem {
  value: string;
  label: ReactNode;
  content: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  label: string;
  className?: string;
}

/** Abas com teclado e roles do Radix (tablist, tab, tabpanel). */
export function Tabs({
  items,
  value,
  defaultValue,
  onValueChange,
  label,
  className,
}: TabsProps) {
  return (
    <TabsPrimitive.Root
      {...(value === undefined ? {} : { value })}
      defaultValue={defaultValue ?? items[0]?.value}
      {...(onValueChange ? { onValueChange } : {})}
      className={cn("flex flex-col", className)}
    >
      <TabsPrimitive.List
        aria-label={label}
        className="flex gap-1 overflow-x-auto border-b border-border"
      >
        {items.map((i) => (
          <TabsPrimitive.Trigger
            key={i.value}
            value={i.value}
            className={cn(
              "h-12 whitespace-nowrap border-b-2 border-transparent bg-transparent px-3.5 font-semibold text-text-3",
              "data-[state=active]:border-accent data-[state=active]:text-text hover:text-text",
            )}
          >
            {i.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {items.map((i) => (
        <TabsPrimitive.Content key={i.value} value={i.value} className="pt-4">
          {i.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}
