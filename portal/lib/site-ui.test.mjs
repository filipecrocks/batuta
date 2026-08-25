import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("the public home exposes Portuguese, English and Spanish", () => {
  const home = read("components/HomeContent.tsx");
  for (const locale of ["pt", "en", "es"]) {
    assert.match(home, new RegExp(`${locale}:\\s*\\{`));
  }
  assert.match(home, /aria-label=.*language/i);
});

test("the layout uses a friendly non-condensed display face", () => {
  const layout = read("app/layout.tsx");
  const css = read("app/globals.css");
  assert.doesNotMatch(layout, /Instrument_Serif/);
  assert.match(layout, /Manrope/);
  assert.match(css, /--display:\s*var\(--fonte-display\)/);
  assert.match(css, /\.marca-texto\s*\{[^}]*font-family:\s*var\(--display\)/s);
});

test("the page contract forbids viewport-level horizontal overflow", () => {
  const css = read("app/globals.css");
  assert.match(css, /html,\s*body\s*\{[^}]*overflow-x:\s*clip/s);
  assert.match(css, /min-width:\s*0/);
  assert.doesNotMatch(css, /\.topo nav\s*\{[^}]*overflow-x:\s*auto/s);
});

test("mobile navigation and language controls meet the 44px touch floor", () => {
  const css = read("app/globals.css");
  assert.match(css, /\.language-switch button\s*\{[^}]*min-(?:block-size|height):\s*44px/s);
  assert.match(css, /\.topo nav a\s*\{[^}]*min-(?:block-size|height):\s*44px/s);
});

test("callouts do not use decorative thick side-tab borders", () => {
  const css = read("app/globals.css");
  assert.doesNotMatch(css, /border-(?:left|right):\s*(?:[2-9]|\d{2,})px\s+solid/);
});
