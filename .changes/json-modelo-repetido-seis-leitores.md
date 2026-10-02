---
impacto: nada_mudou
secao: corrigido
titulo: O agente deixa de perder a resposta quando o modelo repete o objeto JSON
---

Seis pontos do produto leem a resposta de um modelo de IA em texto e precisam achar o objeto JSON dentro dela: a sugestão de funil do passo de onboarding, a leitura das respostas do fluxo de atendimento, a classificação e o plano de espera do follow-up, e os dois guardrails de segurança (anti-jailbreak e promessa de venda). Todos recortavam o texto "do primeiro `{` ao último `}`" — e quando o modelo imprimia a resposta e depois a repetia inteira, o recorte abrangia as duas cópias, a leitura falhava e o ponto caía no seu caminho de fallback: a sugestão de funil mostrava um pacote pronto em vez do quadro montado para o negócio, e os guardrails degradavam sem conseguir analisar a mensagem. O sintoma aparece só em produção, com modelos que ecoam a resposta.

Agora os seis passam a ler o primeiro objeto JSON que conseguem parsear, tolerando prosa em volta, cerca de código e essa repetição. O que NÃO mudou é o comportamento quando não há JSON nenhum: cada ponto continua caindo exatamente no mesmo caminho de fallback de antes — inclusive os dois guardrails, que continuam deixando passar (fail-open) e continuam avisando no log quando a saída do modelo é ilegível. Nenhuma regra de bloqueio mudou e nada precisa ser feito na instalação.

Contribuição de @webtecnica (#2144).
