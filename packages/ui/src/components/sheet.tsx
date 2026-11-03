"use client";

import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../lib/cn.js";

export interface SheetProps {
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Abaixo de 768 px ocupa a tela inteira, em vez de subir ate 90% da altura. */
  fullscreenOnMobile?: boolean;
  children: ReactNode;
}

/**
 * Painel sobreposto: lateral direita no desktop, de baixo no celular. Radix
 * Dialog por baixo: foco preso, Esc fecha, foco volta para quem abriu.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  fullscreenOnMobile = false,
  children,
}: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-bg/70" />
        <Dialog.Content
          className={cn(
            "fixed z-50 flex flex-col gap-4 overflow-y-auto border-border bg-surface p-5 text-text",
            fullscreenOnMobile
              ? "inset-0"
              : "inset-x-0 bottom-0 max-h-[90vh] rounded-t-card border-t",
            "md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-[440px] md:rounded-none md:border-t-0 md:border-l",
          )}
          {...(description === undefined ? { "aria-describedby": undefined } : {})}
        >
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="m-0 text-lg font-semibold">{title}</Dialog.Title>
            <Dialog.Close
              aria-label="Fechar"
              className="inline-flex size-touch shrink-0 items-center justify-center rounded-control text-text-3 hover:text-text"
            >
              <X aria-hidden="true" size={18} />
            </Dialog.Close>
          </div>
          {description !== undefined && (
            <Dialog.Description className="m-0 text-sm text-text-3">
              {description}
            </Dialog.Description>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
