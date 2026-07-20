# Poruka za Miru — promjena nameservera za medx.hr

**Spremno za slanje — nameserveri uneseni 2026-06-10 (Cloudflare: jade + merlin).**

---

Bok Miro,

trebam ti 5 minuta za jednu tehničku sitnicu oko medx.hr domene.

Da bi portal mogao slati mailove gostima (QR kodovi za Plexus/Galu), moram potvrditi medx.hr kao sender domenu — a DNS trenutno visi na nečijem Vercel računu do kojeg nitko ne može doći. Umjesto da ga tražimo, prebacio bih DNS na Cloudflare račun pod našom kontrolom.

Sve postojeće zapise (web stranica na Squarespaceu, mail na Outlooku) već sam preslikao na Cloudflare, tako da se ništa neće srušiti — stranica i mail nastavljaju raditi bez prekida.

Jedino što treba: ti si kontakt za domenu kod CARNET-a, pa se ulogiraj na **https://domene.hr** (AAI@EduHr ili račun preko kojeg je domena registrirana za Udrugu Med&X) i kod medx.hr zamijeni nameservere:

    ns1.vercel-dns.com  →  jade.ns.cloudflare.com
    ns2.vercel-dns.com  →  merlin.ns.cloudflare.com

To je sve. Ako bilo što zapne ili nemaš pristup, javi mi pa ćemo skupa.

Hvala!
Alen
