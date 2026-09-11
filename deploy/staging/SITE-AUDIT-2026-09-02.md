# medx.hr — Brand & Conversion Audit (2026-09-02)

Senior design audit of the live public site, judged against luxury-foundation and university-advancement peers (Wellcome, HHMI, Harvard-department giving pages). Suggest-only. Nothing was changed or deployed.

**Method.** Live audit with Playwright at 1440px and 390px, full-page screenshots of 21 pages (all six money pages plus accelerator-sponsor, five conversion pages including the /boston redirect target, six brand pages, three HR twins) — every screenshot visually reviewed. Lighthouse-style basics collected per page (weight, LCP, alt coverage, heading order, meta). Claims spot-verified against live HTML. Screenshots: `/private/tmp/claude-501/-Users-alen-Documents-claude-code/350265dd-f872-47b9-84c3-9a4a8b270ca8/scratchpad/ux-site/`.

---

## A. Executive read

1. This site is at a genuinely high level — top decile for an NGO, and its typographic system (editorial serif, numbered sections, kickers, EN/HR parity) stands comparison with the Wellcome/HHMI peer set without embarrassment.
2. The sponsor pages already have real conversion architecture most foundations lack: a 3-step wizard, tiered pricing legible in one glance, category exclusivity, inventory scarcity, a named contact with a 2-working-day reply promise.
3. What underperforms is **proof**: at the exact point of decision the money pages show empty partner walls ("Open · Open · Open", "Partners to be announced"), quotes labelled "EXAMPLE", and "illustrative" host institutions — while the organisation's real assets (a Siemens Healthineers/ministries/British Embassy logo wall, real fellows photographed at Cleveland Clinic, four heads of world institutions) sit one click away, unused.
4. Second gap is **money-page hygiene**: a "100%" proceeds stat that contradicts the published 45/25/15/10/5 allocation, popularity badges without visible history, an expired "early-bird until 1 September" line, a member sign-in toast eating a fifth of the mobile viewport mid-pitch, card-only giving with no bank-transfer path, and a live 404 at /hr/building-bridges-sponsor.
5. Almost everything ranked below is transplant-and-tighten work on an excellent system — small-to-medium effort, no redesign warranted, and the system itself belongs on the protect list.

---

## B. Ranked suggestions (12)

### 1. Put the real supporter wall where the money decision happens
- **Page(s):** /plexus-sponsor, /building-bridges-sponsor, /accelerator-sponsor (sections "In good company"), /plexus-gala-sponsor
- **What's weak (blunt):** Each sponsor page closes its pitch with an *empty* partner wall — "FOUNDING PARTNER: Your organization · GOLD: Open · SILVER: Open", "PARTNERS TO BE ANNOUNCED", a lone black "BECOME ONE" card. A section titled "In good company" that visually proves there is no company is anti-social-proof, placed right after the pricing ask. Meanwhile /supporters holds a marquee wall (Siemens Healthineers, Croatia Airlines, JGL, Ministry of Science, City of Split, British Embassy Zagreb, Hrvatski liječnički zbor), the homepage already has a designed 13-logo "OUR SUPPORTERS" module, and /about has a grayscale institutions strip. None of it appears on any sponsor page.
- **Do instead:** Transplant the homepage supporters module onto every sponsor page directly under the tier grid, retitled truthfully: "Med&X programmes have been backed by" + one row of 8–10 strongest logos + "and 11 more — see all supporters". Keep the founding-partner invitation as a single elegant card beside it ("The 2026 wall starts with a founding name"), never as a grid of empty slots. Peer model: every Wellcome/HHMI partnership page puts existing funders adjacent to the ask.
- **Class:** design · **Effort:** S · **Impact:** high

### 2. Replace simulated proof with real people
- **Page(s):** /donate (quote card), /accelerator-sponsor (hero "WHERE YOUR FELLOWS GO — EXAMPLE"), /network (directory)
- **What's weak (blunt):** The donate page's only human story is a quote card labelled "EXAMPLE · A GIFT, IN ONE LIFE" with a monogram avatar ("Marko, internship 2025"). Accelerator-sponsor lists Harvard · MGH · Cleveland Clinic · Mayo under an "EXAMPLE" pill with "Illustrative host institutions" in fine print. The network directory is entirely fictional personas (disclosed, but still). A CSR officer or advancement-literate donor reads all of this as manufactured evidence — worse than no evidence, and it sits beside genuinely real material (Cleveland Clinic photos of actual fellows).
- **Do instead:** One real, named, permissioned fellow story per money page: portrait, home city, host lab, two-sentence quote, year — the Harvard giving-page pattern ("your gift did this for this person"). Rephrase hosts verifiably: "Our fellows have trained alongside teams at Cleveland Clinic and …" if true, otherwise name only confirmed placements. On /network, show real Forum/advisory members with permission, or aggregate numbers and the map only — delete the fictional doctors. Fold in the two empty leadership portrait frames on home/about (Marina, Miro): shoot two portraits or use a designed monogram treatment — blank white rectangles read as broken on a luxury site.
- **Class:** copy+photo · **Effort:** M · **Impact:** high

