import { ListaDeAtivos } from "@/componentes/ativo/ListaDeAtivos";

export const metadata = { title: "Ativos" };

/**
 * Ponto de partida da aba Ativos e do "voltar" da pagina do ativo. No celular,
 * as paginas /ativo/* escondem o topo com a busca; aqui ele aparece.
 */
export default function Ativos() {
  return (
    <>
      <h1 className="m-0 text-[26px] font-bold tracking-tight">Ativos</h1>
      <p className="m-0 text-text-2">
        Busque pelo campo do topo uma ação, FII, BDR, ETF ou fundo.
      </p>
      <ListaDeAtivos />
    </>
  );
}
