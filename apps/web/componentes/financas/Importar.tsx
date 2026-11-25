"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Split, Undo2, Upload } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type {
  AnaliseDeImportacao,
  Categoria,
  CsvParaMapear,
  ImportacaoComLinhas,
  LinhaDeImportacao,
  MapeamentoDigitado,
} from "@bolsiq/finance/puro";
import { Button, Card, EmptyState, Money, Skeleton, StatTile, cn } from "@bolsiq/ui";
import { api } from "@/lib/api";
import { CAMPO } from "../conta/campos";
import { dataBr } from "./Cartoes";
import {
  acaoDaImportacao,
  CHAVE,
  editarLinha,
  useCartoes,
  useCategorias,
  useContas,
  useImportacoes,
} from "./cliente";
import { ROTULO } from "./Contas";
import { SeletorDeDestino, useDestino } from "./Destino";
import { LeituraComIA } from "./LeituraComIA";

const STATUS = {
  revisao: "Em revisão",
  confirmada: "Confirmada",
  cancelada: "Cancelada",
  desfeita: "Desfeita",
} as const;

const MARCACAO: Record<NonNullable<LinhaDeImportacao["marcacao"]>, string> = {
  pagamento: "pagamento da fatura",
  estorno: "estorno",
  saldo_anterior: "saldo anterior: não entra",
  iof: "IOF",
};

const comSinal = (l: Pick<LinhaDeImportacao, "tipo" | "valor">) =>
  l.tipo === "despesa" ? `-${l.valor}` : l.valor;

/** Soma em centavos das linhas marcadas de um tipo, para conferir com a fatura. */
const somaMarcadas = (linhas: LinhaDeImportacao[], tipo: LinhaDeImportacao["tipo"]) =>
  (
    linhas
      .filter((l) => l.acao !== "ignorar" && l.tipo === tipo)
      .reduce((s, l) => s + Math.round(Number(l.valor) * 100), 0) / 100
  ).toFixed(2);

function Categorias({
  categorias,
  natureza,
}: {
  categorias: Categoria[];
  natureza: "receita" | "despesa";
}) {
  return (
    <>
      <option value="">Sem categoria</option>
      {categorias
        .filter((c) => c.natureza === natureza && !c.arquivada)
        .map((c) => (
          <option key={c.id} value={c.id}>
            {c.nome}
          </option>
        ))}
    </>
  );
}

const OPCAO_VAZIA = "";