### 3. Claims hygiene: retire the "100%" stat and the popularity badges
- **Page(s):** /plexus-gala-sponsor (hero stat "100% — proceeds fund fellowships"), /plexus-sponsor + /accelerator-sponsor ("MOST POPULAR"), /building-bridges-sponsor ("MOST CHOSEN" on the €25,000 tier)
- **What's weak (blunt):** The gala-sponsor hero prints a 100% figure while /donate publishes the allocation bar (Accelerator 45 / Plexus 25 / Bridges 15 / Forum 10 / Operations 5). Any diligent sponsor who opens both pages finds the contradiction — and this exact claim was already ruled out internally. "MOST CHOSEN" on a €25,000 named-city tier no edition has yet had, and "MOST POPULAR" beside a partner wall that says "Open", are popularity claims without visible history. Advancement offices are ruthless about verifiable claims — one caught inflation taints every other number on the site (the good ones: 2,500+ guests, 11 Nobel laureates).
- **Do instead:** Hero stat becomes wordmark-level copy: "Proceeds fund fellowships" (no figure), or reuse the gala page's cleaner phrasing "All Gala proceeds fund Accelerator fellowships". Swap popularity badges for what is already credible on the gala page — inventory and recommendation: "RECOMMENDED", "FIVE AVAILABLE", "THREE ONLY", "ONE ONLY". Keep the badges only where a real sales history exists.
- **Class:** copy · **Effort:** S · **Impact:** high

### 4. Get the member sign-in toast off the money pages
- **Page(s):** /plexus-sponsor, /plexus-gala-sponsor (desktop first paint and mobile), likely all pages via site-wide script
- **What's weak (blunt):** A persistent bottom banner — "Sign in to keep your Med&X tickets, registrations, and updates in one place" — occupies ~180px (roughly 20% of a 390×844 viewport) on sponsor pages, top to bottom of the scroll until dismissed. A hospital CEO or pharma CSR lead evaluating a €10–30k partnership is being nagged to sign in to a member portal they will never use, on top of the pitch.
- **Do instead:** Suppress the toast entirely on /donate, /supporters, /get-involved and every *-sponsor page. Elsewhere show it once per session, delayed, and never over the first viewport. Money pages get at most the floating "TALK TO US" pill — one persistent element, on brand.
- **Class:** feature · **Effort:** S · **Impact:** high

### 5. Add a bank-transfer and invoice path to giving
- **Page(s):** /donate (wizard + "Registered and accountable" card), echoed on sponsor pages' trust note
- **What's weak (blunt):** The only working payment path is the Stripe card checkout. Croatian companies, public bodies and foundations pay by bank transfer against a confirmation or invoice-style letter — and large diaspora gifts rarely go on a card. The page already promises "we issue written confirmation of every donation" and "whatever your finance team needs", then offers no rail for it. This was flagged internally on 07-31 and is still absent.
- **Do instead:** In the wizard's final step and inside the "Registered and accountable" card, add a quiet second rail: "Prefer a bank transfer? IBAN HRxx… · Udruga Med&X, Mosećka 128, Split · reference: your name — we confirm every gift in writing within two working days." For organisations, one line: "We are glad to provide a sponsorship confirmation your finance team can process." Wellcome/HHMI equivalents always list at least card + transfer + advised-fund routes.
- **Class:** feature · **Effort:** M · **Impact:** high

### 6. Give the gala-sponsor page its marquee faces at full size
- **Page(s):** /plexus-gala-sponsor ("Your name beside the people who lead…")
- **What's weak (blunt):** The single strongest sales asset — the Chancellor of Cambridge, the President of UCLA Health, the President of MGH, the CEO of UHN, in person, in Zagreb — is rendered as four 84px thumbnails with 3-line captions. The event page (/plexus-gala) already treats the same people correctly: large portraits, institution logos, "CONFIRMED KEYNOTE" pills, bio links.
- **Do instead:** Reuse the /plexus-gala speaker-card module on the sponsor page, full width, four across at ~260px portraits with the grayscale institution logos beneath — then let the tier grid follow it. The pitch order becomes: these people are in the room → here is the room → here is your name's place in it.
- **Class:** design · **Effort:** S · **Impact:** high

