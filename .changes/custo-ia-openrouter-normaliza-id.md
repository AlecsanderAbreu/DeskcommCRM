---
impacto: nada_mudou
secao: corrigido
titulo: Custo de IA conta OpenRouter com ponto/variante e preço desconhecido deixa de ser "grátis"
---

O custo de IA do runtime nativo não casava ids do OpenRouter com ponto ou
variante na tabela do catálogo (`anthropic/claude-haiku-4.5` ×
`anthropic/claude-haiku-4-5`, sufixos `:beta`/`:free`), e o `return 0` do
caminho de preço não encontrado contava um modelo caro como gratuito: a tela
de uso e o orçamento mostravam R$ 0,00 com o dinheiro saindo, e o teto de
gasto nunca disparava (o mesmo sintoma da issue #1880, calado).

O id agora é normalizado antes do lookup — recorte do sufixo de variante,
recorte do prefixo `provider/`, e a versão com ponto passa a casar a grafia
com hífen do catálogo —, e custo desconhecido devolve `null` (sem preço
conhecido), nunca zero. Quem soma no teto coalesce `null` para 0, então modelo
sem preço não consome teto nem aborta a chamada por um número inventado; quem
reporta vê `null` e distingue de "grátis". Preço desconhecido avisa uma vez por
modelo no log.

`corrigido` em `secao` e `nada_mudou` em `impacto`: nenhuma ação do operador —
a conta de custo volta a refletir o que foi gasto sem exigir migração.

Sem migration, sem mudança de schema. Não toca `ai_agent_runs`/`tool_calls`
além de gravar o custo `null` que o contrato pedia.