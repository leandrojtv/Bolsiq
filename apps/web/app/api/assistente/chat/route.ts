import { randomUUID } from "node:crypto";
import {
  ContextoDaTela,
  conversar,
  criarModelo,
  ferramentasDoModulo,
  mensagemSegura,
  moduloDoCaminho,
  montarSistema,
} from "@bolsiq/assistant";
import {
  acessoParaConversar,
  encerrarTurno,
  fontesDoUsuario,
  fontesFinanceirasDoUsuario,
  gravarResposta,
  iniciarTurno,
  moduloDaConversa,
  modoDeRecomendacao,
  registrarErro,
} from "@/lib/assistente";
import { PedidoDeChat } from "@/lib/assistente-modelo";
import { usuarioLogado } from "@/lib/auth";
import { hojeEmSp } from "@/lib/indicadores-tecnicos";
import { invalido, naoAutenticado } from "@/lib/respostas";
import { tratarAssistente } from "@/lib/respostas-assistente";

export const dynamic = "force-dynamic";

/**
 * Um turno de conversa. O navegador manda so o texto novo: o historico vem do
 * banco, para ninguem forjar resultado de ferramenta na requisicao.
 */
export async function POST(req: Request) {
  const u = await usuarioLogado();
  if (!u) return naoAutenticado();
  const corpo = PedidoDeChat.safeParse(await req.json().catch(() => null));
  if (!corpo.success) return invalido(corpo.error);
  const contexto = ContextoDaTela.safeParse(corpo.data.contexto ?? {});

  const dadosDaTela = contexto.success ? contexto.data : undefined;

  try {
    // O modulo da tela vale para conversa nova; a existente segue com o dela.
    const daConversa = corpo.data.conversa_id
      ? await moduloDaConversa(u.id, corpo.data.conversa_id)
      : null;
    const acesso = await acessoParaConversar(
      u.id,
      daConversa ?? moduloDoCaminho(dadosDaTela?.rota),
    );
    const { conversa, modulo, historico } = await iniciarTurno(
      u.id,
      corpo.data.conversa_id,
      corpo.data.texto,
      daConversa ?? moduloDoCaminho(dadosDaTela?.rota),
    );
    const segredos = acesso.chave ? [acesso.chave] : [];
    const hoje = hojeEmSp();
    const modo = modoDeRecomendacao();

    let registrado = false;
    const registrar = async (uso: { tokens_entrada: number; tokens_saida: number }) => {
      if (registrado) return;
      registrado = true;
      await encerrarTurno(u.id, conversa, acesso, uso).catch((e: unknown) =>
        registrarErro(mensagemSegura(e, segredos)),
      );
    };

    const r = conversar({
      modelo: criarModelo(acesso, acesso.modelo),
      sistema: montarSistema({ modo, contexto: dadosDaTela, hoje, modulo }),
      mensagens: [...historico, { role: "user", content: corpo.data.texto }],
      ferramentas: ferramentasDoModulo(modulo, {
        fontes: fontesDoUsuario(u.id),
        financas: fontesFinanceirasDoUsuario(u.id),
        opcoes: { hoje, modo, carteiraDaTela: dadosDaTela?.carteira_id },
      }),
      segredos,
      aoErrar: (m) => {
        registrarErro(m);
        // Chamada que falhou tambem conta no limite do dia.
        void registrar({ tokens_entrada: 0, tokens_saida: 0 });
      },
      aoTerminar: registrar,
    });

    // Termina de consumir mesmo se o navegador fechar: custo e resposta ficam gravados.
    void r.consumeStream({ onError: () => undefined });

    return r.toUIMessageStreamResponse({
      generateMessageId: randomUUID,
      messageMetadata: ({ part }) =>
        part.type === "start" ? { conversa_id: conversa, modulo } : undefined,
      onError: (e) => `Não foi possível responder: ${mensagemSegura(e, segredos)}`,
      onFinish: async ({ responseMessage }) => {
        await gravarResposta(
          u.id,
          conversa,
          responseMessage.id,
          responseMessage.parts,
        ).catch((e: unknown) => registrarErro(mensagemSegura(e, segredos)));
      },
    });
  } catch (erro) {
    return tratarAssistente(erro);
  }
}