### 7. Kill the /hr/building-bridges-sponsor 404
- **Page(s):** /hr/building-bridges-sponsor (returns a bare 404), language toggle on /building-bridges-sponsor
- **What's weak (blunt):** The sponsor page for the diaspora flagship has no Croatian twin and no redirect — the HR toggle and any Croatian-language campaign link dead-end a Croatian hospital director or company on a 404. Every other money page has a full HR twin of real quality (the HR copy is native-grade, prices localised).
- **Do instead:** Short term, add the redirect line the site already uses for this pattern (`/hr/building-bridges-sponsor → /building-bridges-sponsor 301`, as done for /hr/network). Properly: build the HR twin — the translation system and components all exist.
- **Class:** IA · **Effort:** S · **Impact:** med

### 8. Stale-date and typo sweep on conversion surfaces
- **Page(s):** / (upcoming strip + gala strip), /plexus-gala, /building-bridges
- **What's weak (blunt):** Three live defects found: (a) "€150 per guest (early-bird until 1 September)" on the homepage and "early-bird until 1 September 2026" on /plexus-gala — expired as of yesterday, leaving the current price ambiguous exactly where a guest decides; (b) the homepage Boston card states "Monday, 21 September 2026" and, two lines later, "Exact date confirmed shortly."; (c) /building-bridges renders a template leak: "6:00{E}9:00 pm" where an en dash belongs.
- **Do instead:** Fix all three now (state the flat €150 plainly, cut the "confirmed shortly" leftover, replace {E} with –). Then adopt a rule for date-bound copy: every deadline line carries a data-expiry and hides itself after the date, so urgency copy can never rot on the homepage again.
- **Class:** copy · **Effort:** S · **Impact:** med

### 9. One primary CTA per sponsor hero, and drop the wizard narration
- **Page(s):** /plexus-gala-sponsor (three stacked hero CTAs, third orphaned on its own row), /plexus-sponsor, /building-bridges-sponsor, plus the black "NOW INTERACTIVELY CHOOSE YOUR PARTNERSHIP LEVEL BELOW." band on gala- and plexus-sponsor
- **What's weak (blunt):** Three near-equal hero buttons split intent and break the luxury register (peers run one confident ask). The black instruction band narrates the interface ("interactively…") — self-referential UI copy the brand voice otherwise never uses, and it shouts in a page set in refined serif.
- **Do instead:** Hero: one red primary ("Build your partnership →") + one quiet text link ("Download the brochure (PDF)"). "Want a custom package?" is already step 1 of the wizard and the closing form — cut it from the hero. Delete the black band everywhere; "STEP 1 OF 3 — How would you like to take part?" already orients perfectly.
- **Class:** design · **Effort:** S · **Impact:** med

### 10. Merge the duplicated closing ask and close the dead zones
- **Page(s):** /plexus-sponsor, /building-bridges-sponsor (red band + form), /plexus-gala-sponsor and /building-bridges-sponsor (mid-page whitespace holes)
- **What's weak (blunt):** Both conference and bridges sponsor pages end with a full-viewport red band ("Let's build the right package…", two CTAs, one of which merely scrolls to the form that starts immediately below) followed by a second section saying the same thing above the actual form — two consecutive closes. On /plexus-sponsor the band's "GOVERNANCE & TRANSPARENCY" link is dark red on red, effectively invisible (the BB variant shows the correct underlined-white treatment). Separately, several money pages carry 300–700px dead zones where two-column rows misalign (bb-sponsor benefits/photo row, gala-sponsor's empty right column under the photo).
- **Do instead:** Fuse band and form into one closing section: red field, heading + reassurance copy left, the white form card right (the gala-sponsor page is already closest to this). Fix the link contrast to the BB treatment. Then a one-hour spacing pass: cap section paddings and align the two-column rows so each scroll earns itself — Wellcome's pages feel expensive partly because nothing idles.
- **Class:** design · **Effort:** M · **Impact:** med

