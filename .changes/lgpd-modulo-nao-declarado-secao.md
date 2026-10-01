---
impacto: capacidade_nova
secao: adicionado
titulo: Módulo que cria tabela com dado pessoal passa a ser checado para declarar a seção de LGPD
---
A atualização agora verifica, num banco descartável, se todo módulo instalado que cria tabela com dado pessoal ligada a `contacts` declarou a seção de LGPD. Quem não declara reprova antes de sair — sem isso, a anonimização devolvia sucesso com a linha legível e ninguém era avisado.

Contribuição de @webtecnica (#2083).