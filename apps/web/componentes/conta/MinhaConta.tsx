"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button, Card } from "@bolsiq/ui";
import { api } from "@/lib/api";
import { authCliente } from "@/lib/auth-cliente";
import type { Usuario } from "@/lib/auth";
import { Campo, Mensagem } from "./campos";

/** /configuracoes/conta: dados da conta, sair, exportar e excluir (LGPD). */
export function MinhaConta({ usuario }: { usuario: Usuario }) {
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  async function sair() {
    await authCliente.signOut();
    // Navegacao completa: o cache do router guarda paginas da sessao que acabou.
    window.location.assign("/entrar");
  }

  async function excluir(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    try {
      await api("conta/excluir", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmacao }),
      });
      window.location.assign("/entrar?aviso=excluida");
    } catch (falha) {
      setErro((falha as Error).message);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-2xl font-bold">Minha conta</h1>
          <p className="m-0 text-text-2">
            {usuario.nome} · {usuario.email}
          </p>
        </div>
        <Button onClick={() => void sair()}>Sair</Button>
      </header>
      <Card title="Segurança e notificações">
        <div className="flex flex-wrap gap-4 text-sm">
          <Link href="/configuracoes/seguranca">Verificação em duas etapas</Link>
          <Link href="/configuracoes/notificacoes">Preferências de notificação</Link>
        </div>
      </Card>
      <Card title="Seus dados">
        <p className="m-0 text-sm text-text-2">
          Baixe tudo o que o Bolsiq guarda sobre você: conta, carteiras, transações,
          importações, alertas, notificações e watchlist, em JSON.
        </p>
        <Button asChild>
          <a href="/api/conta/exportar" download>
            Exportar meus dados
          </a>
        </Button>
      </Card>
      <Card title="Excluir conta">
        <form onSubmit={(e) => void excluir(e)} className="flex flex-col gap-3">
          <p className="m-0 text-sm text-text-2">
            Apaga a conta e todos os dados, sem volta: carteiras, transações, alertas,
            notificações, watchlist e o registro de auditoria.
          </p>
          <Campo
            rotulo='Digite "EXCLUIR" para confirmar'
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
            autoComplete="off"
          />
          {erro && <Mensagem erro>{erro}</Mensagem>}
          <Button
            type="submit"
            disabled={confirmacao !== "EXCLUIR"}
            className="border-down text-down"
          >
            Excluir conta e dados
          </Button>
        </form>
      </Card>
    </div>
  );
}
