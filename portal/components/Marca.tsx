/**
 * The Batuta mark.
 *
 * Three rising bars — two standing straight, like the bars of a display; the
 * third tilted, with a ball tip: the baton that conducts. Measuring and conducting,
 * the two halves of the project, in the same drawing.
 *
 * 24-unit grid, 2.4 stroke: stays legible at 16px in a browser tab and stays
 * clean at 512px on a poster.
 *
 * `tom="chapado"` (flat tone) paints everything in currentColor, for places where
 * a two-color mark would compete with the text next to it (footer, monochrome
 * favicon, print).
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