/** As colunas de um CSV que nenhum leitor conhece; fica salvo para a proxima vez. */
function MapeamentoDoCsv({
  csv,
  onAplicar,
}: {
  csv: CsvParaMapear;
  onAplicar: (m: MapeamentoDigitado) => void;
}) {
  const acha = (re: RegExp) => csv.colunas.find((c) => re.test(c)) ?? OPCAO_VAZIA;
  const [m, setM] = useState({
    tipo: "conta" as "conta" | "cartao",
    data: acha(/data|dt/),
    descricao: acha(/descri|hist|lanc|estabelec|title/),
    valor: acha(/^valor|amount|montante/),
    credito: acha(/cr[eé]dito|entrada/),
    debito: acha(/d[eé]bito|sa[ií]da/),
    parcela: acha(/parc/),
    formato_data: "dd/mm/aaaa" as MapeamentoDigitado["formato_data"],
    decimal: "virgula" as MapeamentoDigitado["decimal"],
    inverter_sinal: false,
  });
  const [separado, setSeparado] = useState(!m.valor && Boolean(m.credito || m.debito));
  const coluna = (
    campo: "data" | "descricao" | "valor" | "credito" | "debito" | "parcela",
    rotulo: string,
  ) => (
    <label className={ROTULO}>
      {rotulo}
      <select
        className={CAMPO}
        value={m[campo]}
        onChange={(e) => setM({ ...m, [campo]: e.target.value })}
      >
        <option value={OPCAO_VAZIA}>Nenhuma</option>
        {csv.colunas.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <fieldset
      aria-label={`Colunas de ${csv.nome}`}
      className="m-0 flex flex-col gap-3 rounded-control border border-border p-3"
    >
      <legend className="px-1 text-sm font-semibold">{csv.nome}: diga as colunas</legend>
      <div className="overflow-x-auto">
        <table aria-label={`Amostra de ${csv.nome}`} className="text-xs">
          <thead>
            <tr>
              {csv.colunas.map((c) => (
                <th key={c} className="px-2 py-1 text-left font-medium text-text-3">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {csv.amostra.map((l, i) => (
              <tr key={i}>
                {l.map((v, j) => (
                  <td key={j} className="px-2 py-1 font-mono whitespace-nowrap">
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className={ROTULO}>
          É de
          <select
            className={CAMPO}
            value={m.tipo}
            onChange={(e) => setM({ ...m, tipo: e.target.value as "conta" | "cartao" })}
          >
            <option value="conta">Conta</option>
            <option value="cartao">Cartão de crédito</option>
          </select>
        </label>
        {coluna("data", "Coluna da data")}
        {coluna("descricao", "Coluna da descrição")}
        <label className="flex items-center gap-2 text-sm md:col-span-3">
          <input
            type="checkbox"
            checked={separado}
            onChange={(e) => setSeparado(e.target.checked)}
          />
          Crédito e débito em colunas separadas
        </label>
        {separado ? (
          <>
            {coluna("credito", "Coluna do crédito")}
            {coluna("debito", "Coluna do débito")}
          </>
        ) : (
          coluna("valor", "Coluna do valor")
        )}
        {coluna("parcela", "Coluna da parcela")}
        <label className={ROTULO}>
          Formato da data
          <select
            className={CAMPO}
            value={m.formato_data}
            onChange={(e) =>
              setM({
                ...m,
                formato_data: e.target.value as MapeamentoDigitado["formato_data"],
              })
            }
          >
            <option value="dd/mm/aaaa">dd/mm/aaaa</option>
            <option value="aaaa-mm-dd">aaaa-mm-dd</option>
            <option value="mm/dd/aaaa">mm/dd/aaaa</option>
          </select>
        </label>
        <label className={ROTULO}>
          Decimal
          <select
            className={CAMPO}
            value={m.decimal}
            onChange={(e) =>
              setM({ ...m, decimal: e.target.value as MapeamentoDigitado["decimal"] })
            }
          >
            <option value="virgula">vírgula (1.234,56)</option>
            <option value="ponto">ponto (1,234.56)</option>
          </select>
        </label>
        {!separado && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={m.inverter_sinal}
              onChange={(e) => setM({ ...m, inverter_sinal: e.target.checked })}
            />
            {m.tipo === "cartao" ? "Compras vêm negativas" : "Saídas vêm positivas"}
          </label>
        )}
      </div>
      <Button
        variant="secondary"
        disabled={
          !m.data || !m.descricao || (separado ? !m.credito && !m.debito : !m.valor)
        }
        onClick={() =>
          onAplicar({
            assinatura: csv.assinatura,
            tipo: m.tipo,
            data: m.data,
            descricao: m.descricao,
            valor: separado ? null : m.valor || null,
            credito: separado ? m.credito || null : null,
            debito: separado ? m.debito || null : null,
            parcela: m.parcela || null,
            formato_data: m.formato_data,
            decimal: m.decimal,
            inverter_sinal: !separado && m.inverter_sinal,
          })
        }
      >
        Ler com estas colunas
      </Button>
    </fieldset>
  );
}

/** Passo 1: arquivos, leitura sem gravar e destino sugerido. */
function Envio({ onRevisao }: { onRevisao: (i: ImportacaoComLinhas) => void }) {
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [analise, setAnalise] = useState<AnaliseDeImportacao | null>(null);
  const [mapeamentos, setMapeamentos] = useState<MapeamentoDigitado[]>([]);
  const destino = useDestino();
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const formulario = (
    lista: File[],
    ms: MapeamentoDigitado[],
    extra: Record<string, string> = {},
  ) => {
    const form = new FormData();
    for (const a of lista) form.append("arquivos", a);
    if (ms.length > 0) form.set("mapeamentos", JSON.stringify(ms));
    for (const [k, v] of Object.entries(extra)) if (v) form.set(k, v);
    return form;
  };

  async function ler(lista: File[], ms: MapeamentoDigitado[] = []) {
    setArquivos(lista);
    setMapeamentos(ms);
    setAnalise(null);
    setErro(null);
    if (lista.length === 0) return;
    try {
      const { data } = await api<{ data: AnaliseDeImportacao }>(
        "financas/importacoes/analise",
        { method: "POST", body: formulario(lista, ms) },
      );
      setAnalise(data);
      destino.sugerir(data.sugestao);
    } catch (falha) {
      setErro((falha as Error).message);
    }
  }

  async function revisar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const { data } = await api<{ data: ImportacaoComLinhas }>("financas/importacoes", {
        method: "POST",
        body: formulario(arquivos, mapeamentos, destino.pedido()),
      });
      onRevisao(data);
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  const pendentes = analise?.para_mapear ?? [];
  return (
    <Card title="Importar extrato ou fatura">
      <form onSubmit={(e) => void revisar(e)} className="flex flex-col gap-4" noValidate>
        <label className={ROTULO}>
          Arquivos OFX ou CSV
          <input
            type="file"
            accept=".ofx,.qfx,.csv,.txt"
            multiple
            className={cn(CAMPO, "py-1.5")}
            onChange={(e) => void ler(Array.from(e.target.files ?? []))}
          />
        </label>
        <p className="m-0 text-xs text-text-3">
          No app ou no internet banking, exporte o extrato da conta ou a fatura do cartão
          em OFX (às vezes chamado de Money) ou CSV. Nubank, Inter, Itaú e C6 são lidos
          direto; de outro banco, você diz uma vez quais são as colunas. Dá para enviar
          vários de uma vez. Fatura só em PDF ou foto vai na leitura com IA, abaixo.
        </p>
        {analise && analise.arquivos.length > 0 && (
          <ul
            aria-label="Arquivos lidos"
            className="m-0 flex list-none flex-col gap-1 p-0"
          >
            {analise.arquivos.map((a) => (
              <li key={a.nome} className="text-sm">
                <span className="font-semibold">{a.nome}</span>
                <span className="text-text-3">
                  {" · "}
                  {a.tipo === "cartao" ? "fatura de cartão" : "extrato de conta"}
                  {" · "}
                  {a.linhas} {a.linhas === 1 ? "linha" : "linhas"}
                  {a.inicio && a.fim ? ` · ${dataBr(a.inicio)} a ${dataBr(a.fim)}` : ""}
                </span>
                {a.avisos.length > 0 && (
                  <span className="block text-xs text-warn">{a.avisos.join("; ")}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {pendentes.map((p) => (
          <MapeamentoDoCsv
            key={p.assinatura}
            csv={p}
            onAplicar={(m) =>
              void ler(arquivos, [
                ...mapeamentos.filter((x) => x.assinatura !== m.assinatura),
                m,
              ])
            }
          />
        ))}
        {analise && analise.arquivos.length > 0 && (
          <SeletorDeDestino d={destino} sugestao={analise.sugestao} />
        )}
        {erro && (
          <p role="alert" className="m-0 text-sm text-down">
            {erro}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={
            enviando ||
            !analise ||
            pendentes.length > 0 ||
            analise.arquivos.length === 0 ||
            !destino.completo
          }
        >
          <Upload aria-hidden="true" size={16} />
          Revisar linhas
        </Button>
      </form>
    </Card>
  );
}

/** Edicao de uma linha: transferencia e divisao em duas categorias. */
function DetalheDaLinha({
  imp,
  linha,
  categorias,
  onMudou,
}: {
  imp: ImportacaoComLinhas;
  linha: LinhaDeImportacao;
  categorias: Categoria[];
  onMudou: (e: Record<string, unknown>) => Promise<void>;
}) {
  const { data: contas = [] } = useContas();
  const { data: cartoes = [] } = useCartoes();
  const [c1, setC1] = useState(
    linha.divisoes?.[0]?.category_id ?? linha.category_id ?? "",
  );
  const [v1, setV1] = useState(linha.divisoes?.[0]?.valor.replace(".", ",") ?? "");
  const [c2, setC2] = useState(linha.divisoes?.[1]?.category_id ?? "");
  const [v2, setV2] = useState(linha.divisoes?.[1]?.valor.replace(".", ",") ?? "");
  const outra = linha.transferencia_conta_id
    ? linha.transferencia_conta_id
    : linha.transferencia_cartao_id
      ? `cartao:${linha.transferencia_cartao_id}`
      : "";
  // Debito da conta paga fatura; credito do cartao vem de uma conta.
  const podeCartao = imp.alvo === "conta" && linha.tipo === "despesa";
  const podeConta = imp.alvo === "conta" || linha.tipo === "receita";

  return (
    <div className="grid grid-cols-1 gap-3 rounded-control bg-surface-2 p-3 md:grid-cols-2">
      <label className={ROTULO}>
        Transferência entre contas
        <select
          className={CAMPO}
          value={outra}
          onChange={(e) => {
            const v = e.target.value;
            void onMudou(
              v.startsWith("cartao:")
                ? { transferencia_cartao_id: v.slice(7), transferencia_conta_id: null }
                : { transferencia_conta_id: v || null, transferencia_cartao_id: null },
            );
          }}
        >
          <option value="">Não é transferência</option>
          {podeConta &&
            contas
              .filter((c) => c.id !== imp.account_id && !c.arquivada)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {linha.tipo === "despesa" ? "Para" : "De"} {c.nome}
                </option>
              ))}
          {podeCartao &&
            cartoes
              .filter((c) => !c.arquivado)
              .map((c) => (
                <option key={c.id} value={`cartao:${c.id}`}>
                  Pagamento da fatura {c.nome}
                </option>
              ))}
        </select>
      </label>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1.5 text-xs text-text-3">Dividir em duas categorias</legend>
        {[
          [c1, setC1, v1, setV1],
          [c2, setC2, v2, setV2],
        ].map(([c, setC, v, setV], i) => (
          <div key={i} className="grid grid-cols-[1fr_110px] gap-2">
            <select
              aria-label={`Categoria ${i + 1}`}
              className={CAMPO}
              value={c as string}
              onChange={(e) => (setC as (x: string) => void)(e.target.value)}
            >
              <Categorias categorias={categorias} natureza={linha.tipo} />
            </select>
            <input
              aria-label={`Valor ${i + 1}`}
              className={cn(CAMPO, "font-mono")}
              inputMode="decimal"
              value={v as string}
              onChange={(e) => (setV as (x: string) => void)(e.target.value)}
              placeholder="0,00"
            />
          </div>
        ))}
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={!c1 || !c2 || !v1 || !v2}
            onClick={() =>
              void onMudou({
                divisoes: [
                  { category_id: c1, valor: v1 },
                  { category_id: c2, valor: v2 },
                ],
              })
            }
          >
            <Split aria-hidden="true" size={16} />
            Dividir
          </Button>
          {linha.divisoes && (
            <Button variant="ghost" onClick={() => void onMudou({ divisoes: null })}>
              Desfazer divisão
            </Button>
          )}
        </div>
      </fieldset>
    </div>
  );
}

/** Passo 2: revisao editavel, resumo e confirmacao. */
function Revisao({
  inicial,
  onFim,
}: {
  inicial: ImportacaoComLinhas;
  onFim: () => void;
}) {
  const cliente = useQueryClient();
  const { data: categorias = [] } = useCategorias();
  const [imp, setImp] = useState(inicial);
  const [aberta, setAberta] = useState<string | null>(null);
  const [corrigida, setCorrigida] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const emRevisao = imp.status === "revisao";
  const nomeDaCategoria = new Map(categorias.map((c) => [c.id, c.nome]));

  async function mudar(linha: string, e: Record<string, unknown>) {
    setErro(null);
    try {
      setImp(await editarLinha(imp.id, linha, e));
    } catch (falha) {
      setErro((falha as Error).message);
    }
  }

  async function agir(acao: "confirmar" | "cancelar" | "desfazer") {
    setErro(null);
    setOcupado(true);
    try {
      const r = await acaoDaImportacao(imp.id, acao);
      setImp({ ...imp, ...r });
      void cliente.invalidateQueries({ queryKey: CHAVE });
      if (acao === "cancelar") onFim();
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const t = imp.totais;
  const suspeitas = new Set(
    imp.conferencia_fatura?.confere === false ? imp.conferencia_fatura.suspeitas : [],
  );
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile
          label="Linhas"
          value={t.linhas}
          subtitle={`${t.selecionadas} ${t.selecionadas === 1 ? "marcada" : "marcadas"}`}
        />
        <StatTile
          label="Total a gravar"
          value={<Money value={t.total} />}
          subtitle={
            imp.alvo === "cartao" ? (
              <>
                compras <Money value={somaMarcadas(imp.linhas, "despesa")} /> · créditos{" "}
                <Money value={somaMarcadas(imp.linhas, "receita")} />
              </>
            ) : undefined
          }
        />
        <StatTile label="Já importadas" value={t.duplicadas} />
        <StatTile label="Possíveis duplicatas" value={t.possiveis_duplicatas} />
        <StatTile label="Sem categoria" value={t.sem_categoria} />
      </div>
      {imp.conferencia && (
        <p
          className={cn(
            "m-0 rounded-control px-3 py-2 text-sm",
            imp.conferencia.confere ? "bg-up-soft" : "bg-warn-bg",
          )}
        >
          {imp.conferencia.confere ? "Saldo confere: " : "Saldo diverge: "}o extrato diz{" "}
          <Money value={imp.conferencia.saldo_informado} /> em{" "}
          {dataBr(imp.conferencia.data)}; a conta fica com{" "}
          <Money value={imp.conferencia.saldo_calculado} />
          {imp.conferencia.confere ? "." : ". Confira o saldo inicial da conta."}
        </p>
      )}
      {imp.conferencia_fatura && (
        <p
          role={imp.conferencia_fatura.confere ? undefined : "alert"}
          aria-label="Total da fatura"
          className={cn(
            "m-0 rounded-control px-3 py-2 text-sm",
            imp.conferencia_fatura.confere ? "bg-up-soft" : "bg-warn-bg",
          )}
        >
          {imp.conferencia_fatura.confere ? (
            <>
              Total da fatura confere:{" "}
              <Money value={imp.conferencia_fatura.total_informado} />.
            </>
          ) : (
            <>
              A soma das linhas (<Money value={imp.conferencia_fatura.total_calculado} />)
              não bate com o total da fatura (
              <Money value={imp.conferencia_fatura.total_informado} />
              ): diferença de <Money value={imp.conferencia_fatura.diferenca} />.{" "}
              {imp.conferencia_fatura.suspeitas.length > 0
                ? `Confira as ${imp.conferencia_fatura.suspeitas.length} linhas destacadas.`
                : "Confira se faltou alguma linha."}
            </>
          )}
        </p>
      )}
      {imp.extracao_id && (
        <p className="m-0 text-xs text-text-3">
          Lida do PDF ou da foto. Confira as linhas antes de gravar: nada é gravado sem a
          sua confirmação.
        </p>
      )}
      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}
      <Card title={emRevisao ? "Revise antes de gravar" : STATUS[imp.status]}>
        <table
          aria-label="Linhas da importação"
          className="w-full border-collapse text-sm"
        >
          <thead>
            <tr className="text-left text-xs text-text-3">
              <th className="w-8 py-2">
                <span className="sr-only">Importar</span>
              </th>
              <th className="hidden py-2 font-medium md:table-cell">Data</th>
              <th className="py-2 font-medium">Descrição</th>
              <th className="py-2 font-medium">Categoria</th>
              <th className="hidden py-2 text-right font-medium md:table-cell">Valor</th>
              <th className="py-2">
                <span className="sr-only">Mais</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {imp.linhas.map((l) => {
              const transferencia = l.transferencia_conta_id || l.transferencia_cartao_id;
              const suspeita = suspeitas.has(l.id);
              const iguais = imp.linhas.filter(
                (x) =>
                  x.id !== l.id &&
                  x.tipo === l.tipo &&
                  x.descricao_normalizada === l.descricao_normalizada,
              ).length;
              return [
                <tr
                  key={l.id}
                  className={cn(
                    "border-t border-border align-top",
                    l.acao === "ignorar" && "text-text-3",
                    suspeita && "bg-warn-bg",
                  )}
                >
                  <td className="py-2.5">
                    <input
                      type="checkbox"
                      aria-label={`Importar ${l.descricao_original}`}
                      checked={l.acao !== "ignorar"}
                      disabled={!emRevisao}
                      onChange={(e) =>
                        void mudar(l.id, {
                          acao: e.target.checked
                            ? l.situacao === "possivel_duplicata"
                              ? "conciliar"
                              : "importar"
                            : "ignorar",
                        })
                      }
                    />
                  </td>
                  <td className="hidden py-2.5 font-mono text-xs whitespace-nowrap md:table-cell">
                    {dataBr(l.data)}
                  </td>
                  <td className="py-2.5">
                    <span className="break-words">{l.descricao_original}</span>
                    {/* No celular, data e valor embaixo: a coluna fica para a categoria. */}
                    <span className="block font-mono text-xs text-text-3 md:hidden">
                      {dataBr(l.data)} ·{" "}
                      <Money
                        value={comSinal(l)}
                        className={l.tipo === "despesa" ? "text-down" : "text-up"}
                      />
                    </span>
                    <span className="flex flex-wrap gap-1.5 text-xs">
                      {suspeita && (
                        <span className="font-semibold text-warn">suspeita</span>
                      )}
                      {l.marcacao && l.marcacao !== "pagamento" && (
                        <span className="text-text-2">{MARCACAO[l.marcacao]}</span>
                      )}
                      {l.moeda_original && l.valor_moeda_original && (
                        <span className="text-text-3">
                          {l.moeda_original} {l.valor_moeda_original.replace(".", ",")}
                        </span>
                      )}
                      {l.aviso && <span className="text-warn">{l.aviso}</span>}
                      {l.parcela_atual && (
                        <span className="text-text-3">
                          parcela {l.parcela_atual}/{l.parcela_total}
                        </span>
                      )}
                      {l.situacao === "ja_importada" && (
                        <span className="text-text-3">já importada</span>
                      )}
                      {l.situacao === "possivel_duplicata" && (
                        <span className="text-warn">
                          {l.acao === "conciliar" ? "conciliar com" : "parecida com"}{" "}
                          {l.duplicata_descricao ?? "lançamento existente"}
                          {emRevisao && (
                            <button
                              type="button"
                              className="ml-1.5 cursor-pointer border-0 bg-transparent p-0 text-link underline"
                              onClick={() =>
                                void mudar(l.id, {
                                  acao: l.acao === "conciliar" ? "importar" : "conciliar",
                                })
                              }
                            >
                              {l.acao === "conciliar"
                                ? "gravar mesmo assim"
                                : "conciliar"}
                            </button>
                          )}
                        </span>
                      )}
                      {transferencia && (
                        <span className="text-text-2">transferência</span>
                      )}
                      {l.sugere_transferencia &&
                        !transferencia &&
                        l.acao === "importar" && (
                          <span className="text-text-3">parece transferência</span>
                        )}
                      {imp.alvo === "cartao" &&
                        l.tipo === "receita" &&
                        l.sugere_transferencia &&
                        l.situacao === "nova" &&
                        l.acao === "ignorar" &&
                        emRevisao && (
                          <span className="text-warn">
                            pagamento da fatura: marque e escolha a conta de onde saiu
                          </span>
                        )}
                      {l.origem_categoria === "banco" &&
                        l.category_id === l.categoria_detectada &&
                        !transferencia && (
                          <span className="text-text-3">categoria do banco</span>
                        )}
                    </span>
                  </td>
                  <td className="py-2.5">
                    {transferencia ? (
                      <span className="text-text-3">-</span>
                    ) : l.divisoes ? (
                      <span className="text-xs text-text-2">
                        {l.divisoes
                          .map((p) => `${nomeDaCategoria.get(p.category_id)} ${p.valor}`)
                          .join(" + ")}
                      </span>
                    ) : (
                      <select
                        aria-label={`Categoria de ${l.descricao_original}`}
                        className={cn(CAMPO, "w-[130px] py-1 md:w-auto md:min-w-[150px]")}
                        value={l.category_id ?? ""}
                        disabled={!emRevisao || l.acao !== "importar"}
                        onChange={(e) => {
                          setCorrigida(l.id);
                          void mudar(l.id, { category_id: e.target.value || null });
                        }}
                      >
                        <Categorias categorias={categorias} natureza={l.tipo} />
                      </select>
                    )}
                    {corrigida === l.id && l.category_id && emRevisao && (
                      <span className="mt-1 flex flex-wrap gap-2 text-xs">
                        {iguais > 0 && (
                          <button
                            type="button"
                            className="cursor-pointer border-0 bg-transparent p-0 text-link underline"
                            onClick={() => {
                              setCorrigida(null);
                              void mudar(l.id, {
                                category_id: l.category_id,
                                aplicar_a_iguais: true,
                              });
                            }}
                          >
                            Aplicar às {iguais} iguais
                          </button>
                        )}
                        <button
                          type="button"
                          className="cursor-pointer border-0 bg-transparent p-0 text-link underline"
                          onClick={() => {
                            setCorrigida(null);
                            void mudar(l.id, {
                              category_id: l.category_id,
                              criar_regra: true,
                              aplicar_a_iguais: true,
                            });
                          }}
                        >
                          Criar regra
                        </button>
                      </span>
                    )}
                  </td>
                  <td className="hidden py-2.5 text-right whitespace-nowrap md:table-cell">
                    <Money
                      value={comSinal(l)}
                      className={l.tipo === "despesa" ? "text-down" : "text-up"}
                    />
                  </td>
                  <td className="py-2.5 text-right">
                    {emRevisao && l.acao === "importar" && (
                      <Button
                        variant="ghost"
                        className="px-2"
                        aria-label={`Transferência ou divisão de ${l.descricao_original}`}
                        aria-expanded={aberta === l.id}
                        onClick={() => setAberta(aberta === l.id ? null : l.id)}
                      >
                        <ArrowLeftRight aria-hidden="true" size={16} />
                      </Button>
                    )}
                  </td>
                </tr>,
                aberta === l.id && (
                  <tr key={`${l.id}-detalhe`}>
                    <td colSpan={6} className="pb-3">
                      <DetalheDaLinha
                        imp={imp}
                        linha={l}
                        categorias={categorias}
                        onMudou={(e) => mudar(l.id, e)}
                      />
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </Card>
      <div className="flex flex-wrap gap-2">
        {emRevisao ? (
          <>
            <Button
              variant="primary"
              disabled={ocupado}
              onClick={() => void agir("confirmar")}
            >
              Confirmar importação
            </Button>
            <Button
              variant="ghost"
              disabled={ocupado}
              onClick={() => void agir("cancelar")}
            >
              Cancelar
            </Button>
          </>
        ) : (
          <>
            {imp.status === "confirmada" && (
              <p role="status" className="m-0 self-center text-sm text-text-2">
                {t.gravadas}{" "}
                {t.gravadas === 1 ? "lançamento gravado" : "lançamentos gravados"}.
              </p>
            )}
            <Button asChild variant="secondary">
              <a href="/financas/lancamentos">Ver lançamentos</a>
            </Button>
            {imp.pode_desfazer && (
              <Button
                variant="ghost"
                disabled={ocupado}
                onClick={() => {
                  if (window.confirm("Apagar os lançamentos desta importação?"))
                    void agir("desfazer");
                }}
              >
                <Undo2 aria-hidden="true" size={16} />
                Desfazer importação
              </Button>
            )}
            <Button variant="ghost" onClick={onFim}>
              Importar outro arquivo
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function Historico({ onAbrir }: { onAbrir: (id: string) => void }) {
  const cliente = useQueryClient();
  const { data, isPending } = useImportacoes();
  const { data: contas = [] } = useContas();
  const { data: cartoes = [] } = useCartoes();
  const [erro, setErro] = useState<string | null>(null);
  const nome = new Map([
    ...contas.map((c) => [c.id, c.nome] as const),
    ...cartoes.map((c) => [c.id, c.nome] as const),
  ]);
  if (isPending) return <Skeleton className="h-20" />;
  if (!data?.length) return null;
  return (
    <Card title="Importações anteriores">
      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}
      <ul aria-label="Importações" className="m-0 flex list-none flex-col p-0">
        {data.map((i) => (
          <li
            key={i.id}
            className="flex flex-wrap items-center gap-3 border-b border-border py-2.5 text-sm last:border-0"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-semibold">{i.arquivo_nome}</span>
              <span className="text-xs text-text-3">
                {nome.get(i.account_id ?? i.card_id ?? "")}
                {i.vencimento ? ` · fatura ${dataBr(i.vencimento)}` : ""} ·{" "}
                {STATUS[i.status]} · {i.totais.gravadas || i.totais.selecionadas} de{" "}
                {i.totais.linhas} linhas
              </span>
            </span>
            {i.status === "revisao" && (
              <Button variant="secondary" onClick={() => onAbrir(i.id)}>
                Continuar revisão
              </Button>
            )}
            {i.pode_desfazer && (
              <Button
                variant="ghost"
                aria-label={`Desfazer ${i.arquivo_nome}`}
                onClick={() => {
                  if (!window.confirm("Apagar os lançamentos desta importação?")) return;
                  setErro(null);
                  acaoDaImportacao(i.id, "desfazer")
                    .then(() => cliente.invalidateQueries({ queryKey: CHAVE }))
                    .catch((falha: Error) => setErro(falha.message));
                }}
              >
                <Undo2 aria-hidden="true" size={16} />
                Desfazer
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function PaginaDeImportacao() {
  const cliente = useQueryClient();
  const { data: contas = [], isPending } = useContas();
  const { data: cartoes = [] } = useCartoes();
  const [revisao, setRevisao] = useState<ImportacaoComLinhas | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function abrir(id: string) {
    setErro(null);
    try {
      const { data } = await api<{ data: ImportacaoComLinhas }>(
        `financas/importacoes/${id}`,
      );
      setRevisao(data);
    } catch (falha) {
      setErro((falha as Error).message);
    }
  }

  // /financas/importar?id=... reabre uma revisao.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) void abrir(id);
  }, []);

  const sair = () => {
    setRevisao(null);
    void cliente.invalidateQueries({ queryKey: CHAVE });
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-[26px] font-bold tracking-tight">Importar</h1>
        <a href="/financas/regras" className="text-sm">
          Regras de categorização
        </a>
      </header>
      {erro && (
        <p role="alert" className="m-0 text-sm text-down">
          {erro}
        </p>
      )}
      {!isPending && contas.length === 0 && cartoes.length === 0 ? (
        <Card>
          <EmptyState
            title="Crie uma conta ou um cartão primeiro"
            description="O extrato entra numa conta; a fatura, num cartão."
            action={
              <Button asChild variant="primary">
                <a href="/financas/contas?nova=1">Criar conta</a>
              </Button>
            }
          />
        </Card>
      ) : revisao ? (
        <Revisao key={revisao.id} inicial={revisao} onFim={sair} />
      ) : (
        <>
          <Envio onRevisao={setRevisao} />
          <LeituraComIA onRevisao={setRevisao} />
        </>
      )}
      {!revisao && <Historico onAbrir={(id) => void abrir(id)} />}
    </div>
  );
}
