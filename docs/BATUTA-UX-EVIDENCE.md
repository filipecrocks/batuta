# Batuta public home — UX evidence

Date: 2026-08-24  
Surface: `/`  
Mode: Persuade, with a technical proof object  
Candidate: `codex/batuta-site-redesign` (not deployed)

## Principle-to-evidence matrix

| Principle | Decision | File / screen | Evidence |
| --- | --- | --- | --- |
| One dominant promise | The first viewport leads with one plain-language outcome: choose AI using evidence. The report is supporting proof, not a competing CTA. | `portal/components/HomeContent.tsx`, hero | Visual captures at 320–1440px keep the headline first in reading and DOM order. |
| B2B landing sequence | The page moves through promise → operational proof → honest limitation → mechanism → immediate value → public mission and CTA. | `HomeContent.tsx`, full home | Every section answers one decision question; no invented logos, testimonials or customer claims were added. |
| Evidence before persuasion | Published counts remain zero when there is no verified record; the interface explains why. | Home proof strip and truth band | Existing database result is rendered directly; copy labels construction honestly. |
| Calm technical identity | Manrope carries display and brand roles; Inter carries explanation; JetBrains Mono is reserved for measurements and commands. | `layout.tsx`, `globals.css` | No condensed/serif display face remains. Three distinct roles are visible in screenshots. |
| Clear reading measure | Hero and supporting prose stay bounded while the overall composition uses the full 76rem canvas. | `.home-wide`, `.linha-fina`, `.hero-copy` | The previous 42rem left-aligned page constraint no longer owns the home. |
| Inclusive language choice | Language names use endonyms — Português, English, Español — and each control exposes pressed state. | `HomeContent.tsx` | Playwright changes all three headings at every tested viewport. |
| Touch and keyboard access | Navigation and language controls have a 44px minimum target and visible focus treatment. | `.topo nav a`, `.language-switch button`, `:focus-visible` | Contract tests assert the floor; browser computed style reports `44px`. |
| Adaptation, not scaling | Desktop uses a two-column promise/proof composition. Narrow screens reflow navigation, proof, steps and mission into one readable column. | Responsive rules in `globals.css` | Playwright confirms `scrollWidth === clientWidth` at 320, 375, 768, 1024 and 1440 in PT/EN/ES. |
| No generic card grid | The process is a ruled sequence; only the two genuinely different closing propositions share a split surface. | `.steps`, `.statement-grid` | No equal icon-card scaffold was introduced. |
| Restraint in decoration | The thick side-tab accent was removed; color and lines support hierarchy without decorative gradients or text effects. | `.aviso`, `blockquote`, detector scope | Impeccable detector returns `[]`. |
| Reduced cognitive load | Three real steps explain the mechanism; arbitrary 01/02/03 section numbering was removed. | `HomeContent.tsx` | Section numbers now exist only where order carries meaning. |
| Localization resilience | Copy is stored as complete messages and containers allow expansion; no fixed-width language label is used. | `COPY`, responsive CSS | English and Spanish remain overflow-free at all five widths. |
| Coherent persisted language | One provider controls home, header, footer, metrics and report; selection persists and updates the root `lang`. | `LocaleProvider.tsx`, `SiteChrome.tsx`, `HomeContent.tsx`, `Mostrador.tsx` | Playwright changed and reloaded every language at five widths; `html.lang` remained correct. |
| Beginner activation | A three-term glossary explains agent, skill and model before asking the reader to install. | Home glossary | All three definitions are localized and remain visible at 320px. |
| Low-friction capture | Newsletter asks only for email plus explicit consent, uses an idempotent request and confirms the pending double-opt-in state. | `NewsletterForm.tsx`, `newsletter-submission.ts`, `/api/newsletter/subscriptions` | Intercepted browser request matches the reviewed candidate contract exactly; API fails closed without bindings. No migration was applied. |
| Claims carry receipts | `24` and `<50ms` link directly to the frozen battery and benchmark source beside the value. | Home proof strip | Every metric has an adjacent visible source link. The terminal is labeled fictional in all locales. |

## Verification

- UI and newsletter contract tests: 12/12 passed.
- Full portal test suite: 44/44 passed.
- TypeScript: passed.
- Next.js production build: 17 routes generated successfully.
- Impeccable mechanical detector: 0 findings after the hardening pass.
- Browser console: 0 errors at 320, 375, 768, 1024 and 1440px.
- Horizontal overflow: 0px at every width in Portuguese, English and Spanish.
- Screenshots: `artifacts/batuta-site/impeccable-{320,375,768,1024,1440}.png` (local evidence, intentionally not committed).

## Honest Impeccable audit score

| Dimension | Score | Evidence / remaining limitation |
| --- | ---: | --- |
| Accessibility | 3/4 | Semantic controls, pressed state, stronger contrast, 44px targets and a 12px terminal floor are present. A full screen-reader audit on physical devices is still pending. |
| Performance | 4/4 | Static-first page, no imagery, animation framework or layout-reading loop; fonts are self-hosted by Next. |
| Responsive design | 4/4 | Five browser widths and three locales show no horizontal overflow or console errors. |
| Theming | 3/4 | Coherent semantic tokens drive the page, but the product intentionally offers only its dark instrument theme today. |
| Implementation integrity | 4/4 | Claims link to their source, examples cannot be mistaken for published findings, and the newsletter/API contract fails closed. |
| **Total** | **18/20** | **Excellent — physical assistive-technology testing and theme expansion remain.** |

## References applied

- Impeccable 4.0.2: audit, typeset, layout, adapt, clarify, polish and craft-floor playbooks.
- [UX Designer Skill](https://github.com/szilu/ux-designer-skill): calm clarity, 44px targets, visible feedback, endonym language switcher and localization expansion.
- [Claude Skills UI/UX catalog](https://claudeskills.info/best/ui-ux-skills/): treated as a discovery catalog, not as design authority; its accessibility and interface-review categories informed the independent verification stack.
- [Veza B2B landing-page framework](https://www.vezadigital.com/post/best-b2b-landing-page-examples): hero clarity, trust architecture, proof placement, form friction and a single conversion path.
- Batuta's existing product truth in `SPEC.md`, `MANIFESTO.md` and the verified local report component.

No deployment, database mutation or public merge was performed.
