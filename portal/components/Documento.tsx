import { markdown } from "@/lib/markdown";

/** Renderiza um markdown do repositório. O HTML vem do nosso próprio renderizador
 *  (lib/markdown.ts), que não aceita HTML embutido — a fonte é o repo, não entrada
 *  de usuário, e mesmo assim a porta fica fechada. */
export function Documento({ fonte }: { fonte: string }) {
  return (
    <div
      className="documento"
      dangerouslySetInnerHTML={{ __html: markdown(fonte) }}
    />
  );
}
