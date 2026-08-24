/**
 * POST /api/arena — qualquer pessoa envia uma tarefa para a bateria.
 *
 * A tarefa entra com status 'triagem' e enunciado_canonico NULL, e é assim que ela
 * tem que entrar: TAREFA ENVIADA NUNCA RODA COMO CHEGOU (§10). Antes de rodar, ela
 * é reescrita em formato canônico — enunciado + critério de aceite + categoria +
 * complexidade — por quem mantém a bateria. Quem envia sugere o problema; a régua é
 * do Batuta. Sem essa porta, autor de skill manda exatamente a tarefa que a skill
 * dele vence, e o ranking vira vitrine paga em prestígio.
 *
 * O voto que vem depois ordena a FILA de teste. Nunca o resultado (§1.6).
 */
import { sql, temBanco } from "../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMITE_ENUNCIADO = 4000;
const LIMITE_BYTES = 64 * 1024;

const CATEGORIAS = ["codigo", "escrita", "dados", "documentos", "pesquisa", "automacao"];

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET() {
  return json({ ok: false, erro: "este endereço só aceita POST", campos: ["enunciado", "categoria", "contato (opcional)"] }, 405);
}

// ================================================================== triagem 0

/**
 * Triagem automática — a camada burra, antes da humana.
 *
 * Ela não decide se a tarefa é boa; decide se a tarefa é PERIGOSA de ficar guardada.
 * Bloco de código executável e URL de download são recusados na porta porque a
 * bateria roda em máquina de gente e um enunciado é texto, não payload: "escreva um
 * script que baixe e execute isto" não é tarefa de teste, é entrega de carga. Quem
 * quiser propor uma tarefa sobre shell script descreve o comportamento esperado em
 * palavras — que é, aliás, o que o critério de aceite vai exigir de qualquer jeito.
 */
