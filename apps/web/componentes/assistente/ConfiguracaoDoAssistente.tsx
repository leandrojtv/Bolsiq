"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import {
  NOMES_DE_PROVEDOR,
  PROVEDORES,
  type ModeloClassificado,
  type Provedor,
} from "@bolsiq/assistant/puro";
import { Button, Card, Skeleton, StatTile } from "@bolsiq/ui";
import { textoDoPreco, type EstadoDoAssistente } from "@/lib/assistente-modelo";
import { CAMPO, Campo, Mensagem } from "../conta/campos";
import {
  CHAVES_DO_ASSISTENTE as CHAVES,
  configurarRelatorio,
  consentir,
  lerEstado,
  removerConfiguracao,
  salvarConfiguracao,
  testarConexao,
} from "./cliente";

const SELO: Record<ModeloClassificado["status"], string> = {
  homologado: "homologado",
  experimental: "experimental",
  bloqueado: "sem ferramentas",
};

/** /configuracoes/assistente: provedor, chave, modelo e consumo do mes. */
export function ConfiguracaoDoAssistente() {
  const cliente = useQueryClient();
  const { data: estado } = useQuery({ queryKey: CHAVES.estado, queryFn: lerEstado });
  const [provedor, setProvedor] = useState<Provedor>("deepseek");
  const [chave, setChave] = useState("");
  const [url, setUrl] = useState("");
  const [modelos, setModelos] = useState<ModeloClassificado[] | null>(null);
  const [modelo, setModelo] = useState("");
  const [aviso, setAviso] = useState<{ erro: boolean; texto: string } | null>(null);
  const [carregado, setCarregado] = useState(false);

  useEffect(() => {
    if (!estado || carregado) return;
    setCarregado(true);
    if (estado.provedor) setProvedor(estado.provedor as Provedor);
    setUrl(estado.base_url ?? estado.url_ollama_padrao);
    setModelo(estado.modelo ?? "");
  }, [estado, carregado]);

  const info = PROVEDORES[provedor];
  const mesmoProvedor = estado?.provedor === provedor;
  const corpoBase = {
    provedor,
    ...(chave ? { chave } : {}),
    ...(info.url && url ? { base_url: url } : {}),
  };

  const testar = useMutation({
    mutationFn: () => testarConexao(corpoBase),
    onSuccess: (r) => {
      setAviso({ erro: !r.ok, texto: r.mensagem });
      setModelos(r.ok ? r.modelos : null);
      if (r.ok && !r.modelos.some((m) => m.id === modelo)) {
        setModelo(r.modelos.find((m) => m.status !== "bloqueado")?.id ?? "");
      }
    },
    onError: (e: Error) => setAviso({ erro: true, texto: e.message }),
  });

  const salvar = useMutation({
    mutationFn: () => salvarConfiguracao({ ...corpoBase, modelo }),
    onSuccess: (e) => {
      cliente.setQueryData(CHAVES.estado, e);
      setChave("");
      setAviso({ erro: false, texto: "Configuração salva." });
    },
    onError: (e: Error) => setAviso({ erro: true, texto: e.message }),
  });

  const remover = useMutation({
    mutationFn: removerConfiguracao,
    onSuccess: (e) => {
      cliente.setQueryData(CHAVES.estado, e);
      setChave("");
      setModelos(null);
      setModelo("");
      setAviso({ erro: false, texto: "Chave removida." });
    },
  });

  if (!estado) return <Skeleton className="h-80" />;

  const escolhido = modelos?.find((m) => m.id === modelo);
  const bloqueado = escolhido?.status === "bloqueado";
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    setAviso(null);
    salvar.mutate();
  };
  const c = estado.consumo_mes;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="m-0 text-2xl font-bold">Assistente</h1>
        <p className="m-0 text-text-2">
          O &ldquo;Pergunte ao Bolsiq&rdquo; usa a sua chave de um provedor de IA. Ela
          fica cifrada no servidor e não volta ao navegador.
        </p>
      </header>

      <form onSubmit={enviar} className="flex flex-col gap-5" noValidate>
        <Card title="Provedor">
          <div className="flex flex-col gap-1.5 text-xs text-text-3">
            <label htmlFor="assistente-provedor">Provedor</label>
            <select
              id="assistente-provedor"
              value={provedor}
              onChange={(e) => {
                setProvedor(e.target.value as Provedor);
                setChave("");
                setModelos(null);
                setModelo("");
                setAviso(null);
              }}
              className={CAMPO}
            >
              {NOMES_DE_PROVEDOR.map((p) => (
                <option key={p} value={p}>
                  {PROVEDORES[p].rotulo}
                </option>
              ))}
            </select>
          </div>
          {info.url && (
            <Campo
              rotulo="URL do Ollama"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          )}
          {info.exigeChave && (
            <Campo
              rotulo="Chave de API"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={chave}
              onChange={(e) => setChave(e.target.value)}
              placeholder={
                mesmoProvedor && estado.chave_final
                  ? `Salva, termina em ${estado.chave_final}`
                  : "Cole a chave aqui"
              }
            />
          )}
          {mesmoProvedor && estado.chave_final && (
            <p className="m-0 text-[13px] text-text-2">
              Chave salva: <span className="font-mono">••••{estado.chave_final}</span>
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button disabled={testar.isPending} onClick={() => testar.mutate()}>
              Testar conexão
            </Button>
            {estado.configurado && (
              <Button variant="ghost" onClick={() => remover.mutate()}>
                Remover chave
              </Button>
            )}
          </div>
        </Card>

        <Card title="Modelo">
          {modelos ? (
            <div className="flex flex-col gap-1.5 text-xs text-text-3">
              <label htmlFor="assistente-modelo">Modelo</label>
              <select
                id="assistente-modelo"
                value={modelo}
                onChange={(e) => setModelo(e.target.value)}
                className={CAMPO}
              >
                {modelos.map((m) => (
                  <option key={m.id} value={m.id} disabled={m.status === "bloqueado"}>
                    {m.nome} ({SELO[m.status]}, {textoDoPreco(m)})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="m-0 text-sm text-text-2">
              {estado.modelo ? (
                <>
                  Em uso: <span className="font-mono">{estado.modelo}</span>. Teste a
                  conexão para ver os outros.
                </>
              ) : (
                "Teste a conexão para carregar os modelos do provedor."
              )}
            </p>
          )}
          {(escolhido?.aviso ?? (!modelos ? estado.aviso_modelo : null)) && (
            <p
              role="note"
              className="m-0 rounded-item bg-warn-bg px-3 py-2 text-[13px] text-warn"
            >
              {escolhido?.aviso ?? estado.aviso_modelo}
            </p>
          )}
          <Button
            variant="primary"
            type="submit"
            disabled={salvar.isPending || !modelo || bloqueado}
          >
            Salvar
          </Button>
          {aviso && <Mensagem erro={aviso.erro}>{aviso.texto}</Mensagem>}
        </Card>
      </form>

      <section aria-label="Consumo do mês" className="flex flex-col gap-3">
        <h2 className="m-0 text-lg font-semibold">Consumo do mês</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile
            label="Tokens de entrada"
            value={c.tokens_entrada.toLocaleString("pt-BR")}
          />
          <StatTile
            label="Tokens de saída"
            value={c.tokens_saida.toLocaleString("pt-BR")}
          />
          <StatTile
            label="Custo estimado"
            value={
              c.custo_estimado === null
                ? "Sem preço"
                : `US$ ${Number(c.custo_estimado).toFixed(4)}`
            }
          />
        </div>
        <p className="m-0 text-[13px] text-text-3">
          {estado.usadas_hoje} de {estado.limite_diario} mensagens hoje. O custo é
          estimado a partir do preço do modelo; a cobrança real é do provedor.
        </p>
      </section>

      <RelatorioMensal estado={estado} />
    </div>
  );
}

/**
 * Relatorio mensal no sino (ADR 0036). Opt-in: gasta tokens da chave do
 * usuario, por isso a tela mostra a estimativa antes de ligar.
 */
function RelatorioMensal({ estado }: { estado: EstadoDoAssistente }) {
  const cliente = useQueryClient();
  const r = estado.relatorio_mensal;
  const [erro, setErro] = useState<string | null>(null);
  const mudar = useMutation({
    mutationFn: async (ligado: boolean) => {
      if (ligado && !estado.consentiu_financas) await consentir("financas");
      return configurarRelatorio(ligado);
    },
    onSuccess: (e) => {
      setErro(null);
      cliente.setQueryData(CHAVES.estado, e);
    },
    onError: (e: Error) => setErro(e.message),
  });
  const custo =
    r.custo_estimado === null
      ? "o custo depende do preço do modelo, que o provedor não informa"
      : `cerca de US$ ${Number(r.custo_estimado).toFixed(4)} por mês na sua chave`;
  return (
    <section aria-label="Relatório mensal" className="flex flex-col gap-3">
      <h2 className="m-0 text-lg font-semibold">Relatório mensal</h2>
      <p className="m-0 max-w-[70ch] text-sm text-text-2">
        No dia 1 de cada mês, o assistente resume o mês anterior do Bolsiq Finanças com 3
        cortes sugeridos e a economia estimada, e avisa no sino. Gasta tokens: {custo}.
        {!estado.consentiu_financas &&
          " Ao ligar, você concorda em enviar ao provedor os dados do Bolsiq Finanças (lançamentos, resumo do mês, parcelas, assinaturas e insights), com nomes de pessoas em PIX e transferências trocados por [pessoa]."}
      </p>
      {r.disponivel ? (
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            role="switch"
            checked={r.ligado}
            disabled={mudar.isPending}
            onChange={(e) => mudar.mutate(e.target.checked)}
          />
          Gerar o relatório mensal
        </label>
      ) : (
        <p className="m-0 text-sm text-text-3">
          O relatório usa a sua chave: configure um provedor e um modelo acima para ligar.
        </p>
      )}
      {erro && <Mensagem erro>{erro}</Mensagem>}
    </section>
  );
}
