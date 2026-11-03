"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@bolsiq/ui";
import { authCliente } from "@/lib/auth-cliente";
import { Campo, Mensagem, TelaDeConta, mensagemDeErro } from "./campos";

/** So caminho interno: `volta` vem da URL e nao pode mandar para outro site. */
function destino(volta: string | undefined): string {
  return volta && volta.startsWith("/") && !volta.startsWith("//") ? volta : "/carteiras";
}

export function Entrar({
  volta,
  aviso,
  google,
}: {
  volta?: string;
  aviso?: string;
  google: boolean;
}) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [codigo, setCodigo] = useState("");
  const [pedeCodigo, setPedeCodigo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Navegacao completa, nao router.push: o prefetch feito antes do login
  // guardou o redirect das rotas protegidas para /entrar.
  function concluir() {
    window.location.assign(destino(volta));
  }

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    const { data, error } = await authCliente.signIn.email({
      email,
      password: senha,
      callbackURL: destino(volta),
    });
    setEnviando(false);
    if (error) return setErro(mensagemDeErro(error));
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect)
      return setPedeCodigo(true);
    concluir();
  }

  async function verificar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    const { error } = await authCliente.twoFactor.verifyTotp({ code: codigo.trim() });
    setEnviando(false);
    if (error) return setErro(mensagemDeErro(error));
    concluir();
  }

  if (pedeCodigo)
    return (
      <TelaDeConta
        titulo="Verificação em duas etapas"
        subtitulo="Digite o código do seu app autenticador."
      >
        <form onSubmit={(e) => void verificar(e)} className="flex flex-col gap-4">
          <Campo
            rotulo="Código"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            autoFocus
          />
          {erro && <Mensagem erro>{erro}</Mensagem>}
          <Button type="submit" variant="primary" disabled={enviando}>
            Verificar
          </Button>
        </form>
      </TelaDeConta>
    );

  return (
    <TelaDeConta titulo="Entrar" subtitulo="Acesse suas carteiras e alertas.">
      <form onSubmit={(e) => void entrar(e)} className="flex flex-col gap-4">
        {aviso && <Mensagem>{aviso}</Mensagem>}
        <Campo
          rotulo="E-mail"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Campo
          rotulo="Senha"
          type="password"
          autoComplete="current-password"
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
        />
        {erro && <Mensagem erro>{erro}</Mensagem>}
        <Button type="submit" variant="primary" disabled={enviando}>
          Entrar
        </Button>
        {google && (
          <Button
            onClick={() =>
              void authCliente.signIn.social({
                provider: "google",
                callbackURL: destino(volta),
              })
            }
          >
            Entrar com Google
          </Button>
        )}
        <div className="flex flex-wrap justify-between gap-2 text-sm">
          <Link href="/recuperar">Esqueci a senha</Link>
          <Link
            href={volta ? `/cadastro?volta=${encodeURIComponent(volta)}` : "/cadastro"}
          >
            Criar conta
          </Link>
        </div>
      </form>
    </TelaDeConta>
  );
}
