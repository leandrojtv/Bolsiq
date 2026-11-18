"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Card } from "@bolsiq/ui";
import { authCliente } from "@/lib/auth-cliente";
import { Campo, Mensagem, mensagemDeErro } from "./campos";

/** Chave do otpauth:// para quem digita no app autenticador em vez de ler QR. */
function chaveDoUri(uri: string): string {
  return new URL(uri).searchParams.get("secret") ?? "";
}

/** 2FA por TOTP, opcional (ADR 0010). */
export function Seguranca({ ativo }: { ativo: boolean }) {
  const router = useRouter();
  const [senha, setSenha] = useState("");
  const [codigo, setCodigo] = useState("");
  const [config, setConfig] = useState<{ uri: string; reserva: string[] } | null>(null);
  const [msg, setMsg] = useState<{ erro: boolean; texto: string } | null>(null);

  async function iniciar(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const { data, error } = await authCliente.twoFactor.enable({ password: senha });
    if (error) return setMsg({ erro: true, texto: mensagemDeErro(error) });
    if (data.method !== "totp") return;
    setConfig({ uri: data.totpURI, reserva: data.backupCodes });
    setSenha("");
  }

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    const { error } = await authCliente.twoFactor.verifyTotp({ code: codigo.trim() });
    if (error) return setMsg({ erro: true, texto: mensagemDeErro(error) });
    setConfig(null);
    setMsg({ erro: false, texto: "Verificação em duas etapas ativada." });
    router.refresh();
  }

  async function desativar(e: FormEvent) {
    e.preventDefault();
    const { error } = await authCliente.twoFactor.disable({ password: senha });
    if (error) return setMsg({ erro: true, texto: mensagemDeErro(error) });
    setSenha("");
    setMsg({ erro: false, texto: "Verificação em duas etapas desativada." });
    router.refresh();
  }

  return (
    <Card title="Verificação em duas etapas">
      <p className="m-0 text-sm text-text-2">
        {ativo
          ? "Ativa. Para entrar, além da senha, pedimos o código do app autenticador."
          : "Desativada. Com ela, entrar exige também um código do app autenticador (Google Authenticator, 1Password, Authy)."}
      </p>
      {config ? (
        <form onSubmit={(e) => void confirmar(e)} className="flex flex-col gap-3">
          <p className="m-0 text-sm">
            No app autenticador, adicione uma conta com a chave:
          </p>
          <code
            className="rounded-control bg-sidebar p-3 font-mono text-sm break-all"
            data-testid="chave-totp"
          >
            {chaveDoUri(config.uri)}
          </code>
          <details className="text-sm text-text-2">
            <summary className="cursor-pointer">
              Códigos de reserva (guarde em lugar seguro)
            </summary>
            <ul className="m-0 grid grid-cols-2 gap-1 p-0 pt-2 font-mono">
              {config.reserva.map((c) => (
                <li key={c} className="list-none">
                  {c}
                </li>
              ))}
            </ul>
          </details>
          <Campo
            rotulo="Código do app"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
          />
          <Button type="submit" variant="primary">
            Ativar
          </Button>
        </form>
      ) : (
        <form
          onSubmit={(e) => void (ativo ? desativar(e) : iniciar(e))}
          className="flex flex-col gap-3"
        >
          <Campo
            rotulo="Senha atual"
            type="password"
            autoComplete="current-password"
            required
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
          <Button type="submit" variant={ativo ? "secondary" : "primary"}>
            {ativo ? "Desativar" : "Configurar"}
          </Button>
        </form>
      )}
      {msg && <Mensagem erro={msg.erro}>{msg.texto}</Mensagem>}
    </Card>
  );
}
