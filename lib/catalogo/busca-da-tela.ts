/**
 * A BUSCA DA TELA DE PRODUTOS — a mesma régua para a página e para a rota.
 *
 * ─── Por que existe ─────────────────────────────────────────────────────────
 *
 * A tela carregava os 500 primeiros produtos e filtrava NO NAVEGADOR. Num
 * catálogo maior que isso, o resto não aparecia nem pela busca: medido numa
 * instalação com ~4.400 produtos, cerca de 3.900 eram inalcançáveis para quem
 * administra — enquanto o agente, que busca no servidor
 * (`lib/mcp/tools/comercio.ts`), enxergava todos. Agora a busca vai ao banco.
 *
 * ─── O termo, antes de virar filtro ─────────────────────────────────────────
 *
 * A mesma composição da busca de contatos (`app/api/v1/contacts/_handler.ts`):
 *
 *   parênteses saem ANTES  → são delimitador do DSL do `.or()` do PostgREST, e
 *                            a normalização não os conhece
 *   normalizarTermoDeBusca → como a pessoa digita: espaço, vírgula e ponto e
 *                            vírgula viram um curinga só ("glock 17" acha
 *                            "Glock G17") — e a vírgula, que injetaria uma
 *                            condição no `.or()`, some
 *   `%`/`_` escapados      → gramática do LIKE: curinga digitado é literal
 *
 * A rota montava o `.or()` com o texto cru: um nome com vírgula injetava
 * condição, um parêntese sem par derrubava a busca com 400 e `%` virava
 * curinga. E `buscaValeConsulta` barra o termo curto ou só de pontuação, que
 * normalizado viraria `%%`: aqui ele vira `null`, e o QUE fazer com o `null`
 * é de quem chama. A rota devolve lista vazia, como a busca de contatos (sem
 * isso, `null` era consulta sem filtro — o catálogo inteiro no seletor da
 * proposta); a tela mostra a lista sem filtro, como se não houvesse busca.
 *
 * A busca da TELA continua sendo substring simples, de propósito: quem opera a
 * loja digita como cadastrou. A busca por token, que tolera "ifone", é a do
 * agente, em `lib/catalogo/busca.ts`, e responde a outra pergunta.
 */
import { buscaValeConsulta, normalizarTermoDeBusca } from "@/lib/inbox/termo-de-busca";

/** Produtos por página na tela. */
export const PRODUTOS_POR_PAGINA = 50;

/**
 * O filtro `or=` da busca, ou `null` quando o termo não vale uma consulta
 * (vazio, curto demais ou só pontuação). `null` NÃO significa "sem filtro":
 * cada chamador decide (ver o cabeçalho deste arquivo).
 */
export function filtroDaBuscaDoCatalogo(bruto: string | null | undefined): string | null {
  const termo = (bruto ?? "").trim();
  if (!buscaValeConsulta(termo)) return null;
  const s = normalizarTermoDeBusca(termo.replace(/[()]/g, " ")).replace(/[%_]/g, (m) => `\\${m}`);
  return ["nome", "codigo", "marca", "categoria"].map((c) => `${c}.ilike.*${s}*`).join(",");
}

/** A página pedida na URL, sempre um inteiro ≥ 1. */
export function paginaDaUrl(bruto: string | null | undefined): number {
  const n = Number.parseInt(bruto ?? "", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** O intervalo `range(de, ate)` do PostgREST para a página. */
export function intervaloDaPagina(pagina: number, porPagina = PRODUTOS_POR_PAGINA): [number, number] {
  const de = (pagina - 1) * porPagina;
  return [de, de + porPagina - 1];
}
