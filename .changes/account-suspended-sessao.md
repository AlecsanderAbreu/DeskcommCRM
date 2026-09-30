---
impacto: correcao
secao: corrigido
titulo: Sessão volta a ser renovada na tela de conta suspensa
---

`/account-suspended` estava na lista de caminhos públicos do proxy
(`lib/auth/public-paths.ts`). Por isso o `proxy.ts` saía antes do
`getUser()` — que é quem revalida e renova o cookie da sessão — e o
refresh que a própria página tentava no Server Component é ignorado por
desenho (`lib/supabase/server.ts`). Na prática, a sessão que expirava
com a pessoa nessa tela nunca era renovada, e uma navegação seguinte
podia derrubá-la no login.

A rota agora sai da lista pública. Quem cai em `/account-suspended` vem
do redirect do layout de `/app` já autenticado, então o proxy passa a
revalidar e renovar a sessão normalmente ali, como em qualquer outra
rota da árvore logada. A única mudança visível é o caso extremo de um
visitante não autenticado direto na URL, que agora é levado ao login em
vez de ver a mensagem — coerente com a tela virar lugar de trabalho
autenticado (pedidos de LGPD de empresa suspensa).

Refs #2016

Contribuição de @webtecnica (#2019).