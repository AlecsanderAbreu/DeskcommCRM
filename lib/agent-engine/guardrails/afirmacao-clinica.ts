/**
 * AFIRMAÇÃO CLÍNICA NA BOCA DO ASSISTENTE — o detector do `clinicalClaimGate`.
 *
 * ## O problema
 *
 * Em clínica, consultório e qualquer negócio de saúde, quatro frases não podem sair
 * do assistente, por mais que o prompt peça: dizer o que a pessoa TEM ("você tem uma
 * micose"), mandar TOMAR ou PASSAR algo ("tome 500 mg", "passe uma pomada de
 * corticoide"), GARANTIR resultado ("cura garantida") e dizer que uma lesão É câncer
 * ("isso é um melanoma"). Uma frase dessas, escrita, é ato médico praticado por quem
 * não é médico — e o prompt sozinho não segura: ele é uma instrução, e o modelo erra.
 *
 * Os outros portões da cadeia (`promise`, `internal_vocabulary`, `agenda_stall`) são a
 * mesma ideia aplicada a outro risco: uma regra fixa, sem custo de modelo, que barra a
 * frase e devolve ao modelo o que fazer no lugar.
 *
 * ## Por que é OPCIONAL por organização (camada `afirmacao_clinica`)
 *
 * Fora da saúde, as mesmas palavras são normais: "você tem 10% de desconto", "use o
 * cupom", "passe na loja", "garanto a entrega". O detector já é estreito (ver abaixo),
 * mas o produto é multi-nicho e a pergunta da doutrina de extensões vale: se nenhuma
 * organização ligar isto, a operação comum continua inteira. Por isso nasce DESLIGADO e
 * quem é de saúde liga em Segurança.
 *
 * ## O que ele NÃO pega, de propósito
 *
 * - Pergunta. "Você tem psoríase há quanto tempo?" repete o que o paciente contou; a
 *   frase terminada em `?` não é afirmação.
 * - Hipótese condicional. "Se for câncer de pele, o médico faz a cirurgia de Mohs" é
 *   informação de serviço, não diagnóstico. Marcadores de hipótese (`se for`, `caso
 *   seja`, `pode ser`, `suspeita de`) desarmam SÓ a regra oncológica e a de diagnóstico.
 * - "Você tem" sem doença. "Você tem preferência de horário?" e "você tem algum exame?"
 *   são a rotina da recepção. A regra exige um termo clínico logo depois.
 * - Verbo de tomar/usar sem remédio. "Tome nota", "use o estacionamento", "passe na
 *   recepção" passam: a regra exige um medicamento, uma forma farmacêutica ou uma dose.
 *
 * É REDE, não cura — como o `internal_vocabulary`. A cura é o prompt e o modelo; isto
 * pega o que escapa e transforma o escape em número no `before_send_traces`.
 */

/** As quatro categorias. Rótulos NOSSOS e fechados: vão ao trace, nunca o texto. */
export type CategoriaClinica =
  | 'diagnostico'
  | 'prescricao'
  | 'promessa_de_resultado'
  | 'afirmacao_oncologica';

export interface AchadoClinico {
  achou: boolean;
  categorias: CategoriaClinica[];
}

/**
 * Doenças e achados que, ditos como "você tem / está com", viram diagnóstico.
 * Lista curta e de dermatologia + clínica geral: é o vocabulário que aparece em
 * atendimento de WhatsApp, não um CID inteiro. Termo novo entra com um caso no teste.
 */
const DOENCAS =
  'micose|onicomicose|psor[ií]ase|dermatite|eczema|ros[aá]cea|melasma|vitiligo|' +
  'acne|foliculite|impetigo|herpes|zoster|sarna|escabiose|urtic[aá]ria|alergia|' +
  'infec[cç][aã]o|inflama[cç][aã]o|fungo|bact[eé]ria|v[ií]rus|verruga|cisto|lipoma|' +
  'queratose|ceratose|alopecia|calv[ií]cie|hidradenite|l[uú]pus|' +
  'c[aâ]ncer|melanoma|carcinoma|tumor|nevo at[ií]pico|les[aã]o maligna';

