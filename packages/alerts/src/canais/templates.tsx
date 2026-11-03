import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { render } from "@react-email/render";
import tokens from "@bolsiq/ui/tokens.json" with { type: "json" };
import type { NotificacaoParaEnvio } from "./canal.js";

/**
 * E-mail de alerta com React Email, no visual do Bolsiq.
 *
 * Cliente de e-mail nao le CSS externo nem variavel CSS: as cores vem de
 * tokens.json, gerado de tokens.css no build do packages/ui. Mudar uma cor no
 * design muda o e-mail sem tocar aqui.
 */
const cor = tokens as Record<string, string>;

const estilo = {
  body: {
    backgroundColor: cor.bg,
    margin: 0,
    padding: "24px 0",
    fontFamily: "Inter, system-ui, sans-serif",
  },
  container: {
    backgroundColor: cor.surface,
    border: `1px solid ${cor.border}`,
    borderRadius: cor["card-radius"],
    maxWidth: "560px",
    margin: "0 auto",
    padding: "24px",
  },
  marca: { color: cor.text, fontSize: "18px", fontWeight: 700, margin: "0 0 20px" },
  logo: {
    display: "inline-block",
    width: "28px",
    height: "28px",
    lineHeight: "28px",
    textAlign: "center" as const,
    borderRadius: cor["item-radius"],
    backgroundColor: cor.accent,
    color: cor["on-accent"],
    marginRight: "8px",
  },
  titulo: { color: cor.text, fontSize: "20px", fontWeight: 700, margin: "0 0 8px" },
  corpo: {
    color: cor["text-2"],
    fontSize: "15px",
    lineHeight: "1.5",
    margin: "0 0 20px",
  },
  botao: {
    backgroundColor: cor.accent,
    color: cor["on-accent"],
    borderRadius: cor["control-radius"],
    padding: "12px 18px",
    fontWeight: 700,
    fontSize: "14px",
    textDecoration: "none",
  },
  rodape: { color: cor["text-3"], fontSize: "12px", lineHeight: "1.5", margin: 0 },
  linha: { borderColor: cor.border, margin: "24px 0 16px" },
};

export function EmailDeAlerta({
  titulo,
  corpo,
  link,
  preferencias,
}: {
  titulo: string;
  corpo: string;
  link: string;
  preferencias: string;
}) {
  return (
    <Html lang="pt-BR">
      <Head />
      <Preview>{corpo}</Preview>
      <Body style={estilo.body}>
        <Container style={estilo.container}>
          <Text style={estilo.marca}>
            <span style={estilo.logo}>B</span>Bolsiq
          </Text>
          <Heading as="h1" style={estilo.titulo}>
            {titulo}
          </Heading>
          <Text style={estilo.corpo}>{corpo}</Text>
          <Section>
            <Button href={link} style={estilo.botao}>
              Ver no Bolsiq
            </Button>
          </Section>
          <Hr style={estilo.linha} />
          <Text style={estilo.rodape}>
            Você recebeu este e-mail porque criou um alerta. Não é recomendação de
            investimento. Ajuste os canais em{" "}
            <a href={preferencias} style={{ color: cor.link }}>
              preferências de notificação
            </a>
            .
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

/**
 * Assunto, html e texto do e-mail. O React escapa titulo e corpo, que trazem
 * ticker e valores vindos de evento: dado de fonte externa nao vira HTML.
 */
export async function templateDeEmail(n: NotificacaoParaEnvio, urlBase: string) {
  const link = `${urlBase}/alertas?n=${encodeURIComponent(n.id)}`;
  const preferencias = `${urlBase}/configuracoes/notificacoes`;
  const elemento = (
    <EmailDeAlerta
      titulo={n.titulo}
      corpo={n.corpo}
      link={link}
      preferencias={preferencias}
    />
  );
  return {
    assunto: n.titulo,
    html: await render(elemento),
    texto: await render(elemento, { plainText: true }),
  };
}

/**
 * Escapa HTML. Para quem monta texto fora do React (Telegram em HTML).
 */
export function escapar(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
