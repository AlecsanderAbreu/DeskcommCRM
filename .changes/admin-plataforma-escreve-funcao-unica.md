---
impacto: nada_mudou
secao: corrigido
titulo: A regra "admin de plataforma pode escrever nesta empresa?" agora é UMA função
---

A pergunta "este administrador de plataforma pode escrever nesta empresa?"
voltava a ser reescrita à mão em cada server action — ~15 checagens em ~14
arquivos, com três grafias diferentes, que nem sempre consideravam a sessão de
suporte. Sem um lugar único, a próxima action escolheria uma das três e a regra
continuaria divergindo das rotas `/api/v1`.

Agora a resposta mora em um só lugar: `podeAdministrarEmpresa` em `lib/auth`,
com a mesmíssima regra das rotas (`requireRole(..., { allowPlatformAdmin })`):
o super-admin de plataforma fora da sessão de suporte passa; senão o papel
efetivo na organização ativa tem de ser `admin`. Todas as server actions que
faziam a checagem à mão passam a chamá-la, com o mesmo resultado de autorização
para os mesmos inputs — e há um teste que pina a regra e exige o uso da função.

Refs #1852.

Contribuição de @webtecnica (#2027).