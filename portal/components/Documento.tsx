import { markdown } from "@/lib/markdown";

/** Renders markdown from the repository. The HTML comes from our own renderer
 *  (lib/markdown.ts), which does not accept embedded HTML — the source is the repo,
 *  not user input, and even so the door stays closed. */
export function Documento({ fonte }: { fonte: string }) {
  return (
    <div
      className="documento"
      dangerouslySetInnerHTML={{ __html: markdown(fonte) }}
    />
  );
}
