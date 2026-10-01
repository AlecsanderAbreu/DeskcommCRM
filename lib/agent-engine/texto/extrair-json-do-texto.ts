/**
 * Extrai o PRIMEIRO valor JSON válido (objeto ou array) do texto do modelo.
 *
 * POR QUE EXISTE: os classificadores auxiliares do agente pedem JSON no
 * PROMT ("responda SOMENTE JSON: {...}") — não há `response_format` no seam
 * (`runModelCall`). Modelos roteados por OpenRouter produzem as mesmas saídas
 * com três formas que os parsers antigos (slice `indexOf('{')` →
 * `lastIndexOf('}')`) quebravam:
 *
 *   1. Cerca de código  — ```json\n{...}\n```  (prosa em volta);
 *   2. Repetição        — `{...} {a segunda cópia...}` (o modelo ecoa o JSON
 *                         mais de uma vez: o `lastIndexOf('}')` pegava o fim
 *                         da SEGUNDA cópia e o slice abrangia duas, invalidando
 *                         o parse — "JSON inválido em 7 de 11 checagens");
 *   3. Objeto completo no MEIO de prosa.
 *
 * Esta função NUNCA lança: a leitura de um auxiliar não pode derrubar o turno
 * (colapso de falha). Devolve `null` quando não encontra nada parseável.
 *
 * A varredura de blocos é ciente de STRINGS (o texto costuma carregar PII com
 * `{`, `}` e `"` dentro), e tenta cada bloco `{...}`/`[...]` de nível superior
 * até um parsear — primeiro valor (estável), não o último.
 */
const NADA = Symbol("nao-achou-json");

function tentarParsear(texto: string): unknown | typeof NADA {
  const t = texto.trim();
  if (t === "") return NADA;
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return NADA;
  }
}

interface ParDeChaves {
  abre: "{" | "[";
  fecha: "}" | "]";
}

const PAR_OBJETO: ParDeChaves = { abre: "{", fecha: "}" };
const PAR_ARRAY: ParDeChaves = { abre: "[", fecha: "]" };

/**
 * Blocos `{…}`/`[…]` de nível superior da string, cientes de strings com
 * escapes. Surrogate/token de identificação: não interpreta conteúdo — só
 * respeita `"..."` (com `\\`) para não deixar `}`/`]` dentro de texto derrubar
 * o balanceamento. Devolve os blocos na ordem em que aparecem.
 */
function blocosDeNivelSuperior(texto: string): string[] {
  const blocos: string[] = [];
  let i = 0;
  const n = texto.length;
  while (i < n) {
    const c = texto[i];
    const par: ParDeChaves | null =
      c === "{" ? PAR_OBJETO : c === "[" ? PAR_ARRAY : null;
    if (par === null) {
      i++;
      continue;
    }
    let aberto = 0;
    let emString = false;
    let escapado = false;
    let fechouFora = false;
    for (let j = i; j < n; j++) {
      const ch = texto[j];
      if (emString) {
        if (escapado) escapado = false;
        else if (ch === "\\") escapado = true;
        else if (ch === '"') emString = false;
        continue;
      }
      if (ch === '"') {
        emString = true;
        continue;
      }
      if (ch === par.abre) aberto++;
      else if (ch === par.fecha) {
        aberto--;
        if (aberto === 0) {
          blocos.push(texto.slice(i, j + 1));
          i = j + 1;
          fechouFora = true;
          break;
        }
      }
    }
    if (!fechouFora) i = n; // não fechou até o fim — nada mais a extrair
  }
  return blocos;
}

/** Retira cercas de código markdown (```json{...}```) e marcadores soltos. */
function semCercaDeCodigo(texto: string): string {
  return texto
    .replace(/```[a-zA-Z]*\s*([\s\S]*?)```/g, "$1")
    .replace(/```/g, "");
}

/**
 * Primeiro JSON válido do texto, ou `null`. Determinístico (primeiro bloco que
 * parsear), tolerante a cerca de código, prosa e repetição. Nunca lança.
 */
export function extrairJsonDoTexto(texto: string): unknown | null {
  const limpo = semCercaDeCodigo(texto);

  // Caminho feliz: o texto inteiro (após a cerca) É o JSON.
  const inteiro = tentarParsear(limpo);
  if (inteiro !== NADA) return inteiro;

  // Degradação: varre por blocos top-level e devolve o primeiro que parsear.
  for (const bloco of blocosDeNivelSuperior(limpo)) {
    const valor = tentarParsear(bloco);
    if (valor !== NADA) return valor;
  }
  return null;
}