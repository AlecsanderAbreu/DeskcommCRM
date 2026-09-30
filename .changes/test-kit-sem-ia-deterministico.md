---
impacto: nada_mudou
secao: corrigido
titulo: O teste do kit "instalar sem chave de IA" não depende mais do ambiente para decidir o aviso da tela final (intermitência da #1570)
---

O caso `instalar SEM chave de IA — a tela final avisa` (`hostgator-setup-kit/test-validators.sh`,
integração da #670) reprovou o `verify-parte (3)` com intermitência, no run 35948236372, com
`✗ a tela final não avisa que a IA ainda não atende` — numa suíte que já rodava hermetizada para
quem tem chave no terminal (PR #1599). A causa-raiz não era o ambiente de quem roda mas uma JANELA
de não-determinismo no próprio latch do aviso: `pendencia_da_ia` (`install.sh`) decide a pendência de IA
da tela final lendo `ANTHROPIC_API_KEY` / `AI_GATEWAY_API_KEY` **do ambiente do processo** — e o caso
zerava as chaves só por herança global da suíte, sem garantir no ENV da invocação do `install.sh`.

Medido, de forma determinística: com a chave hostil no ambiente do install, o mesmo caso reproduz o
sintoma exato do CI — instalação chega a `Instalação concluída` mas o aviso de IA some da tela.

A correção fecha a janela na raiz, sem encobrir:
- `rodar_sem_ia` agora zera as quatro chaves de IA **no `env` da invocação** (o mesmo padrão que a linha
  `SUPABASE_ACCESS_TOKEN=` já usa por chamada), de modo que o `install.sh` nasce sem chave
  independentemente do ambiente da suíte; e
- a asserção do aviso procura na **saída inteira** (em vez de derivar o "rabo" depois da última
  "Instalação concluída"), ficando imune a ordem de flush, e imprime as últimas linhas se reprovar —
  para o próximo diagnóstico nascer de dado, não de chute.

Verificado com o caso isolado em ambiente hostil (repro N vezes verdes), com o fluxo do #1599 e com a
suíte fechando em laço.

Refs #1570.
Contribuição de @webtecnica (#<PR>).