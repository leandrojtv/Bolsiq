"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@bolsiq/ui";
import { authCliente } from "@/lib/auth-cliente";
import { Campo, Mensagem, TelaDeConta, mensagemDeErro } from "./campos";

export function Cadastro({ google }: { google: boolean }) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function cadastrar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    const { error } = await authCliente.signUp.email({
      name: nome.trim(),
      email,
      password: senha,
      // Depois do link do e-mail o Better Auth ja entra e manda para ca.
      callbackURL: "/carteiras",
    });
    setEnviando(false);
    if (error) return setErro(mensagemDeErro(error));
    setEnviado(true);
  }

  if (enviado)
    return (
      <TelaDeConta titulo="Confirme seu e-mail">
        <Mensagem>
          Enviamos um link para {email}. Abra o e-mail e confirme para entrar.
        </Mensagem>
      </TelaDeConta>
    );

  return (
    <TelaDeConta
      titulo="Criar conta"
      subtitulo="Carteiras, alertas e watchlist em qualquer aparelho."
    >
      <form onSubmit={(e) => void cadastrar(e)} className="flex flex-col gap-4">
        <Campo
          rotulo="Nome"
          autoComplete="name"
          required
          value={nome}
          onChange={(e) => setNome(e.target.value)}
        />
        <Campo
          rotulo="E-mail"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Campo
          rotulo="Senha (mínimo 10 caracteres)"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
        />
        {erro && <Mensagem erro>{erro}</Mensagem>}
        <Button type="submit" variant="primary" disabled={enviando}>
          Criar conta
        </Button>
        {google && (
          <Button
            onClick={() =>
              void authCliente.signIn.social({
                provider: "google",
                callbackURL: "/carteiras",
              })
            }
          >
            Continuar com Google
          </Button>
        )}
        <p className="m-0 text-sm text-text-2">
          Já tem conta? <Link href="/entrar">Entrar</Link>
        </p>
      </form>
    </TelaDeConta>
  );
}
