---
impacto: nada_mudou        # o operador não precisa fazer nada
secao: corrigido
titulo: O comentário da timeline do negócio não promete mais o valor anterior no log de auditoria
---
O comentário que acompanha as edições editadas de um negócio dizia que quem
precisa do valor anterior tem o `api_audit_log`. O log de auditoria de
`lead.updated` guarda só os nomes dos campos alterados, nunca o antes-e-depois —
o valor anterior não estava em lugar nenhum. O comentário agora afirma isso,
esclarecendo, por decisão de PII, que o histórico de valores não existe.
Crédito: @webtecnica.