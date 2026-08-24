"use client";

import { useState } from "react";

/** The form talks to /api/arena. It doesn't promise the task will run as
 *  submitted — because it won't: every submitted task is rewritten into canonical
 *  format before entering the queue. Whoever submits suggests the problem; the
 *  ruler belongs to Batuta. */
export function FormularioArena() {
  const [estado, setEstado] = useState<"parado" | "enviando" | "ok" | "erro">("parado");
  const [recado, setRecado] = useState("");

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const dados = new FormData(e.currentTarget);
    setEstado("enviando");
    setRecado("");
    try {
      const r = await fetch("/api/arena", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enunciado: dados.get("enunciado"),
          categoria: dados.get("categoria"),
          contato: dados.get("contato") || null,
        }),
      });
      const corpo = await r.json().catch(() => ({}));
      if (r.ok) {
        setEstado("ok");
        setRecado(
          corpo.mensagem ??
            "Recebido. A tarefa entra na triagem e vai ser reescrita em formato canônico antes de rodar.",
        );
        (e.target as HTMLFormElement).reset();
      } else {
        setEstado("erro");
        setRecado(corpo.motivo ?? corpo.erro ?? `Não deu (HTTP ${r.status}).`);
      }
    } catch {
      setEstado("erro");
      setRecado("Não consegui falar com o servidor. Tenta de novo daqui a pouco.");
    }
  }

  return (
    <form className="arena" onSubmit={enviar}>
      <label htmlFor="enunciado">
        Qual tarefa real você quer ver medida? Escreva como você pediria de verdade.
      </label>
      <textarea
        id="enunciado"
        name="enunciado"
        required
        maxLength={4000}
        placeholder="Ex.: pegar um extrato bancário em PDF de 40 páginas e transformar em planilha com as colunas data, descrição, valor e categoria."
      />

      <label htmlFor="categoria">Categoria</label>
      <select id="categoria" name="categoria" defaultValue="codigo">
        <option value="codigo">código</option>
        <option value="escrita">escrita</option>
        <option value="dados">dados</option>
        <option value="documentos">documentos</option>
        <option value="pesquisa">pesquisa</option>
        <option value="automacao">automação</option>
      </select>

      <label htmlFor="contato">
        E-mail (opcional) — só para te avisar quando esta tarefa rodar
      </label>
      <input id="contato" name="contato" type="text" autoComplete="email" />

      <div className="botoes">
        <button className="botao botao-forte" type="submit" disabled={estado === "enviando"}>
          {estado === "enviando" ? "enviando…" : "Mandar para a triagem"}
        </button>
      </div>

      {recado && (
        <p className={`resposta ${estado === "ok" ? "ok" : "erro"}`}>{recado}</p>
      )}
    </form>
  );
}
