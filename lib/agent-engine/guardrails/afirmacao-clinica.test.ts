/**
 * O detector de afirmação clínica — os dois sentidos.
 *
 * Os casos de BARRA são as frases que a operação de uma clínica de dermatologia já
 * viu o modelo tentar. Os de PASSA são a rotina da recepção e as frases normais de
 * outros nichos que usam as mesmas palavras ("você tem", "use", "garanto") — é onde
 * um detector ingênuo vira ruído e a organização desliga a proteção.
 */
import { describe, expect, it } from 'vitest';

import { detectarAfirmacaoClinica, renderVetoDeAfirmacaoClinica } from './afirmacao-clinica';

const barra: Array<[string, string]> = [
  ['diagnostico', 'Pelo que você descreveu, você tem uma micose de unha.'],
  ['diagnostico', 'Vc está com dermatite, é bem comum.'],
  ['diagnostico', 'Seu diagnóstico é psoríase leve.'],
  ['diagnostico', 'Essa mancha é um melasma.'],
  ['prescricao', 'Pode passar uma pomada de corticoide duas vezes ao dia.'],
  ['prescricao', 'Tome o antibiótico até a consulta.'],
  ['prescricao', 'O ideal é 500 mg por dia.'],
  ['prescricao', 'Vou te receitar um creme.'],
  ['promessa_de_resultado', 'O tratamento tem cura garantida.'],
  ['promessa_de_resultado', 'Garanto que vai sumir em duas semanas.'],
  ['promessa_de_resultado', 'É 100% de eficácia.'],
  ['afirmacao_oncologica', 'Pela foto, parece ser um melanoma.'],
  ['afirmacao_oncologica', 'Fique tranquila, não é câncer.'],
  ['afirmacao_oncologica', 'Isso tem cara de carcinoma.'],
];

const passa: string[] = [
  // rotina da recepção
  'Você tem preferência de dia ou horário?',
  'Você tem algum exame recente?',
  'Você tem psoríase há quanto tempo?',
  'Para definir a conduta, precisa de uma consulta com o dermatologista.',
  'A biópsia é o exame que confirma se é câncer.',
  'Se for câncer de pele, o Dr. Diego faz a cirurgia de Mohs.',
  'Caso seja melanoma, a equipe prioriza o seu atendimento.',
  'A consulta custa R$ 450.',
  'Tome nota do endereço: Rua Santa Clara, 50.',
  'Pode usar o estacionamento do prédio.',
  'Passe na recepção 15 minutos antes.',
  'Obrigada por mandar a foto. Ela ajuda na triagem, mas o diagnóstico é feito em consulta.',
  // outros nichos com as mesmas palavras
  'Você tem 10% de desconto na primeira compra.',
  'Use o cupom BEMVINDO no carrinho.',
  'Garanto a entrega até sexta.',
];

describe('detectarAfirmacaoClinica', () => {
  it.each(barra)('barra %s: %s', (categoria, frase) => {
    const achado = detectarAfirmacaoClinica(frase);
    expect(achado.achou).toBe(true);
    expect(achado.categorias).toContain(categoria);
  });

  it.each(passa)('deixa passar: %s', (frase) => {
    expect(detectarAfirmacaoClinica(frase)).toEqual({ achou: false, categorias: [] });
  });

  it('a hipótese vale só para a frase em que está', () => {
    // A primeira frase é hipótese; a segunda afirma. A segunda tem de barrar.
    const achado = detectarAfirmacaoClinica('Se for câncer, a equipe prioriza. Mas pela foto é um melanoma.');
    expect(achado.categorias).toEqual(['afirmacao_oncologica']);
  });

  it('junta categorias diferentes na mesma mensagem, sem repetir', () => {
    const achado = detectarAfirmacaoClinica('Você tem micose. Passe o antifúngico. Passe a pomada também.');
    expect(achado.categorias.sort()).toEqual(['diagnostico', 'prescricao']);
  });
});

describe('renderVetoDeAfirmacaoClinica', () => {
  it('diz o que foi barrado e o que escrever no lugar', () => {
    const texto = renderVetoDeAfirmacaoClinica(['diagnostico', 'prescricao']);
    expect(texto).toContain('não diga o que a pessoa tem');
    expect(texto).toContain('não indique remédio');
    expect(texto).toContain('ofereça o agendamento');
  });
});
