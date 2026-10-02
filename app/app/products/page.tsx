import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import {
  filtroDaBuscaDoCatalogo,
  intervaloDaPagina,
  paginaDaUrl,
  PRODUTOS_POR_PAGINA,
} from "@/lib/catalogo/busca-da-tela";
import { BUCKET_DAS_FOTOS, fotoPertenceAoProduto } from "@/lib/catalogo/fotos";
import { traduzir } from "@/lib/i18n/dicionario";
import { COLUNAS_DO_PRODUTO, type Produto } from "@/lib/schemas/produtos";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { ProdutosClient } from "./_client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Produtos" };

/**
 * O CATÁLOGO DA LOJA — onde o preço que a IA responde é cadastrado.
 *
 * ─── Por que esta tela precisa existir ───────────────────────────────────
 *
 * A ferramenta `crm_search_products` já vinha ligada em todo agente novo, e
 * lia uma tabela que ninguém nunca preencheu. O efeito não era silêncio: era o
 * agente respondendo "não tenho nada com esse nome no catálogo" para uma loja
 * com o estoque cheio. Ferramenta que devolve vazio para 100% das lojas é pior
 * que ferramenta ausente — ela mente com autoridade.
 *
 * ─── Quem pode o quê ─────────────────────────────────────────────────────
 *
 * `viewer` VÊ o catálogo: saber quanto custa é informação de operação, e quem
 * atende precisa dela. Cadastrar e alterar preço é `manager`, e a rota cobra de
 * novo — a tela esconder o botão é cortesia, não autorização.
 */
export default async function ProdutosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireAuth();
  const t = (texto: string) => traduzir(texto, user.idioma);
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const podeEditar = (user.is_platform_admin && !user.support) || ROLE_RANK[activeOrg.role] >= ROLE_RANK.manager;

  // Busca e página moram na URL: o servidor traz só a página pedida, de TODO o
  // catálogo. Antes eram os 500 primeiros, filtrados no navegador — o resto não
  // aparecia nem pela busca (ver `lib/catalogo/busca-da-tela.ts`).
  const parametros = await searchParams;
  const busca = (parametros.busca ?? "").trim();
  const pagina = paginaDaUrl(parametros.pagina);
  const filtro = filtroDaBuscaDoCatalogo(busca);

  const supabase = await createClient();
  let consulta = supabase
    .from("catalog_products")
    .select(COLUNAS_DO_PRODUTO, { count: "exact" })
    .eq("organization_id", activeOrg.orgId);
  if (filtro) consulta = consulta.or(filtro);
  const { data, count } = await consulta
    .order("ativo", { ascending: false })
    .order("nome")
    .order("id")
    .range(...intervaloDaPagina(pagina));
  const produtos = (data ?? []) as unknown as Produto[];
  const total = count ?? produtos.length;

  // O bucket é privado: a tela recebe URL assinada de 1 h, montada aqui. Só
  // caminho que é DO produto (ver `fotoPertenceAoProduto`) — a assinatura é
  // por service role, e a linha é gravável pelo PostgREST.
  const caminhos = produtos.flatMap((p) =>
    (p.fotos ?? []).filter((c) => fotoPertenceAoProduto(c, activeOrg.orgId, p.id)),
  );
  const urlsDasFotos: Record<string, string> = {};
  if (caminhos.length > 0) {
    const { data: assinadas } = await createAdminClient()
      .storage.from(BUCKET_DAS_FOTOS)
      .createSignedUrls(caminhos, 3600);
    for (const a of assinadas ?? []) {
      if (a.path && a.signedUrl) urlsDasFotos[a.path] = a.signedUrl;
    }
  }

  return (
    <ProdutosClient
      inicial={produtos}
      total={total}
      pagina={pagina}
      porPagina={PRODUTOS_POR_PAGINA}
      buscaInicial={busca}
      urlsDasFotos={urlsDasFotos}
      podeEditar={podeEditar}
      textos={{
        titulo: t("Produtos"),
        subtitulo: t(
          "O catálogo da loja. É daqui que o atendente de IA tira o preço quando alguém pergunta.",
        ),
        vazio: t("Nenhum produto cadastrado ainda"),
        vazioDica: t(
          "Enquanto o catálogo estiver vazio, o atendente responde que não encontrou o produto — mesmo que a loja tenha.",
        ),
      }}
    />
  );
}
