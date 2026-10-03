---
impacto: capacidade_nova
secao: adicionado
titulo: O provedor da busca de prospecção passa a ser escolhido por organização, com a Apify como default
---

A prospecção tinha o provedor de busca como constante de módulo: `ACTOR` e URL base fixos, então num servidor com várias organizações não havia como atender uma organização com fonte própria sem trocar a fonte (e a credencial) de todas. Agora a escolha mora em `organizations.settings.prospecting.provider` — o mesmo jsonb de `settings.llm.provider`, **sem migration nenhuma** — e um despachante de interface única (`startSearch`, `readSearch`, `readResults`) entrega a implementação escolhida: `apify` (default) ou `teste`, o provedor determinístico local que roda o ciclo de busca no CI sem gastar crédito da Apify e sem rede.

Quem não escolheu nada continua exatamente como antes, inclusive a validação da credencial em `users/me`, e a credencial continua na mesma `prospecting_settings.credential_encrypted`, por organização e cifrada. Os contratos de erro (`EscopoDaFalha`, `ProspectingError`) não se moveram: `worker.ts` e `guard.ts` seguem com zero linhas alteradas.

Contribuição de @webtecnica (#2174, refs #1758).
