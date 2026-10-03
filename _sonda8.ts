import { computeDueAt, diasDeAtraso, prazoEmBr } from "@/lib/lgpd/sla";

const SP = "America/Sao_Paulo";
const em = (d: Date) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: SP, dateStyle: "short", timeStyle: "short" }).format(d);
const DIA = 86_400_000;

const prazo = computeDueAt(new Date("2026-09-14T12:00:00.000Z"), 15); // 2026-10-05T00:00:00Z
const prazoIso = prazo.toISOString();

console.log("=== A) O ALERTA \"vencida\": predicado antigo vs novo, hora a hora ===");
const antigoVencida = (agora: Date) => prazo.getTime() < agora.getTime();
const novoVencida = (agora: Date) => diasDeAtraso(prazoIso, agora) > 0;
let horasDeDefeito = 0;
let primeiro: Date | null = null;
let ultimo: Date | null = null;
for (let h = -72; h <= 72; h += 1) {
  const agora = new Date(prazo.getTime() + h * 3_600_000);
  const a = antigoVencida(agora);
  const b = novoVencida(agora);
  if (a && !b) {
    horasDeDefeito++;
    if (!primeiro) primeiro = agora;
    ultimo = agora;
  }
}
console.log(`  horas dizendo "vencida" a mais: ${horasDeDefeito}`);
console.log(`  de ${em(primeiro!)} a ${em(ultimo!)}`);
console.log(`  amostra 04/10 22:00 SP -> antigo=${antigoVencida(new Date("2026-10-05T01:00:00.000Z"))} novo=${novoVencida(new Date("2026-10-05T01:00:00.000Z"))}`);
console.log("");

console.log("=== B) O CORTE DE 5 DIAS: para cada dia de prazo, entra no KPI? ===");
const agora = new Date("2026-10-03T12:00:00.000Z"); // 03/10 09:00 em São Paulo
console.log(`  agora = ${em(agora)}`);
console.log("  dia do prazo | due_at            | antigo (now+5d) | novo (now+4d) | fim do dia do prazo");
for (let offset = 0; offset <= 7; offset += 1) {
  const dia = computeDueAt(new Date("2026-10-03T12:00:00.000Z"), offset);
  const iso = dia.toISOString();
  const antigo = new Date(iso).getTime() < agora.getTime() + 5 * DIA;
  const novo = new Date(iso).getTime() <= agora.getTime() + 4 * DIA;
  const fim = new Date(dia.getTime() + DIA);
  const horasAteOFim = (fim.getTime() - agora.getTime()) / 3_600_000;
  console.log(
    `  D+${offset}        | ${iso.slice(0, 16)}  | ${String(antigo).padEnd(15)} | ${String(novo).padEnd(13)} | ${em(fim)} (${horasAteOFim.toFixed(1)}h)`,
  );
}
console.log("");

console.log("=== C) A DATA NO TEXTO DO ALERTA: depende do TZ do processo? ===");
for (const tz of ["UTC", "America/Sao_Paulo"]) {
  const fmt = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric" });
  console.log(`  Intl com timeZone=${tz.padEnd(20)} -> ${fmt.format(prazo)}`);
}
console.log(`  prazoEmBr(due_at)                      -> ${prazoEmBr(prazoIso)}`);
console.log(`  (o container nao declara TZ no Dockerfile; a maquina de dev pode ter)`);