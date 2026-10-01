---
impacto: nada_mudou
secao: corrigido
titulo: "OpenRouter: leitura de JSON de auxiliares do agente tolera cerca de codigo, prosa e repeticao"
---

O seam de modelo nao envia `response_format`: os auxiliares do agente pedem JSON no prompt e parseiam o texto de volta. Modelos roteados por OpenRouter produzem a mesma saida com cerca de codigo (```json), objeto no meio de prosa ou — principalmente — repetindo o JSON. O parser antigo (`indexOf('{')` ate `lastIndexOf('}')`) pegava do primeiro `{` ao ultimo `}` e, na duplicacao, apanhava objetos demais, anulando o parse (sintoma relatado: "JSON invalido em 7 de 11 checagens" e "texto repetido").

Novo `extrairJsonDoTexto` (lib/agent-engine/texto/): retira a cerca, tenta o texto inteiro e, senao, devolve o primeiro bloco JSON top-level que parsear (varredura ciente de strings, com PII com `{`/`}`/`"`). Nunca lanca — um auxiliar nao derruba o turno. Os quatro pontos que leem JSON de modelo (checkpoint, compactacao, roteador de intencao e o flywheel de propostas) passam a rotear por ele, protegidos por teste do gate do dono (cerca anti-regressao).

Contribuicao de @webtecnica (PR #0000).