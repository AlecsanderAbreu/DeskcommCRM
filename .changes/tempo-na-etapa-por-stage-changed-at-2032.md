---
impacto: capacidade_nova
secao: adicionado
titulo: Tempo na etapa nos relatórios medido por stage_changed_at (#2032)
---

A camada de cálculo dos relatórios de tempo/quantidade por etapa passa a medir pela ENTRADA do negócio na etapa atual — `crm_leads.stage_changed_at`, carimbada pelo trigger `trg_stamp_stage_changed_at` desde a migration 0071 —, com `created_at` de reserva para o lead sem carimbo (dado legado). `last_activity_at` não entra na conta: é tempo sem resposta, e uma nota na conversa zerava o relógio de um negócio parado há semanas.

O módulo `lib/relatorios/tempo-da-etapa.ts` é puro (relógio injetado, sem banco) e devolve por etapa a quantidade, a média e a mediana de horas, além da amostra `comCarimbo`/`semCarimbo` — o número medido sobre reserva não é o mesmo medido sobre carimbo, e esconder a diferença seria metade do defeito. Sete testes cobrem os três casos da issue, inclusive o de `last_activity_at` mais recente ser ignorado.

Sem rota e sem tela: esta entrega é a camada clean/instrumental que destrava as propostas de análise do funil (#1750) e de taxa histórica por etapa (#1753).

Contribuição de @webtecnica (#2032).
