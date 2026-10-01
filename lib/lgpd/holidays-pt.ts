/**
 * Feriados nacionais de Portugal 2026-2030.
 * Usados pelo cálculo do prazo do RGPD para saltar dias não úteis.
 *
 * Conjunto de 2026-2030 (13 feriados): o decreto de 2022 cortou quatro
 * (Carnaval, Corpo de Deus, Todos os Santos, Restauração); o decreto de 2025
 * repô-los para este quinquénio. Aqui moram os dez fixos e os três móveis.
 *
 * Fixos são a mesma data todos os anos; móveis (Sexta-feira Santa, Carnaval,
 * Corpo de Deus) saem da data da Páscoa e ficam listados à mão para 2026-2030,
 * como faz `holidays-br.ts`.
 */

// Feriados fixos (padrão MM-DD repetido para cada ano 2026-2030)
const FIXED_HOLIDAYS: string[] = [];

const YEARS = [2026, 2027, 2028, 2029, 2030];
const FIXED_DATES = [
  "01-01", // Ano Novo
  "04-25", // Dia da Liberdade (25 de Abril)
  "05-01", // Dia do Trabalhador
  "06-10", // Dia de Portugal, de Camões e das Comunidades Portuguesas
  "08-15", // Assunção de Nossa Senhora
  "10-05", // Implantação da República
  "11-01", // Dia de Todos os Santos
  "12-01", // Restauração da Independência
  "12-08", // Imaculada Conceição
  "12-25", // Natal
];

for (const year of YEARS) {
  for (const md of FIXED_DATES) {
    FIXED_HOLIDAYS.push(`${year}-${md}`);
  }
}

// Feriados móveis 2026-2030 (Páscoa: 05-04/27-03/16-04/01-04/21-04)
const MOVEABLE_HOLIDAYS: string[] = [
  // 2026
  "2026-02-17", // Terça-feira de Carnaval
  "2026-04-03", // Sexta-feira Santa
  "2026-06-04", // Corpo de Deus
  // 2027
  "2027-02-09", // Terça-feira de Carnaval
  "2027-03-26", // Sexta-feira Santa
  "2027-05-27", // Corpo de Deus
  // 2028
  "2028-02-29", // Terça-feira de Carnaval
  "2028-04-14", // Sexta-feira Santa
  "2028-06-15", // Corpo de Deus
  // 2029
  "2029-02-13", // Terça-feira de Carnaval
  "2029-03-30", // Sexta-feira Santa
  "2029-05-31", // Corpo de Deus
  // 2030
  "2030-03-05", // Terça-feira de Carnaval
  "2030-04-19", // Sexta-feira Santa
  "2030-06-20", // Corpo de Deus
];

export const HOLIDAYS_PT_ISO: string[] = [...FIXED_HOLIDAYS, ...MOVEABLE_HOLIDAYS];

const _holidaySet = new Set(HOLIDAYS_PT_ISO);

/**
 * Returns true if the given date falls on a Portuguese national holiday.
 * Comparison is done in the Europe/Lisbon timezone.
 */
export function isHolidayPT(date: Date): boolean {
  // Format: YYYY-MM-DD in Lisbon timezone
  const isoDate = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return _holidaySet.has(isoDate);
}