---
impacto: capacidade_nova
secao: adicionado
titulo: A janela de esfriando de cada etapa vira um campo editável
---

Quem monta o funil já via a janela de esfriando ("X dias sem mexer") só no radar de risco, como leitura — nenhuma tela, rota ou comando do assistente deixava trocar o valor. Agora a etapa ganha um campo editável em configurações (`Janela de esfriando`, com entrada em dias e horas, convertida para horas) e a mesma janela passa a ser aceita e devolvida em toda a cadeia: `PATCH/POST/GET /api/v1/pipelines/.../stages`, `crm_update_stage` e `crm_list_stages` no MCP, e os tipos das telas.

Vazio no campo = `null` = o padrão de hoje (24 h até virar crítico, 72 h para travar, 144 h no modo sensível), porque quem lê é o `resolveStageWindow` que já existia. A validação é inteiro de 1 a 8760 horas (uma hora a um ano) e mora na rota, em Zod, ao lado de `validarNomeDeEtapa` — **sem migration**: a coluna `crm_stages.expected_duration_hours` já existia no banco e continua sem `CHECK`.

Não entra aqui o relógio que conta o tempo sem mexer nem a gravação automática de `last_activity_at`; isso é a segunda parte da issue #1532 e não mexe nesta.

Contribuição de @webtecnica (#2161), fechando a #1532.