/** Tumores malignos: a afirmação mais grave, com regra própria. */
const ONCOLOGICO = 'c[aâ]ncer(?: de pele)?|melanoma|carcinoma|tumor maligno|cbc|cec';

/** Remédio ou forma farmacêutica — o objeto que transforma "use" em prescrição. */
const REMEDIOS =
  'rem[eé]dio|medicamento|medica[cç][aã]o|antibi[oó]tico|antif[uú]ngico|antial[eé]rgico|' +
  'anti-?inflamat[oó]rio|corticoide|cortic[oó]ide|pomada|creme|comprimido|c[aá]psula|' +
  'xarope|gotas|loç[aã]o|shampoo antif[uú]ngico|isotretino[ií]na|minoxidil|' +
  'ivermectina|cetoconazol|terbinafina|dexametasona|prednisona|amoxicilina';

/**
 * Limites de palavra que entendem acento. O `\b` do JavaScript só conhece `[A-Za-z0-9_]`,
 * mesmo com a flag `u`: entre um espaço e "é" ele não vê fronteira, e "seu diagnóstico
 * é…" nunca casava — os três primeiros vermelhos deste arquivo foram exatamente isso.
 */
const INICIO = String.raw`(?<![\p{L}\p{N}_])`;
const FIM = String.raw`(?![\p{L}\p{N}_])`;
const palavra = (alternativas: string): string => `${INICIO}(?:${alternativas})${FIM}`;

const HIPOTESE = new RegExp(
  palavra(
    String.raw`se\s+for|se\s+[eé]|caso\s+seja|caso\s+for|pode\s+ser|poderia\s+ser|talvez\s+seja|` +
      String.raw`suspeita\s+de|em\s+caso\s+de|se\s+(?:a\s+les[aã]o\s+)?(?:for|tiver)`,
  ),
  'iu',
);

const ARTIGO = String.raw`(?:(?:um|uma|uns|umas)\s+)?`;

const VERBOS_DE_USO = String.raw`tome|tomar|pode\s+tomar|use|usar|pode\s+usar|aplique|aplicar|passe|passar|pode\s+passar`;
const NAO_NEGADO = String.raw`(?<!(?:n[aã]o|nem|evite)\s+)`;

