---
impacto: nada_mudou
secao: corrigido
titulo: Comanda nasce na moeda da organização, não mais em real fixo
---
A comanda aberta pelo balcão e a gerada pelo faturamento em lote gravavam em `sales` sem `currency`, e a coluna cai no `default 'BRL'` — numa empresa em euro a comanda nascia em R$, aparecia com o símbolo errado ao lado do € que a própria lista de pendentes mostrava, e a venda entrava no bloco BRL do relatório de faturamento. Agora as duas rotas gravam a moeda que a organização declarou (`organizations.currency`), lida pela mesma função que o cadastro de produto e a proposta já usam; a organização continua vinda da sessão, nunca do corpo, e o corpo nem declara o campo. Numa empresa em real nada muda: o valor gravado é o mesmo de antes. Ver #2160. Crédito: @webtecnica no #2173.
