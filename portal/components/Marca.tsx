/**
 * A marca do Batuta.
 *
 * Três hastes que sobem — duas de pé, retas, como as barras de um mostrador; a
 * terceira inclinada, com a ponta em bola: a batuta que rege. Medir e reger, as duas
 * metades do projeto, no mesmo desenho.
 *
 * Grade de 24 unidades, traço de 2.4: continua legível a 16px numa aba do navegador
 * e continua limpo a 512px num cartaz.
 *
 * `tom="chapado"` pinta tudo em currentColor, para onde uma marca de duas cores
 * competiria com o texto ao lado (rodapé, favicon monocromático, impressão).
 */
export function Marca({
  tamanho = 28,
  tom = "duplo",
}: {
  tamanho?: number;
  tom?: "duplo" | "chapado";
}) {
  const batuta = tom === "duplo" ? "var(--acento)" : "currentColor";
  const barra = tom === "duplo" ? "var(--texto-3)" : "currentColor";

  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="marca-sinal"
    >
      <path d="M4.6 19.4 V14.6" stroke={barra} strokeWidth="2.4" strokeLinecap="round" opacity="0.55" />
      <path d="M10 19.4 V10.4" stroke={barra} strokeWidth="2.4" strokeLinecap="round" opacity="0.8" />
      <path d="M15.4 19.4 L19.1 7.8" stroke={batuta} strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="19.8" cy="5.3" r="2.1" fill={batuta} />
    </svg>
  );
}
