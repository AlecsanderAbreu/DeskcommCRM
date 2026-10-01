---
impacto: nova_feature
secao: adicionado
titulo: Extensão declarativa pode contribuir um tema (gancho)
---
Uma extensão declarativa v1 pode contribuir um TEMA de tokens de cor
(`contributions.theme`) que a organização escolhe na configuração da extensão —
sem quebrar a tela de quem não escolheu. A contribuição passa pela mesma régua
de forma de valor do branding (hex/rgb()/rgba()/var(--nome)) com allowlist de
chave, exige a permissão `theme.apply`, e o banco passa a guardar a paleta
escolhida (`sage`/`clay`/`mist`/`plum`/`olive`) em
`organization_extensions.configuration.theme`. Quem não escolheu tema não muda de
visual: o bloco de CSS só existe quando a organização escolheu o tema de uma
extensão ativa. A condição é protegida por teste (`extensao-tema-nao-vaza-para-
quem-nao-escolheu.test.ts`).

Contribuição de @webtecnica (PR #0000).