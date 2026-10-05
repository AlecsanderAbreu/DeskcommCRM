---
impacto: nada_mudou
secao: corrigido
titulo: Regras de WhatsApp por aniversário e por compromisso voltam a enviar
---

As regras de automação com gatilho "No aniversário de um contato" ou "Agendamento criado/confirmado/remarcado/cancelado/compareceu/não compareceu" e ação de mandar WhatsApp (ou de acionar a IA, ou de iniciar um fluxo) nunca enviavam: o evento nasceria sem a origem do atendimento e a ação terminava `failed` com `service_boundary_stale`, sem erro em lugar nenhum. O carimbo no instante da emissão e a resolução na leitura passam a ler a mesma tabela de `(tipo, entidade) → contato`. Nenhuma ação é necessária: a regra passa a entregar no próximo evento.