const PADROES: Array<[RegExp, string]> = [
  [/```[ \t]*(bash|sh|zsh|shell|console|powershell|ps1|bat|cmd|python|py|ruby|rb|perl|php|node|js|javascript|ts)\b/i,
   "bloco de código executável (cerca ``` com linguagem de execução)"],
  [/^\s*#!\s*\/\w/m, "shebang (#!/...)"],
  [/\b(curl|wget)\b[^\n]*\|\s*(sudo\s+)?(ba)?sh\b/i, "curl|sh — instalação por cano"],
  [/\b(rm\s+-rf|mkfs|dd\s+if=|chmod\s+\+x|:\(\)\{.*\};:)/i, "comando destrutivo"],
  [/\b(eval|exec)\s*\(/i, "chamada de execução dinâmica"],
  [/https?:\/\/\S+\.(sh|bash|zsh|exe|msi|dmg|pkg|deb|rpm|apk|jar|bin|run|ps1|bat|zip|tar|gz|tgz|7z|rar|iso|whl|pyc)(\?\S*)?(\s|$)/i,
   "URL de download de arquivo"],
  [/\b(data|javascript|file|vbscript):[^\s]{16,}/i, "URI embutida com carga"],
  [/<script\b/i, "tag <script>"],
];

function motivoDeRecusa(t: string): string | null {
  for (const [re, motivo] of PADROES) if (re.test(t)) return motivo;
  return null;
}

// ======================================================================== POST

export async function POST(req: Request) {
  if (!temBanco()) {
    return json({ ok: false, erro: "arena indisponível: o portal está sem DATABASE_URL configurada", acao: "tente de novo mais tarde" }, 503);
  }

  const declarado = Number(req.headers.get("content-length") ?? "0");
  if (declarado > LIMITE_BYTES) {
    return json({ ok: false, erro: "corpo grande demais" }, 413);
  }

  let cru: string;
  try {
    cru = await req.text();
  } catch {
    return json({ ok: false, erro: "não deu para ler o corpo da requisição" }, 400);
  }
  if (new TextEncoder().encode(cru).length > LIMITE_BYTES) {
    return json({ ok: false, erro: "corpo grande demais" }, 413);
  }

  let corpo: any;
  try {
    corpo = JSON.parse(cru);
  } catch (err) {
    return json({ ok: false, erro: `JSON inválido: ${(err as Error).message}` }, 400);
  }
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
    return json({ ok: false, erro: "o corpo tem que ser um objeto JSON {enunciado, categoria, contato?}" }, 400);
  }

  const enunciado = typeof corpo.enunciado === "string" ? corpo.enunciado.trim() : "";
  const categoria = typeof corpo.categoria === "string" ? corpo.categoria.trim().toLowerCase() : "";
  const contato = typeof corpo.contato === "string" ? corpo.contato.trim() : "";

  const problemas: string[] = [];
  if (enunciado.length < 20) {
    problemas.push("enunciado tem que ter pelo menos 20 caracteres — descreva a tarefa, não o título dela");
  }
  // 4000 caracteres é folgado para descrever uma tarefa e apertado para colar um
  // arquivo inteiro. Quem precisa de mais está mandando anexo, não enunciado.
  if (enunciado.length > LIMITE_ENUNCIADO) {
    problemas.push(`enunciado tem ${enunciado.length} caracteres; o limite é ${LIMITE_ENUNCIADO}. Descreva o que precisa acontecer e como se sabe que deu certo — o resto a canonização escreve.`);
  }
  if (!CATEGORIAS.includes(categoria)) {
    problemas.push(`categoria tem que ser uma de: ${CATEGORIAS.join(", ")}`);
  }
  if (contato.length > 200) problemas.push("contato passou de 200 caracteres");
  if (problemas.length) return json({ ok: false, erro: "envio recusado", problemas }, 400);

  const motivo = motivoDeRecusa(enunciado) ?? (contato ? motivoDeRecusa(contato) : null);
  if (motivo) {
    return json(
      {
        ok: false,
        erro: `envio recusado: ${motivo}`,
        motivo:
          "a arena recebe enunciado em texto, não código para executar. Tarefa é a descrição do que precisa acontecer e de como se sabe que deu certo; o código é o que o modelo vai escrever no teste.",
        conserto: "descreva o comportamento esperado em palavras e mande de novo",
      },
      422,
    );
  }

  try {
    const r = await sql<{ id: number }>`
      insert into batuta.tarefas (enunciado_original, enunciado_canonico, categoria, status, origem, contato)
      values (${enunciado}, null, ${categoria}, 'triagem', 'publico', ${contato || null})
      returning id
    `;
    const id = r[0]?.id ?? null;

    return json(
      {
        ok: true,
        id,
        status: "triagem",
        o_que_acontece_agora: [
          "1. triagem: conferimos duplicata, segurança e escopo",
          "2. canonização: a tarefa é REESCRITA em formato fixo — enunciado + critério de aceite + categoria + complexidade. Ela não roda como chegou, nunca.",
          "3. voto: o voto do público ordena a fila de teste — e só a fila. Voto não decide resultado.",
          "4. rodada: braço sem skill x braço com skill, ordem sorteada, sessão limpa, julgamento cego",
          "5. publicação: o cru sai junto (enunciado, saídas e veredito) e entra na corrente de hash",
        ],
        a_regua_e_nossa:
          "você sugeriu o problema; o critério de aceite quem escreve somos nós. É essa porta que impede que quem escreve uma skill mande a tarefa que a skill dele vence.",
        contato: contato
          ? "guardamos seu contato só para avisar quando esta tarefa rodar. Não vira lista, não vira newsletter."
          : "sem contato: acompanhe pela página da arena",
      },
      201,
    );
  } catch (err) {
    console.error("[batuta] arena falhou:", err);
    return json({ ok: false, erro: "falha ao gravar", acao: "tente de novo mais tarde" }, 500);
  }
}
