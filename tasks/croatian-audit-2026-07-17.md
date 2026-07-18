# Croatian translation audit — member portal (2026-07-17)

> **Accuracy caveat (verified after the run):** the fan-out audit was NOT adversarially
> verified, and it over-reported. Spot-checking against the file found several "gaps" that
> are already fully translated — e.g. the account dropdown (`account.editProfile` →
> *Uređivanje profila*, `account.signOut` → *Odjava*) is defined in DICT and works. Treat
> every line below as a LEAD to re-verify, not a confirmed gap.

## Ground-truth measurements (these ARE reliable)

- **1,092 distinct `data-i18n*` keys are used; 1,697 are defined in DICT. Every used key is
  defined** (the only 7 "missing" are dynamic `${...}` template artifacts). So tagged-element
  Croatian coverage is essentially complete — the report's "tag present but English wins" class
  barely exists.
- The REAL gaps are two classes the tag-check can't see:
  1. **117 literal-English `showToast('...')` calls** (verified count). Members see these
     constantly ("Added to your schedule!", "Please enter your name.", "Connection request
     sent!"). None are localized. Best fix: a single english→formal-Vi map consulted by a shared
     toast helper, so all 117 localize without touching call sites — but there are 8 separate
     `showToast` definitions, so this needs one careful supervised pass, not a blind edit.
  2. **Hardcoded, untagged static/JS-set strings** — genuinely missing tags. Confirmed real:
     onboarding "Skip tour" / "Let's go" / the tour description (index.html:59079-59083),
     "Welcome back" (upWelcomeHeader, JS-set, 60650). These need a `data-i18n` tag (static) or a
     `t()` wrap at the JS that sets them (dynamic).

## Recommended next pass (supervised)

1. Add a `TOAST_HR` map (english → formal Vi) + route the 8 `showToast` bodies through one shared
   `window.mxToast(msg)` that localizes when `_locale==='hr'`. Verify in the live HR UI.
2. Tag the confirmed static onboarding/welcome strings and add their DICT keys.
3. Re-verify the report's remaining line-item claims one by one before applying (it was wrong on
   the account dropdown; assume other individual claims may also be stale).

---

## Original fan-out report (UNVERIFIED — leads only)

PARSE FAILED

---

## Machine-readable gaps

```json
[]
```
