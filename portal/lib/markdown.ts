/**
 * Markdown → HTML, sem dependência.
 *
 * O portal tem UMA dependência npm (`@neondatabase/serverless`) e a ideia é que
 * continue assim. Um renderizador de markdown de 150 linhas que cobre exatamente o
 * que os nossos documentos usam é mais barato de auditar que uma árvore de pacotes —
 * e num projeto cujo produto é credibilidade, auditar barato importa.
 *
 * Cobre: título, parágrafo, negrito, itálico, código inline, bloco de código, lista
 * ordenada e não ordenada, citação, régua, link e tabela GFM.
 * Não cobre: HTML embutido — que é justamente o que a gente NÃO quer aceitar.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Marca de posição para o código inline. Caractere de uso privado do Unicode: não
 *  aparece em texto de gente, então não há como o conteúdo forjar uma marca. */
const MARCA = "";

function escapar(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Trechos de uma linha. Código inline sai primeiro, para que nada seja
 *  interpretado dentro dele. */
function inline(s: string): string {
  const codigos: string[] = [];
  let t = s.replace(/`([^`]+)`/g, (_m, c: string) => {
    codigos.push(escapar(c));
    return MARCA + (codigos.length - 1) + MARCA;
  });

  t = escapar(t);
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, texto: string, url: string) => {
    const externo = /^https?:\/\//.test(url) && !url.includes("batuta.space");
    const extra = externo ? ' target="_blank" rel="noopener noreferrer"' : "";
    return `<a href="${url}"${extra}>${texto}</a>`;
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  t = t.replace(
    new RegExp(MARCA + "(\\d+)" + MARCA, "g"),
    (_m, i: string) => `<code>${codigos[Number(i)]}</code>`,
  );
  return t;
}

function celulas(linha: string): string[] {
  return linha
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
}

function ancora(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function markdown(fonte: string): string {
  const linhas = fonte.replace(/\r\n/g, "\n").split("\n");
  const saida: string[] = [];
  let i = 0;

  while (i < linhas.length) {
    const l = linhas[i];

    // bloco de código
    if (l.startsWith("```")) {
      const lingua = l.slice(3).trim();
      const corpo: string[] = [];
      i++;
      while (i < linhas.length && !linhas[i].startsWith("```")) corpo.push(linhas[i++]);
      i++;
      const classe = lingua ? ` class="lang-${escapar(lingua)}"` : "";
      saida.push(`<pre${classe}><code>${escapar(corpo.join("\n"))}</code></pre>`);
      continue;
    }

    // régua
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) {
      saida.push("<hr />");
      i++;
      continue;
    }

    // título
    const t = l.match(/^(#{1,6})\s+(.*)$/);
    if (t) {
      const n = t[1].length;
      const texto = t[2].trim();
      saida.push(`<h${n} id="${ancora(texto)}">${inline(texto)}</h${n}>`);
      i++;
      continue;
    }

    // tabela GFM
    if (
      l.includes("|") &&
      i + 1 < linhas.length &&
      /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(linhas[i + 1])
    ) {
      const cab = celulas(l);
      i += 2;
      const corpo: string[][] = [];
      while (i < linhas.length && linhas[i].includes("|") && linhas[i].trim() !== "") {
        corpo.push(celulas(linhas[i]));
        i++;
      }
      saida.push(
        `<div class="rolagem"><table><thead><tr>${cab
          .map((c) => `<th>${inline(c)}</th>`)
          .join("")}</tr></thead><tbody>${corpo
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`,
      );
      continue;
    }

    // citação
    if (l.startsWith(">")) {
      const corpo: string[] = [];
      while (i < linhas.length && linhas[i].startsWith(">")) {
        corpo.push(linhas[i].replace(/^>\s?/, ""));
        i++;
      }
      saida.push(`<blockquote>${markdown(corpo.join("\n"))}</blockquote>`);
      continue;
    }

    // listas. A continuação importa: item de lista que passa de 80 colunas quebra em
    // duas linhas no arquivo, e sem absorver a segunda o fim da frase vira parágrafo
    // solto depois da lista. Foi assim que "…sem ela o corte de ruído vira
    // decoração)." apareceu sozinho embaixo de uma lista.
    const ITEM_UL = /^\s*[-*+]\s+/;
    const ITEM_OL = /^\s*\d+[.)]\s+/;

    if (ITEM_UL.test(l) || ITEM_OL.test(l)) {
      const ordenada = ITEM_OL.test(l) && !ITEM_UL.test(l);
      const marca = ordenada ? ITEM_OL : ITEM_UL;
      const itens: string[] = [];
      while (i < linhas.length && marca.test(linhas[i])) {
        let item = linhas[i].replace(marca, "");
        i++;
        while (
          i < linhas.length &&
          linhas[i].trim() !== "" &&
          !ITEM_UL.test(linhas[i]) &&
          !ITEM_OL.test(linhas[i]) &&
          !linhas[i].startsWith("#") &&
          !linhas[i].startsWith("```") &&
          !linhas[i].startsWith(">") &&
          !linhas[i].includes("|") &&
          !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(linhas[i])
        ) {
          item += " " + linhas[i].trim();
          i++;
        }
        itens.push(item);
      }
      const tag = ordenada ? "ol" : "ul";
      saida.push(`<${tag}>${itens.map((x) => `<li>${inline(x)}</li>`).join("")}</${tag}>`);
      continue;
    }

    // parágrafo
    if (l.trim() === "") {
      i++;
      continue;
    }
    const paragrafo: string[] = [];
    while (
      i < linhas.length &&
      linhas[i].trim() !== "" &&
      !linhas[i].startsWith("#") &&
      !linhas[i].startsWith("```") &&
      !linhas[i].startsWith(">") &&
      !/^\s*[-*+]\s+/.test(linhas[i]) &&
      !/^\s*\d+[.)]\s+/.test(linhas[i]) &&
      !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(linhas[i])
    ) {
      paragrafo.push(linhas[i]);
      i++;
    }
    if (paragrafo.length) saida.push(`<p>${inline(paragrafo.join(" "))}</p>`);
  }

  return saida.join("\n");
}

/** Lê um documento de `portal/conteudo/`, populado por `script/sincronizar-conteudo.mjs`. */
export function documento(nome: string): string {
  try {
    return readFileSync(join(process.cwd(), "conteudo", nome), "utf8");
  } catch {
    return `# Documento indisponível\n\nO arquivo \`${nome}\` não foi sincronizado neste build.`;
  }
}