const REGRAS: ReadonlyArray<{ categoria: CategoriaClinica; padrao: RegExp; hipoteseDesarma: boolean }> = [
  {
    categoria: 'diagnostico',
    padrao: new RegExp(
      [
        // "Se você tem alergia a…, avise" é pergunta condicional da recepção, não diagnóstico.
        // O lookbehind fica no SUJEITO, não em HIPOTESE: em HIPOTESE, um "se você tiver
        // dúvida" desarmaria a frase inteira e soltaria "Você tem uma micose, se você
        // tiver dúvida me chame." (casos de controle no teste).
        String.raw`(?<!${INICIO}se\s+)${palavra(String.raw`voc[eê]|vc`)}\s+` +
          String.raw`(?:tem|t[aá]\s+com|est[aá]\s+com|possui|deve\s+ter|provavelmente\s+tem|certamente\s+tem)\s+` +
          `${ARTIGO}${palavra(DOENCAS)}`,
        String.raw`${palavra(String.raw`seu\s+diagn[oó]stico\s+(?:[eé]|seria)`)}`,
        String.raw`${palavra(String.raw`isso|essa\s+(?:mancha|pinta|les[aã]o|ferida)`)}\s+[eé]\s+` +
          `${ARTIGO}${palavra(DOENCAS)}`,
      ].join('|'),
      'iu',
    ),
    hipoteseDesarma: true,
  },
  {
    categoria: 'prescricao',
    padrao: new RegExp(
      [
        // Instrução negada ("não passe creme no dia do laser") é preparo de procedimento.
        String.raw`${NAO_NEGADO}${palavra(VERBOS_DE_USO)}\s+` +
          String.raw`(?:(?:o|a|um|uma|esse|essa|este|esta)\s+)?${palavra(REMEDIOS)}`,
        palavra(String.raw`receito|prescrevo|vou\s+(?:te\s+)?receitar|vou\s+(?:te\s+)?prescrever`),
        // Dose isolada só em mg/mcg: "frasco de 200 ml" e "3 g de amostra" são produto.
        String.raw`${INICIO}\d+(?:[.,]\d+)?\s?(?:mg|mcg)${FIM}`,
        // Dose líquida só com o verbo: "tome 5 ml do xarope".
        String.raw`${NAO_NEGADO}${palavra(VERBOS_DE_USO)}\s+\d+(?:[.,]\d+)?\s?(?:ml|gotas)${FIM}`,
      ].join('|'),
      'iu',
    ),
    hipoteseDesarma: false,
  },
  {
    categoria: 'promessa_de_resultado',
    padrao: new RegExp(
      palavra(
        String.raw`cura\s+garantida|resultado\s+garantido|garantia\s+de\s+(?:resultado|cura)|sucesso\s+garantido|` +
          String.raw`100\s*%\s+de\s+(?:cura|sucesso|efic[aá]cia|melhora)|` +
          String.raw`garanto\s+(?:o\s+resultado|a\s+cura|que\s+(?:vai|ir[aá])\s+(?:curar|sarar|sumir|melhorar|resolver))|` +
          String.raw`(?:vai|ir[aá])\s+(?:curar|sumir)\s+com\s+certeza`,
      ),
      'iu',
    ),
    hipoteseDesarma: false,
  },
  {
    categoria: 'afirmacao_oncologica',
    padrao: new RegExp(
      String.raw`${palavra(String.raw`[eé]|seja|parece(?:\s+ser)?|trata-se\s+de|se\s+trata\s+de|tem\s+cara\s+de`)}\s+` +
        `${ARTIGO}${palavra(ONCOLOGICO)}`,
      'iu',
    ),
    hipoteseDesarma: true,
  },
];

/** Quebra em frases para que a `?` e a hipótese valham só para a frase em que estão. */
function frases(texto: string): string[] {
  return texto
    .split(/(?<=[.!?\n])\s+/u)
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
}

export function detectarAfirmacaoClinica(texto: string): AchadoClinico {
  const achadas = new Set<CategoriaClinica>();
  for (const frase of frases(texto)) {
    // Pergunta não é afirmação: "você tem psoríase há quanto tempo?" só repete o paciente.
    const pergunta = frase.endsWith('?');
    const hipotese = HIPOTESE.test(frase);
    for (const regra of REGRAS) {
      if (!regra.padrao.test(frase)) continue;
      if (regra.hipoteseDesarma && (pergunta || hipotese)) continue;
      // Prescrição e promessa valem mesmo em pergunta ("posso te receitar…?" é oferta).
      achadas.add(regra.categoria);
    }
  }
  const categorias = [...achadas];
  return { achou: categorias.length > 0, categorias };
}

const O_QUE_FAZER: Record<CategoriaClinica, string> = {
  diagnostico: 'não diga o que a pessoa tem — só o médico, em consulta, define',
  prescricao: 'não indique remédio, pomada nem dose',
  promessa_de_resultado: 'não garanta resultado nem cura',
  afirmacao_oncologica: 'não diga que uma lesão é câncer',
};

/**
 * O erro de ensino que volta ao modelo. Diz O QUE foi barrado e O QUE escrever no
 * lugar — veto que só diz "não" faz o modelo tentar a mesma frase com outra palavra.
 */
export function renderVetoDeAfirmacaoClinica(categorias: readonly CategoriaClinica[]): string {
  const regras = categorias.map((c) => O_QUE_FAZER[c]).join('; ');
  return (
    `A mensagem não foi enviada: ela faz uma afirmação clínica (${regras}). ` +
    'Reescreva sem diagnóstico, sem indicação de tratamento e sem promessa de resultado: ' +
    'diga que quem avalia é o médico, em consulta, e ofereça o agendamento. ' +
    'Se houver sinal de urgência, abra um caso para a equipe.'
  );
}
