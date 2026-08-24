/**
 * Markdown → HTML, no dependency.
 *
 * The portal has ONE npm dependency (`@neondatabase/serverless`) and the idea is
 * for it to stay that way. A 150-line markdown renderer that covers exactly what
 * our documents use is cheaper to audit than a package tree — and in a project
 * whose product is credibility, cheap auditing matters.
 *
 * Covers: heading, paragraph, bold, italic, inline code, code block, ordered and
 * unordered list, blockquote, horizontal rule, link, and GFM table.
 * Does not cover: embedded HTML — which is exactly what we do NOT want to accept.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Placeholder marker for inline code. Unicode private-use character: it doesn't
 *  show up in human text, so there's no way for content to forge a marker. */
const MARCA = "";

function escapar(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Fragments of a line. Inline code goes first, so nothing gets
 *  interpreted inside it. */
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

    // code block
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

    // horizontal rule
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) {
      saida.push("<hr />");
      i++;
      continue;
    }

    // heading
    const t = l.match(/^(#{1,6})\s+(.*)$/);
    if (t) {
      const n = t[1].length;
      const texto = t[2].trim();
      saida.push(`<h${n} id="${ancora(texto)}">${inline(texto)}</h${n}>`);
      i++;
      continue;
    }

    // GFM table
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

    // blockquote
    if (l.startsWith(">")) {
      const corpo: string[] = [];
      while (i < linhas.length && linhas[i].startsWith(">")) {
        corpo.push(linhas[i].replace(/^>\s?/, ""));
        i++;
      }
      saida.push(`<blockquote>${markdown(corpo.join("\n"))}</blockquote>`);
      continue;
    }

    // lists. The continuation matters: a list item that runs past 80 columns wraps
    // into two lines in the file, and without absorbing the second one, the end of
    // the sentence turns into a loose paragraph after the list. That's how "…sem ela
    // o corte de ruído vira decoração)." ended up alone below a list.
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

    // paragraph
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

/** Reads a document from `portal/conteudo/`, populated by `script/sincronizar-conteudo.mjs`. */
export function documento(nome: string): string {
  try {
    return readFileSync(join(process.cwd(), "conteudo", nome), "utf8");
  } catch {
    return `# Documento indisponível\n\nO arquivo \`${nome}\` não foi sincronizado neste build.`;
  }
}