### 11. Make tiers comparable on mobile
- **Page(s):** /plexus-gala-sponsor (5 tiers), /plexus-sponsor (4+bespoke), /building-bridges-sponsor, /accelerator-sponsor
- **What's weak (blunt):** On 390px the tier cards stack full-height with fixed minimums, producing ~6 screens of scrolling to compare five prices, with visible blank stretches inside cards (e.g. Strategic Partner: title, one sentence, 150px of nothing, then the price). No one holds five options in mind across six screens.
- **Do instead:** On mobile, collapse each tier to a compact row — number, name, price, one-line promise, chevron — expanding on tap to the bullet list and button (details/accordion, no JS framework needed). Kill the min-heights. Desktop cards stay as they are; they read well at 1440.
- **Class:** design · **Effort:** M · **Impact:** med

### 12. Tune the donate ask ladder
- **Page(s):** /donate (hero), /get-involved ("from €25 up" card)
- **What's weak (blunt):** The headline sells the €1,000 named fellowship; the primary button then says "DONATE €50 →". The jump from story to ask loses the anchor, and /get-involved quotes a €25 floor — three different numbers greet the same donor. The wizard's amount step is good, but the hero hard-codes one small figure.
- **Do instead:** Keep the low-friction entry, framed as a ladder the way university giving pages do: primary "Give now" opening the amount step, with the hero microcopy naming the rungs — "€50 keeps a seat open · €250 funds a travel grant share · €1,000 names a fellowship · €4,000 places a fellow". Align the €25/€50 floor across pages (pick one).
- **Class:** design+copy · **Effort:** S · **Impact:** med

---

## C. Already excellent — protect these

1. **The partnership wizard and the human close.** "Step 1 of 3 — How would you like to take part?", "nothing is committed until we speak", the adaptive program field, "I would like a call", and above all the named contact — "Alen Juginović, MD — President · president@medx.hr" with a 2-working-day promise (marija.pranjic@ on the Accelerator, laura.rodman@ on Boston). Friction-to-talk is lower than on most peer sponsor pages. Do not let anyone "simplify" this into a generic contact form.
2. **The transparency block.** Registered udruga with OIB/MB and address, published statute and financials, written confirmation of every gift, the tax-jurisdiction note, the allocation bar labelled as budgeted allocation, "Ask us anything before you give". This is advancement-office grade and rare at this size. (Suggestion 3 makes the rest of the site consistent with it.)
3. **Sponsorship merchandising.** Category exclusivity ("one pharma, one bank, one medtech"), true inventory scarcity ("ONE ONLY" title partner, "Close 1 October 2026, first-to-commit"), the à-la-carte moments (lanyards €1,500, networking lunch €2,500, student travel €1,000), add-on champagne reception, and "prices are anchors, we tailor" — a sophisticated toolkit peers rarely match.
4. **The typographic system and EN/HR parity.** Editorial serif with italic accents, numbered sections with kickers, consistent tier-card grammar across all four sponsor pages — and Croatian twins that are native-quality, structurally identical, with localised prices and even the AI→"UI" stat. This is a real bilingual brand, one missing page aside (suggestion 7).
5. **The gala event page and the homepage spine.** Confirmed-keynote cards with real portraits and institution logos, the hour-by-hour provisional programme, the gold "reserve a seat" treatment, the 2,500+/11 Nobel/50+ stat band, the founder's Split-to-Harvard quote, and the press band. When suggestions 1 and 6 transplant these modules onto the money pages, change nothing about the originals.

---

### Technical footnotes (kept brief, by request a design audit)
- **Page weight:** /heritage/ transfers ~29MB (and is the one page with no meta description, a double H1, and 17 images missing alt). /plexus ~8.4MB, /plexus-gala ~8.9MB, /about ~6.9MB. Peers hold hero pages near 2–3MB. Biggest wins: responsive `srcset` (galleries ship 1500–1600px images into ~530px slots, logo.png ships 750px into a 136px slot on every page) and compressing the heritage media set.
- **LCP** measured fast everywhere that matters (64–500ms render on money pages; heritage the outlier at ~1.3s).
- **Alt coverage:** home 11/62 images missing alt, gala 5/34, plexus 4/49, heritage 17/87 — one editorial pass closes it.
- **No mobile horizontal overflow detected on any audited page** (the July forum fix held). Heading order is clean sitewide except heritage's double H1; footer nav headings render as H2s (harmless, tidy later).
- /boston 302s to the portal-hosted event page — clean, co-branded, with named contact; its visual system diverges from medx.hr (different serif, gold accents). Acceptable for a satellite page, worth one alignment pass if it becomes a template.
