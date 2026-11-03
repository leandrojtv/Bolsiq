"use client";

import type { InputHTMLAttributes, ReactNode } from "react";
import { Card, cn } from "@bolsiq/ui";

export const CAMPO =
  "h-touch w-full rounded-control border border-border-strong bg-sidebar px-3 text-sm text-text placeholder:text-text-3";

export function Campo({
  rotulo,
  ...props
}: { rotulo: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5 text-xs text-text-3">
      {rotulo}
      <input {...props} className={cn(CAMPO, props.className)} />
    </label>
  );
}

export function Mensagem({ erro, children }: { erro?: boolean; children: ReactNode }) {
  return (
    <p
      role={erro ? "alert" : "status"}
      className={cn("m-0 text-sm", erro ? "text-down" : "text-up")}
    >
      {children}
    </p>
  );
}

/** Moldura das telas de entrar, cadastro e recuperacao. */
export function TelaDeConta({
  titulo,
  subtitulo,
  children,
}: {
  titulo: string;
  subtitulo?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 pt-4 md:pt-12">
      <header className="flex flex-col gap-1">
        <h1 className="m-0 text-2xl font-bold">{titulo}</h1>
        {subtitulo && <p className="m-0 text-text-2">{subtitulo}</p>}
      </header>
      <Card>{children}</Card>
    </div>
  );
}

/** Mensagem do Better Auth em portugues, pelo codigo do erro. */
export function mensagemDeErro(e: {
  code?: string | undefined;
  status?: number;
  message?: string | undefined;
}): string {
  if (e.status === 429) return "Muitas tentativas. Espere um minuto e tente de novo.";
  const porCodigo: Record<string, string> = {
    INVALID_EMAIL_OR_PASSWORD: "E-mail ou senha incorretos.",
    EMAIL_NOT_VERIFIED: "Confirme o e-mail antes de entrar. Reenviamos o link.",
    USER_ALREADY_EXISTS: "Já existe uma conta com este e-mail.",
    USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "Já existe uma conta com este e-mail.",
    PASSWORD_TOO_SHORT: "A senha precisa de pelo menos 10 caracteres.",
    INVALID_TOKEN: "Link inválido ou expirado. Peça outro.",
    INVALID_CODE: "Código inválido.",
    INVALID_PASSWORD: "Senha incorreta.",
  };
  return (e.code && porCodigo[e.code]) || e.message || "Não deu certo. Tente de novo.";
}
