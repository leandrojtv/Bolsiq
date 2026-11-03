"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@bolsiq/ui";
import { authCliente } from "@/lib/auth-cliente";
import { Campo, Mensagem, TelaDeConta, mensagemDeErro } from "./campos";

export function Recuperar() {
  const [email, setEmail] = useState("");
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function pedir(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const { error } = await authCliente.requestPasswordReset({
      email,
      redirectTo: "/redefinir-senha",
    });
    // Mesma resposta exista a conta ou nao: a tela nao revela quem tem conta.
    if (error?.status === 429) return setErro(mensagemDeErro(error));
    setEnviado(true);
  }

  return (
    <TelaDeConta
      titulo="Recuperar senha"
      subtitulo="Enviamos um link para escolher uma senha nova."
    >
      {enviado ? (
        <Mensagem>Se existir uma conta com {email}, o link chega em instantes.</Mensagem>
      ) : (
        <form onSubmit={(e) => void pedir(e)} className="flex flex-col gap-4">
          <Campo
            rotulo="E-mail"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {erro && <Mensagem erro>{erro}</Mensagem>}
          <Button type="submit" variant="primary">
            Enviar link
          </Button>
        </form>
      )}
    </TelaDeConta>
  );
}

export function Redefinir({
  token,
  erroDoLink,
}: {
  token?: string;
  erroDoLink?: string;
}) {
  const router = useRouter();
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(
    erroDoLink ? "Link inválido ou expirado. Peça outro." : null,
  );

  async function redefinir(e: FormEvent) {
    e.preventDefault();
    if (!token) return setErro("Link inválido ou expirado. Peça outro.");
    const { error } = await authCliente.resetPassword({ newPassword: senha, token });
    if (error) return setErro(mensagemDeErro(error));
    router.push("/entrar?aviso=senha");
  }

  return (
    <TelaDeConta titulo="Nova senha">
      <form onSubmit={(e) => void redefinir(e)} className="flex flex-col gap-4">
        <Campo
          rotulo="Nova senha (mínimo 10 caracteres)"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
        />
        {erro && <Mensagem erro>{erro}</Mensagem>}
        <Button type="submit" variant="primary">
          Salvar senha
        </Button>
      </form>
    </TelaDeConta>
  );
}
