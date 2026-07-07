'use strict';

/**
 * faq-kb.js — grounding corpus + deterministic retrieval for the Member FAQ Assistant
 * (queue 5a6, member side). USER PORTAL ONLY.
 *
 * Source of truth: ~/Documents/Claude_Code_Projects/MedX_Chatbot_KB/member_faq_kb.md
 * (65 vetted Q&A entries). Owner-note "undecided policy" items are marked esc:'team'|'support'
 * |'president' and carry only the safe holding line — the bot NEVER asserts an undecided policy
 * as fact. Every {placeholder} in an answer resolves from live DB / config here; if a referenced
 * fact is unresolved, the entry escalates rather than showing a blank (golden rule 11).
 *
 * Contract:
 *   - retrieval is deterministic (keyword + fuzzy + phrase scoring, no API key needed)
 *   - answers are the well-written KB text with live facts filled in
 *   - weak/no match OR a clinical question -> escalate to the team (existing inquiry channel)
 *   - bilingual EN + HR (formal Vi) throughout; no semicolons in member-facing copy
 */

// ---------- escalation routes (real Med&X addresses, never invented) ----------
const ESC_TARGETS = {
    team: 'info@medx.hr',       // general team inbox
    support: 'info@medx.hr',    // member support (same team, one inbox)
    president: 'president@medx.hr', // sponsorship / partnership / VIP / press
};

// ---------- text normalization ----------
// Fold Croatian diacritics so "ulaznica" matches "ulaznica" typed without diacritics,
// and lowercase everything. Retrieval compares deburred tokens on both sides.
function deburr(s) {
    return String(s == null ? '' : s)
        .toLowerCase()
        .replace(/č|ć/g, 'c').replace(/ž/g, 'z').replace(/š/g, 's').replace(/đ/g, 'd')
        .replace(/dž/g, 'dz');
}
const STOP = new Set([
    // EN
    'the', 'a', 'an', 'is', 'are', 'do', 'does', 'i', 'you', 'my', 'me', 'to', 'of', 'for', 'in',
    'on', 'at', 'and', 'or', 'can', 'how', 'what', 'when', 'where', 'who', 'it', 'this', 'that',
    'with', 'get', 'be', 'have', 'has', 'if', 'so', 'we', 'our', 'your', 'am', 'was', 'will', 'there',
    'please', 'want', 'need', 'know', 'tell', 'like', 'just', 'about', 'some', 'any', 'from',
    // greetings / politeness carry no signal and must not look like unknown topics
    'hi', 'hello', 'hey', 'thanks', 'thank', 'dear',
    // the generic event/organization words carry no signal — they appear in almost every question
    'event', 'events', 'medx', 'med',
    // HR
    'li', 'je', 'su', 'da', 'ne', 'se', 'za', 'na', 'u', 'i', 'ili', 'kako', 'kada', 'gdje', 'sto',
    'koji', 'koja', 'koje', 'moj', 'moja', 'vas', 'vam', 'mi', 'te', 'to', 'sa', 's', 'o', 'ako',
    'zelim', 'trebam', 'zelite', 'molim', 'mogu', 'moze', 'imam', 'oko',
    'bok', 'pozdrav', 'hvala', 'postovani', 'postovana', 'ima', 'jesu',
    'dogadanje', 'dogadanja', 'dogadaj', 'dogadanju', 'dogadaja',
]);
function tokenize(s) {
    return deburr(s)
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(function (w) { return w && w.length > 1 && !STOP.has(w); });
}

// ---------- date + money formatting (bilingual) ----------
const HR_MONTHS_GEN = ['siječnja', 'veljače', 'ožujka', 'travnja', 'svibnja', 'lipnja',
    'srpnja', 'kolovoza', 'rujna', 'listopada', 'studenoga', 'prosinca'];
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
function parseISO(d) {
    if (!d) return null;
    var m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    var dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(dt.getTime()) ? null : dt;
}
function fmtDate(d, locale) {
    var dt = parseISO(d);
    if (!dt) return '';
    if (locale === 'hr') return dt.getDate() + '. ' + HR_MONTHS_GEN[dt.getMonth()] + ' ' + dt.getFullYear() + '.';
    return dt.getDate() + ' ' + EN_MONTHS[dt.getMonth()] + ' ' + dt.getFullYear();
}
// A date range that collapses a same-month span ("4-5 December 2026" / "4.-5. prosinca 2026.").
function fmtRange(a, b, locale) {
    var da = parseISO(a), db = parseISO(b);
    if (!da) return '';
    if (!db || (da.getTime() === db.getTime())) return fmtDate(a, locale);
    if (da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth()) {
        if (locale === 'hr') return da.getDate() + '.–' + db.getDate() + '. ' + HR_MONTHS_GEN[db.getMonth()] + ' ' + db.getFullYear() + '.';
        return da.getDate() + '–' + db.getDate() + ' ' + EN_MONTHS[db.getMonth()] + ' ' + db.getFullYear();
    }
    return fmtDate(a, locale) + '–' + fmtDate(b, locale);
}
function euro(n, locale) {
    var v = Number(n);
    if (!isFinite(v)) return '';
    var s = (Math.round(v * 100) / 100).toString().replace(/\.00$/, '');
    return locale === 'hr' ? (s + ' €') : ('€' + s);
}
function todayISO() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

// ---------- live facts (DB + config), locale-aware ----------
// `q` is the server's query helper ({ get, all }). Never throws — any failure leaves a fact
// unresolved, and any entry that needs that fact will escalate instead of showing a blank.
function buildFacts(q, locale) {
    var hr = (locale === 'hr');
    var F = {
        portal_url: 'medx.hr',
        team_inbox: ESC_TARGETS.team,
        support_email: ESC_TARGETS.support,
        president_email: ESC_TARGETS.president,
        conference_language: hr ? 'engleskom jeziku' : 'English',
        membership_benefits: hr
            ? 'pristup članskom portalu, prijavu na događanja, Knjižnicu predavanja i članske obavijesti'
            : 'access to the member portal, event registration, the Talk Library, and member updates',
        eligibility_criteria: hr
            ? 'Med&X je zajednica liječnika, istraživača i studenata medicine i srodnih struka.'
            : 'Med&X is a community for physicians, researchers, and students in medicine and allied fields.',
        cpd_line: hr
            ? 'Med&X događanja daju potvrdu o sudjelovanju. Trenutačno ne dodjeljujemo formalne CPD ni CME bodove.'
            : 'Med&X events provide a certificate of attendance. We do not currently award formal CPD or CME credit.',
    };
    var missing = new Set();

    // --- Plexus conference (the active one) ---
    try {
        var conf = q.get("SELECT name, start_date, end_date, venue_name, venue_city, registration_open, early_bird_deadline, regular_deadline FROM conferences WHERE is_active = 1 ORDER BY year DESC, start_date DESC LIMIT 1")
            || q.get("SELECT name, start_date, end_date, venue_name, venue_city, registration_open, early_bird_deadline, regular_deadline FROM conferences ORDER BY start_date DESC LIMIT 1");
        if (conf) {
            F.plexus_dates = fmtRange(conf.start_date, conf.end_date, locale);
            var vparts = [conf.venue_name, conf.venue_city].filter(Boolean);
            F.plexus_venue = vparts.join(hr ? ', ' : ', ');
            F._conf = conf;
        }
    } catch (e) { /* leave unresolved */ }

    // --- ticket tiers + headline price (live from ticket_types) ---
    try {
        var tks = (F._conf ? q.all("SELECT name, name_hr, price_early_bird, price_regular FROM ticket_types WHERE conference_id = (SELECT id FROM conferences WHERE is_active=1 ORDER BY year DESC, start_date DESC LIMIT 1) ORDER BY sort_order") : [])
            || [];
        if (tks && tks.length) {
            var tierParts = [];
            var paid = [];
            tks.forEach(function (t) {
                var nm = (hr && t.name_hr) ? t.name_hr : t.name;
                var eb = Number(t.price_early_bird), rg = Number(t.price_regular);
                if (rg === 0 && eb === 0) {
                    tierParts.push(nm + (hr ? ' – besplatno' : ' – complimentary'));
                } else if (eb > 0 && eb !== rg) {
                    tierParts.push(nm + ' ' + euro(eb, locale) + (hr ? ' (rana prijava) / ' : ' early bird / ') + euro(rg, locale));
                    paid.push({ nm: nm, eb: eb, rg: rg });
                } else {
                    tierParts.push(nm + ' ' + euro(rg, locale));
                    paid.push({ nm: nm, eb: rg, rg: rg });
                }
            });
            F.ticket_tiers = tierParts.join(', ');
            if (paid.length) {
                // headline / direct price answer, built entirely from live rows
                var lines = paid.map(function (p) {
                    if (p.eb !== p.rg) return p.nm + ' ' + euro(p.eb, locale) + (hr ? ' (rana prijava), poslije ' : ' early bird, ') + euro(p.rg, locale) + (hr ? '' : ' regular');
                    return p.nm + ' ' + euro(p.rg, locale);
                });
                F.plexus_price = lines.join(hr ? '. ' : '. ');
            }
        }
    } catch (e) { /* leave unresolved */ }

    // --- Gala (gala_settings) ---
    try {
        var g = q.get("SELECT date, time, venue, dress_code, price_gala_early_bird, price_gala_regular, early_bird_deadline, is_registration_open FROM gala_settings WHERE id = 'default'")
            || q.get("SELECT date, time, venue, dress_code, price_gala_early_bird, price_gala_regular, early_bird_deadline, is_registration_open FROM gala_settings LIMIT 1");
        if (g) {
            F.gala_date = fmtDate(g.date, locale);
            F.gala_venue = g.venue || '';
            F.gala_dress_code = g.dress_code || '';
            F.gala_start_time = g.time || '';
            var geb = Number(g.price_gala_early_bird), grg = Number(g.price_gala_regular);
            if (isFinite(geb) && geb > 0 && geb !== grg) {
                F.gala_price = euro(geb, locale) + (hr ? ' (rana prijava), poslije ' : ' early bird, ') + euro(grg, locale) + (hr ? '' : ' regular');
            } else if (isFinite(grg) && grg > 0) {
                F.gala_price = euro(grg, locale);
            }
            F._gala = g;
        }
    } catch (e) { /* leave unresolved */ }

    // --- Accelerator application window (intake_windows) ---
    try {
        var iw = q.get("SELECT opens_at, closes_at FROM intake_windows WHERE track='accelerator' ORDER BY cycle DESC LIMIT 1");
        if (iw) {
            var now = new Date();
            var opens = iw.opens_at ? new Date(iw.opens_at) : null;
            var closes = iw.closes_at ? new Date(iw.closes_at) : null;
            var opensISO = iw.opens_at ? iw.opens_at.slice(0, 10) : null;
            var closesISO = iw.closes_at ? iw.closes_at.slice(0, 10) : null;
            if (opensISO) F.application_open_date = fmtDate(opensISO, locale);
            if (closesISO) F.application_deadline = fmtDate(closesISO, locale);
            var isOpen = (!opens || now >= opens) && (!closes || now <= closes);
            var notYet = opens && now < opens;
            if (notYet) {
                F.apply_answer = hr
                    ? ('Prijave za Accelerator otvaraju se ' + F.application_open_date + '. Još nisu otvorene, no pripremite se na vrijeme.')
                    : ('Applications for the Accelerator open on ' + F.application_open_date + '. They are not open yet, so it is worth getting ready in good time.');
            } else if (isOpen) {
                F.apply_answer = hr
                    ? ('Prijave za Accelerator su trenutačno otvorene' + (closesISO ? (' i traju do ' + F.application_deadline) : '') + '. Prijavite se u portalu, u dijelu Accelerator.')
                    : ('Applications for the Accelerator are open now' + (closesISO ? (' and close on ' + F.application_deadline) : '') + '. You can apply in the Accelerator section of the portal.');
            } else {
                F.apply_answer = hr
                    ? ('Prijave za Accelerator trenutačno su zatvorene. Javit ćemo članovima kada se otvori sljedeći krug.')
                    : ('Applications for the Accelerator are closed at the moment. We let members know when the next round opens.');
            }
        }
    } catch (e) { /* leave unresolved */ }

    // --- venue logistics (street address, parking, transit) ---
    // There is NO live DB/config source for these facts today (conferences carries only venue_name
    // and venue_city, and the vetted KB leaves {venue_address}/{parking_info}/{nearest_transit}
    // as undefined placeholders). Grounding rule: the bot never asserts a fact it cannot source,
    // so these stay UNRESOLVED and L2/L3 escalate to the team (rule 11) instead of guessing.
    // When the team adds a real config source for venue logistics, resolve F.venue_address,
    // F.parking_info, and F.nearest_transit from it here and the entries answer again.

    // --- direct "quick fact" answers, fully built from live data ---
    try {
        if (F.gala_date) {
            var gbits = [F.gala_date];
            if (F.gala_venue) gbits.push(F.gala_venue);
            F.gala_answer = (hr ? 'Plexus Gala je ' : 'The Plexus Gala is on ') + gbits.join(hr ? ', ' : ', ') + '.'
                + (F.gala_dress_code ? (hr ? (' Kod odijevanja: ' + F.gala_dress_code + '.') : (' Dress code is ' + F.gala_dress_code + '.')) : '')
                + (F.gala_price ? (hr ? (' Ulaznica: ' + F.gala_price + '.') : (' A ticket is ' + F.gala_price + '.')) : '');
        }
        if (F.plexus_dates && F.plexus_venue) {
            F.conf_answer = hr
                ? ('Plexus Conference održava se ' + F.plexus_dates + ' u ' + F.plexus_venue + '. Cijeli program vidljiv je na stranici događanja u portalu.')
                : ('The Plexus Conference takes place on ' + F.plexus_dates + ' at ' + F.plexus_venue + '. The full program is on the event page in the portal.');
        }
        if (F.plexus_price) {
            F.price_answer = hr
                ? ('Cijene ulaznica za Plexus: ' + F.plexus_price + '. VIP, izlagači i volonteri ne plaćaju. Sve možete rezervirati ovdje u portalu.')
                : ('Plexus ticket prices: ' + F.plexus_price + '. VIP, speaker, and volunteer passes are complimentary. You can book any of them right here in the portal.');
        }
    } catch (e) { /* leave unresolved */ }

    F._missing = missing;
    return F;
}

// ---------- the knowledge base (transcribed from member_faq_kb.md) ----------
// esc: false = confident answer.  esc:'team'|'support'|'president' = safe holding line + hand off.
// a.en / a.hr are the member-facing answers (templates). kw carries EN + HR retrieval terms.
const FAQ_ENTRIES = [
    // ---- 1. Registration & Applications ----
    { id: 'R1', section: 'registration', esc: false,
        kw: { en: 'register sign up signup registration buy how do i register get a ticket register for conference', hr: 'registracija registrirati prijava prijaviti prijavim kupiti kako se registrirati prijaviti na konferenciju' },
        a: { en: 'You can register right here in the portal. Open the event page, choose your ticket type, and follow the checkout steps. Once payment goes through you get a confirmation email with your ticket and QR code. If you tell me which event you mean I can point you to the right page.',
             hr: 'Registrirati se možete ovdje u portalu. Otvorite stranicu događanja, odaberite vrstu ulaznice i slijedite korake plaćanja. Nakon uspješne uplate dobivate potvrdu e-poštom s ulaznicom i QR kodom. Recite mi koje događanje Vas zanima pa Vas usmjerim na pravu stranicu.' } },
    { id: 'R2', section: 'registration', esc: false,
        kw: { en: 'registration open close deadline too late sign up when register last day', hr: 'registracija otvara zatvara rok prekasno kada se registrirati zadnji dan' },
        a: { en: 'Registration windows are shown on each event page. When a window closes, sign-ups close and on-site availability is not guaranteed. If the date has passed, message our team and we will tell you whether a waitlist is open.',
             hr: 'Rokovi prijave prikazani su na stranici svakog događanja. Kada se rok zatvori, prijave se zatvaraju i mjesta na licu mjesta nisu zajamčena. Ako je datum prošao, javite se timu pa provjerimo je li otvorena lista čekanja.' } },
    { id: 'R3', section: 'registration', esc: false,
        kw: { en: 'apply application application-only do i have to apply how to apply reviewed accepted', hr: 'prijava aplikacija moram li se prijaviti kako se prijaviti pregled prihvacen' },
        a: { en: 'A few Med&X events are application-based rather than open ticketing. For those, you submit your application in the portal during the application window. The team reviews applications and you are notified by email whether you are accepted. Accepted applicants then complete registration and payment if the event has a fee.',
             hr: 'Nekoliko Med&X događanja temelji se na prijavi, a ne na otvorenoj prodaji ulaznica. Za njih prijavu predajete u portalu unutar razdoblja prijava. Tim pregledava prijave i obavještava Vas e-poštom jeste li primljeni. Primljeni kandidati zatim dovršavaju registraciju i plaćanje ako događanje ima kotizaciju.' } },
    { id: 'R4', section: 'registration', esc: 'team',
        kw: { en: 'eligible eligibility can students attend only for doctors am i allowed qualify', hr: 'tko moze prisustvovati studenti mogu li samo za lijecnike ispunjavam uvjete' },
        a: { en: 'Eligibility depends on the specific event. If you are not sure whether you qualify, tell me your role (student, resident, physician, industry, guest) and I will connect you with the team, who will confirm before you pay.',
             hr: 'Uvjeti ovise o pojedinom događanju. Ako niste sigurni ispunjavate li ih, recite mi svoju ulogu (student, specijalizant, liječnik, industrija, gost) pa Vas povezujem s timom koji će potvrditi prije plaćanja.' } },
    { id: 'R5', section: 'registration', esc: false,
        kw: { en: 'application deadline last day to apply when apply close applications', hr: 'rok prijave zadnji dan prijaviti kada istjece prijave' },
        a: { en: '{apply_answer}',
             hr: '{apply_answer}' } },
    { id: 'R6', section: 'registration', esc: false,
        kw: { en: 'edit change registration mistake fix my form update details after submitting', hr: 'urediti promijeniti registraciju greska ispraviti obrazac azurirati podatke' },
        a: { en: 'Yes. Open your registration under My Events in the portal and edit the details you can change yourself, like name spelling, dietary needs, or session choices. For anything locked, like the email on the order or the ticket type, message us and we will update it for you.',
             hr: 'Da. Otvorite svoju prijavu u dijelu Moja događanja u portalu i uredite podatke koje sami možete mijenjati, poput pisanja imena, prehrambenih potreba ili odabira sesija. Za zaključane stavke, poput e-adrese na narudžbi ili vrste ulaznice, javite nam se pa ćemo ih ažurirati.' } },
    { id: 'R7', section: 'registration', esc: false,
        kw: { en: 'no confirmation email did my registration go through not sure registered', hr: 'nema potvrde e-mail je li prijava prosla nisam siguran registriran' },
        a: { en: 'First check your spam or junk folder and search your inbox for mail from Med&X. Your registration also shows under My Events in the portal. If it is listed there, you are confirmed. If it is not, send us the email you used and we will check it.',
             hr: 'Najprije provjerite mapu neželjene pošte i potražite poruku od Med&X-a. Vaša se prijava vidi i u dijelu Moja događanja u portalu. Ako je ondje navedena, potvrđeni ste. Ako nije, pošaljite nam e-adresu koju ste koristili pa provjerimo.' } },
    { id: 'R8', section: 'registration', esc: false,
        kw: { en: 'waitlist sold out capacity full join waitlist tickets run out', hr: 'lista cekanja rasprodano popunjeno pridruziti se ulaznice nestalo' },
        a: { en: 'If an event is at capacity, you may be able to join a waitlist from the event page. If you do not see a waitlist option, message our team and we will add you and let you know if a place opens.',
             hr: 'Ako je događanje popunjeno, možda se možete pridružiti listi čekanja sa stranice događanja. Ako ne vidite tu mogućnost, javite se timu pa ćemo Vas dodati i obavijestiti ako se oslobodi mjesto.' } },

    // ---- 2. Tickets & Payment ----
    { id: 'P1', section: 'payment', esc: false,
        kw: { en: 'pay payment method card credit card debit how do i pay accept', hr: 'platiti placanje nacin kartica kreditna debitna kako platim prihvacate' },
        a: { en: 'We take secure card payments, credit and debit, at checkout. Your card details are handled by our payment provider and are never stored by Med&X. Once payment succeeds you get your ticket and QR code by email.',
             hr: 'Prihvaćamo sigurna plaćanja karticama, kreditnim i debitnim, pri naplati. Podatke o kartici obrađuje naš pružatelj plaćanja i Med&X ih nikada ne pohranjuje. Nakon uspješne uplate ulaznicu i QR kod dobivate e-poštom.' } },
    { id: 'P2', section: 'payment', esc: false,
        kw: { en: 'secure safe payment card protected is it safe to enter my card', hr: 'sigurno placanje kartica zasticeno je li sigurno unijeti karticu' },
        a: { en: 'Yes. Payments run through a PCI-compliant global payment provider. Med&X never sees or stores your full card number. You will see the charge on your statement under Med&X or our event name.',
             hr: 'Da. Plaćanja se obrađuju preko globalnog pružatelja usklađenog s PCI standardom. Med&X nikada ne vidi ni ne pohranjuje cijeli broj Vaše kartice. Na izvatku ćete vidjeti stavku pod nazivom Med&X ili nazivom događanja.' } },
    { id: 'P3', section: 'payment', esc: 'team',
        kw: { en: 'refund cancel money back refund policy cant make it no show', hr: 'povrat novca otkazati vratiti novac politika povrata ne mogu doci' },
        a: { en: 'All Med&X event tickets are non-refundable. Once a place is purchased we are unable to refund it, including for cancellations or no-shows, because we commit those funds to venue, catering, and program costs in advance. If your situation is exceptional, I can pass it to the team to review case by case, though a refund is not guaranteed. Would you like me to do that?',
             hr: 'Sve ulaznice za Med&X događanja nepovratne su. Nakon kupnje mjesta ne možemo izvršiti povrat, uključujući otkaze i nedolaske, jer ta sredstva unaprijed obvezujemo za prostor, ugostiteljstvo i program. Ako je Vaša situacija iznimna, mogu je proslijediti timu na pojedinačnu procjenu, no povrat nije zajamčen. Želite li da to učinim?' } },
    { id: 'P4', section: 'payment', esc: 'team',
        kw: { en: 'transfer ticket colleague someone go in my place give ticket friend name change', hr: 'prenijeti ulaznicu kolega netko umjesto mene dati ulaznicu prijatelju promjena imena' },
        a: { en: 'Tickets are personal and tied to your name and QR code, so I cannot confirm a transfer myself. Let me connect you with the team, who will sort out whether a name change is possible for your event.',
             hr: 'Ulaznice su osobne i vezane uz Vaše ime i QR kod pa transfer ne mogu sam potvrditi. Povezat ću Vas s timom koji će provjeriti je li promjena imena moguća za Vaše događanje.' } },
    { id: 'P5', section: 'payment', esc: 'team',
        kw: { en: 'group booking group discount book for team several tickets deal bulk', hr: 'grupna rezervacija grupni popust rezervirati za tim vise ulaznica popust' },
        a: { en: 'For group bookings, let me put you in touch with the team. Tell them the event, how many people, and your institution, and they will arrange it for you.',
             hr: 'Za grupne rezervacije povezat ću Vas s timom. Recite im događanje, broj osoba i Vašu ustanovu pa će to organizirati.' } },
    { id: 'P6', section: 'payment', esc: false,
        kw: { en: 'invoice receipt vat oib proof of purchase employer bill tax', hr: 'racun potvrda pdv oib dokaz o kupnji poslodavac izdati porezni' },
        a: { en: 'Yes. Your order confirmation email is a valid proof of purchase, and you can download a receipt any time from My Events in the portal. If you need a formal invoice addressed to an institution or with a tax, VAT, or OIB number, reply with those billing details and we will issue it.',
             hr: 'Da. Potvrda narudžbe e-poštom valjan je dokaz o kupnji, a račun možete preuzeti bilo kada iz dijela Moja događanja u portalu. Ako trebate službeni račun na ustanovu ili s poreznim brojem, PDV-om ili OIB-om, pošaljite nam te podatke za naplatu pa ćemo ga izdati.' } },
    { id: 'P7', section: 'payment', esc: 'team',
        kw: { en: 'institution employer paying bill employer directly bank transfer purchase order hospital covering', hr: 'ustanova poslodavac placa racun izravno bankovni prijenos narudzbenica bolnica pokriva' },
        a: { en: 'For employer-paid or institution-billed registrations, let me pass this to the team with the attendee name, event, and billing contact, and they will arrange the invoice and payment method.',
             hr: 'Za prijave koje plaća poslodavac ili se fakturiraju ustanovi, proslijedit ću to timu s imenom sudionika, događanjem i kontaktom za naplatu pa će dogovoriti račun i način plaćanja.' } },
    { id: 'P8', section: 'payment', esc: false,
        kw: { en: 'payment failed declined card wont go through charged twice double charge', hr: 'placanje neuspjesno odbijeno kartica ne prolazi naplaceno dvaput dvostruka naplata' },
        a: { en: 'First try again with a different card or browser, since most declines are the bank fraud check on an online charge. If you think you were charged but got no ticket, or charged twice, do not pay again. Send us the email you used and the approximate time, and we will check and fix it.',
             hr: 'Najprije pokušajte ponovno drugom karticom ili preglednikom jer je većina odbijanja bankovna provjera pri internetskoj naplati. Ako mislite da ste plaćeni, a niste dobili ulaznicu, ili ste plaćeni dvaput, nemojte plaćati ponovno. Pošaljite nam e-adresu koju ste koristili i približno vrijeme pa ćemo provjeriti i ispraviti.' } },
    { id: 'P9', section: 'payment', esc: false,
        kw: { en: 'ticket tiers types difference vip include student price what do i get', hr: 'vrste ulaznica razlika vip ukljucuje student cijena sto dobivam' },
        a: { en: 'The ticket options are: {ticket_tiers}. Each tier lists exactly what it includes, like sessions, meals, gala access, and seating, on the event page. If you tell me your role I can point you to the right one.',
             hr: 'Mogućnosti ulaznica su: {ticket_tiers}. Svaka razina točno navodi što uključuje, primjerice sesije, obroke, pristup Gali i sjedenje, na stranici događanja. Recite mi svoju ulogu pa Vas usmjerim na pravu.' } },
    { id: 'P10', section: 'payment', esc: false,
        kw: { en: 'student trainee discount reduced rate resident students pay less', hr: 'student specijalizant popust snizena cijena studenti placaju manje' },
        a: { en: 'Yes, there is a student rate. The current prices are: {ticket_tiers}. A student or trainee rate may require proof of status, like a student ID or enrollment letter, at check-in. If you think you qualify and do not see it, just ask.',
             hr: 'Da, postoji studentska cijena. Trenutne cijene su: {ticket_tiers}. Studentska ili specijalizantička cijena može zahtijevati dokaz statusa, poput studentske iskaznice ili potvrde o upisu, pri prijavi. Ako mislite da ispunjavate uvjete, a ne vidite je, slobodno pitajte.' } },

    // ---- 3. Event Logistics ----
    { id: 'L1', section: 'logistics', esc: false,
        kw: { en: 'schedule agenda time start held program conference date happening', hr: 'raspored program sati pocinje odrzava konferencija datum vrijeme' },
        a: { en: '{conf_answer}',
             hr: '{conf_answer}' } },
    { id: 'L2', section: 'logistics', esc: false,
        kw: { en: 'venue address get there directions location tram train nearest transit how do i get', hr: 'lokacija adresa kako doci upute tramvaj vlak najblizi prijevoz kako stici' },
        a: { en: 'The venue is {venue_address}. Nearest public transport: {nearest_transit} If you are driving, see the parking note.',
             hr: 'Mjesto održavanja je {venue_address}. Najbliži javni prijevoz: {nearest_transit} Ako dolazite automobilom, pogledajte napomenu o parkiranju.' } },
    { id: 'L3', section: 'logistics', esc: false,
        kw: { en: 'parking park car free garage where leave my car', hr: 'parking parkiranje auto besplatno garaza gdje ostaviti auto' },
        a: { en: '{parking_info} For accessible parking, contact us in advance and we will arrange it.',
             hr: '{parking_info} Za parkiranje za osobe s invaliditetom javite nam se unaprijed pa ćemo to organizirati.' } },
    { id: 'L4', section: 'logistics', esc: false,
        kw: { en: 'dress code wear black tie formal business casual gala what should i wear', hr: 'kod odijevanja obuci crna kravata svecano poslovno gala sto obuci' },
        a: { en: 'As a rule of thumb, the conference days are smart or business, and the Gala evening is formal, black-tie or evening wear. For the Gala the stated dress code is {gala_dress_code}. If in doubt, dressing one notch up is always safe.',
             hr: 'Kao opće pravilo, konferencijski su dani poslovni, a Gala večer je svečana, crna kravata ili večernja odjeća. Za Galu je navedeni kod odijevanja {gala_dress_code}. Ako niste sigurni, uvijek je sigurno odjenuti se malo svečanije.' } },
    { id: 'L5', section: 'logistics', esc: false,
        kw: { en: 'dietary vegetarian vegan gluten allergy nut halal kosher food requirements', hr: 'prehrana vegetarijanac veganska bezglutenski alergija orasi halal kosher hrana potrebe' },
        a: { en: 'Yes. Please add your dietary needs when you register, there is a field on the form, or update them under My Events. We cater common needs including vegetarian, vegan, gluten-free, and major allergies, and we pass severe allergies to the caterer directly. For anything life-threatening, tell us by name so we flag it.',
             hr: 'Da. Prehrambene potrebe navedite pri prijavi, na obrascu postoji polje, ili ih ažurirajte u dijelu Moja događanja. Nudimo uobičajene opcije, uključujući vegetarijansku, vegansku, bezglutensku i za važnije alergije, a teže alergije prosljedujemo izravno ugostitelju. Za sve što je opasno po život javite nam se poimence kako bismo to posebno označili.' } },
    { id: 'L6', section: 'logistics', esc: 'support',
        kw: { en: 'accessible wheelchair mobility accessible toilets access disability limited mobility', hr: 'pristupacno invalidska kolica pokretljivost toaleti pristup invaliditet ogranicena pokretljivost' },
        a: { en: 'We choose venues with step-free access, accessible toilets, and space for wheelchairs wherever possible. Tell me your specific needs, like mobility, seating, sign-language interpretation, or a companion, and I will connect you with the team so everything is arranged in advance and ready when you arrive.',
             hr: 'Biramo prostore s pristupom bez stepenica, pristupačnim toaletima i mjestom za invalidska kolica kad god je moguće. Recite mi svoje potrebe, poput pokretljivosti, sjedenja, tumača znakovnog jezika ili pratitelja, pa ću Vas povezati s timom kako bi sve bilo pripremljeno unaprijed.' } },
    { id: 'L7', section: 'logistics', esc: 'support',
        kw: { en: 'carer companion assistant bring second ticket support person', hr: 'pratitelj njegovatelj asistent dovesti druga ulaznica osoba za podrsku' },
        a: { en: 'For a personal carer or companion supporting an accessibility need, let me connect you with the team with the details. You should not have to buy a second ticket for essential support.',
             hr: 'Za osobnog njegovatelja ili pratitelja koji podupire pristupačnu potrebu, povezat ću Vas s timom s detaljima. Ne biste trebali kupovati drugu ulaznicu za nužnu podršku.' } },
    { id: 'L8', section: 'logistics', esc: false,
        kw: { en: 'language english croatian interpretation follow speak croatian', hr: 'jezik engleski hrvatski prijevod pratiti govorim hrvatski tumacenje' },
        a: { en: 'The conference is held in {conference_language}. If interpretation is provided for any sessions it is noted in the program. If language access is a concern for you, just ask before you register.',
             hr: 'Konferencija se održava na {conference_language}. Ako je za pojedine sesije predviđen prijevod, to je navedeno u programu. Ako Vam je jezična pristupačnost važna, slobodno pitajte prije prijave.' } },
    { id: 'L9', section: 'logistics', esc: false,
        kw: { en: 'printed program agenda sessions list where find schedule', hr: 'tiskani program raspored popis sesija gdje pronaci' },
        a: { en: 'The live program is always current in the portal under the event. We recommend the online version since rooms and times can change. Any printed program is handed out at check-in.',
             hr: 'Aktualan program uvijek je dostupan u portalu, u dijelu događanja. Preporučujemo internetsku verziju jer se dvorane i vremena mogu promijeniti. Eventualni tiskani program dijeli se pri prijavi.' } },
    { id: 'L10', section: 'logistics', esc: false,
        kw: { en: 'arrive check in check-in how early doors open when', hr: 'doci prijava dolazak koliko ranije vrata otvaraju kada' },
        a: { en: 'Check-in opens ahead of the first session. Arrive with enough time to collect your badge and clear the entrance. The exact doors-open time is on the event page.',
             hr: 'Prijava se otvara prije prve sesije. Dođite s dovoljno vremena da preuzmete akreditaciju i prođete ulaz. Točno vrijeme otvaranja vrata navedeno je na stranici događanja.' } },
    { id: 'L11', section: 'logistics', esc: 'team',
        kw: { en: 'cloakroom coat check bag luggage leave', hr: 'garderoba ostaviti kaput torba prtljaga' },
        a: { en: 'Cloakroom availability depends on the venue, so let me check with the team, or you can ask at the registration desk on the day.',
             hr: 'Dostupnost garderobe ovisi o prostoru pa ću provjeriti s timom, ili možete pitati na prijavnom pultu na dan događanja.' } },

    // ---- 4. Membership ----
    { id: 'M1', section: 'membership', esc: false,
        kw: { en: 'membership include benefits what do i get why join member free', hr: 'clanstvo ukljucuje pogodnosti sto dobivam zasto se uclaniti clan besplatno' },
        a: { en: 'Med&X membership is free. As a member you get {membership_benefits}. Join once and you are set, there is no annual fee to renew.',
             hr: 'Med&X članstvo je besplatno. Kao član dobivate {membership_benefits}. Jednom se učlanite i to je to, nema godišnje naknade za obnovu.' } },
    { id: 'M2', section: 'membership', esc: false,
        kw: { en: 'become member join sign up create account how do i join register account', hr: 'postati clan uclaniti se otvoriti racun kako se uclaniti registrirati racun' },
        a: { en: 'Joining is free and takes a minute. Go to {portal_url}, create your account with your email, and confirm via the link we send you. That is it, you are a member and can register for events straight away.',
             hr: 'Učlanjenje je besplatno i traje minutu. Idite na {portal_url}, otvorite račun sa svojom e-adresom i potvrdite ga poveznicom koju šaljemo. To je to, član ste i možete se odmah prijavljivati na događanja.' } },
    { id: 'M3', section: 'membership', esc: false,
        kw: { en: 'membership cost fee pay to be member dues how much free', hr: 'clanstvo cijena naknada platiti clanarina koliko kosta besplatno' },
        a: { en: 'Nothing, Med&X membership is free. There are no dues and nothing to renew. You only ever pay for specific paid events, like the Gala or conference, if you choose to attend them.',
             hr: 'Ništa, Med&X članstvo je besplatno. Nema članarine ni obnove. Plaćate samo pojedina plaćena događanja, poput Gale ili konferencije, ako im želite prisustvovati.' } },
    { id: 'M4', section: 'membership', esc: false,
        kw: { en: 'renew membership every year expire renewal', hr: 'obnoviti clanstvo svake godine istice obnova' },
        a: { en: 'No annual renewal and no expiry fee. Because membership is free, your account stays active. We may occasionally ask you to confirm your details are current, but there is nothing to re-pay.',
             hr: 'Nema godišnje obnove ni naknade za istek. Budući da je članstvo besplatno, Vaš račun ostaje aktivan. Povremeno Vas možemo zamoliti da potvrdite da su podaci ažurni, no nema ničega što biste ponovno plaćali.' } },
    { id: 'M5', section: 'membership', esc: false,
        kw: { en: 'membership card member id where is my card digital', hr: 'clanska iskaznica clanska kartica gdje je moja kartica digitalna' },
        a: { en: 'Yes, your membership card lives digitally in the portal under your profile. It carries your personal QR code, which is also how you check in to events. There is no plastic card to wait for, just open it on your phone whenever you need it.',
             hr: 'Da, Vaša članska iskaznica nalazi se digitalno u portalu, u Vašem profilu. Nosi Vaš osobni QR kod, kojim se i prijavljujete na događanja. Nema plastične kartice na čekanje, samo je otvorite na telefonu kada Vam zatreba.' } },
    { id: 'M6', section: 'membership', esc: false,
        kw: { en: 'qr check in code print anything how do i check in scan', hr: 'qr prijava kod ispisati kako se prijaviti skenirati' },
        a: { en: 'Each ticket and your membership card carry a QR code. At the event, staff scan it at the entrance to check you in, just show it on your phone, or a printout if you prefer. If your QR will not scan, staff can look you up by name or email.',
             hr: 'Svaka ulaznica i Vaša članska iskaznica nose QR kod. Na događanju ga osoblje skenira na ulazu radi prijave, samo ga pokažite na telefonu, ili na ispisu ako Vam je draže. Ako se QR ne može očitati, osoblje Vas može pronaći po imenu ili e-adresi.' } },
    { id: 'M7', section: 'membership', esc: false,
        kw: { en: 'update profile contact details change details moved institution', hr: 'azurirati profil kontakt podaci promijeniti podatke promijenio ustanovu' },
        a: { en: 'Open your profile in the portal and edit your details there, like name, institution, role, and notification preferences. Changing your login email is a special case, just ask and we will help.',
             hr: 'Otvorite svoj profil u portalu i ondje uredite podatke, poput imena, ustanove, uloge i postavki obavijesti. Promjena e-adrese za prijavu poseban je slučaj, samo pitajte pa ćemo pomoći.' } },
    { id: 'M8', section: 'membership', esc: false,
        kw: { en: 'cancel delete membership leave account unsubscribe', hr: 'otkazati izbrisati clanstvo napustiti racun odjaviti se' },
        a: { en: 'You can delete your account from your profile settings, or ask us to do it. Since membership is free there is nothing to cancel financially. If you only want fewer emails, you can adjust notification preferences instead of leaving.',
             hr: 'Račun možete izbrisati u postavkama profila, ili zamolite nas da to učinimo. Budući da je članstvo besplatno, financijski nema ničega za otkazati. Ako želite samo manje e-poruka, umjesto odlaska možete prilagoditi postavke obavijesti.' } },
    { id: 'M9', section: 'membership', esc: false,
        kw: { en: 'anyone join doctors only students members non-medics open membership', hr: 'moze li se svatko uclaniti samo lijecnici studenti clanovi nemedicinari otvoreno clanstvo' },
        a: { en: '{eligibility_criteria} If you are unsure whether you fit, tell me your background and I will help you join the right way. Individual events may have their own eligibility on top of membership.',
             hr: '{eligibility_criteria} Ako niste sigurni uklapate li se, recite mi svoje podrijetlo pa ću pomoći da se učlanite na pravi način. Pojedina događanja mogu imati vlastite uvjete uz članstvo.' } },

    // ---- 5. Certificates & CPD ----
    { id: 'C1', section: 'certificates', esc: false,
        kw: { en: 'certificate attendance proof attended get my certificate', hr: 'potvrda sudjelovanje dokaz prisustvovao dobiti potvrdu certifikat' },
        a: { en: 'Yes. After the event your certificate of attendance is generated for anyone who checked in via QR, and you download it from My Events in the portal. If it is not there within a few days, message us with your name and we will issue it.',
             hr: 'Da. Nakon događanja potvrda o sudjelovanju izrađuje se za sve koji su se prijavili QR kodom, a preuzimate je iz dijela Moja događanja u portalu. Ako je nema unutar nekoliko dana, javite nam ime pa ćemo je izdati.' } },
    { id: 'C2', section: 'certificates', esc: false,
        kw: { en: 'cpd cme credits accredited points how many credits accreditation', hr: 'cpd cme bodovi akreditirano bodova koliko akreditacija' },
        a: { en: '{cpd_line} If that changes for a specific event, it will be shown on the event page.',
             hr: '{cpd_line} Ako se to promijeni za pojedino događanje, bit će navedeno na stranici događanja.' } },
    { id: 'C3', section: 'certificates', esc: false,
        kw: { en: 'claim cpd credits points what do i do to get credit', hr: 'ostvariti cpd bodove sto uciniti za bodove' },
        a: { en: 'If an event carries credit, you complete the online session evaluation in the portal after attending. Once submitted, the credit-bearing certificate becomes available under My Events. Credits are only issued to attendees who checked in.',
             hr: 'Ako događanje nosi bodove, nakon sudjelovanja ispunjavate internetsku evaluaciju sesija u portalu. Nakon predaje, potvrda s bodovima postaje dostupna u dijelu Moja događanja. Bodovi se dodjeljuju samo sudionicima koji su se prijavili.' } },
    { id: 'C4', section: 'certificates', esc: false,
        kw: { en: 'certificate wrong name details misspelled wrong title fix', hr: 'potvrda pogresno ime podaci krivo napisano pogresna titula ispraviti' },
        a: { en: 'Sure. Certificates pull from your profile, so first correct your name or title in your profile, then re-download. If it still shows the old details, send us the correct spelling and we will re-issue it.',
             hr: 'Naravno. Potvrde se popunjavaju iz Vašeg profila pa najprije ispravite ime ili titulu u profilu, a zatim ponovno preuzmite. Ako i dalje prikazuje stare podatke, pošaljite nam ispravan zapis pa ćemo je ponovno izdati.' } },
    { id: 'C5', section: 'certificates', esc: false,
        kw: { en: 'past certificate last year old certificate lost previous event', hr: 'prosla potvrda prosle godine stara potvrda izgubio prijasnje dogadanje' },
        a: { en: 'Yes, past certificates stay in My Events in the portal. If you cannot find one, send us the event name and year and we will re-send it.',
             hr: 'Da, prošle potvrde ostaju u dijelu Moja događanja u portalu. Ako je ne možete pronaći, pošaljite nam naziv i godinu događanja pa ćemo je ponovno poslati.' } },

    // ---- 6. Tech Help ----
    { id: 'T1', section: 'tech', esc: false,
        kw: { en: 'cant log in login not working access portal wont let me in sign in', hr: 'ne mogu se prijaviti prijava ne radi pristup portal ne pusta me prijaviti' },
        a: { en: 'Med&X uses passwordless login. Enter your email in the portal and we send you a secure sign-in link, a magic link, click it and you are in. If it does not work, check you are using the same email you registered with, and look in spam. Still stuck? Tell us the email you are using and we will help.',
             hr: 'Med&X koristi prijavu bez lozinke. Unesite e-adresu u portal i šaljemo Vam sigurnu poveznicu za prijavu, magičnu poveznicu, kliknite je i unutra ste. Ako ne radi, provjerite koristite li istu e-adresu s kojom ste se registrirali i pogledajte neželjenu poštu. I dalje ne ide? Recite nam koju e-adresu koristite pa ćemo pomoći.' } },
    { id: 'T2', section: 'tech', esc: false,
        kw: { en: 'magic link sign in link not arriving didnt get login link email', hr: 'magicna poveznica poveznica za prijavu ne stize nisam dobio link e-posta' },
        a: { en: 'Check your spam or junk folder and search for mail from Med&X, the link usually arrives within a minute. Make sure you typed the exact email you signed up with, a typo is the most common cause. Add our address to your contacts and request a fresh link. If nothing arrives, tell us the email and we will check it is not blocked.',
             hr: 'Provjerite mapu neželjene pošte i potražite poruku od Med&X-a, poveznica obično stigne unutar minute. Provjerite jeste li upisali točnu e-adresu s kojom ste se prijavili, tipfeler je najčešći uzrok. Dodajte našu adresu u kontakte i zatražite novu poveznicu. Ako ništa ne stigne, recite nam e-adresu pa provjerimo nije li blokirana.' } },
    { id: 'T3', section: 'tech', esc: false,
        kw: { en: 'login link expired invalid no longer valid', hr: 'poveznica za prijavu istekla nevazeca vise ne vrijedi' },
        a: { en: 'Sign-in links are single-use and time-limited for security, so an old one stops working. Just go back to the portal and request a new link, the latest email always has the working one. Do not click an older link from a previous email.',
             hr: 'Poveznice za prijavu jednokratne su i vremenski ograničene radi sigurnosti pa stara prestaje raditi. Vratite se u portal i zatražite novu poveznicu, najnovija e-poruka uvijek ima ispravnu. Nemojte klikati stariju poveznicu iz prethodne poruke.' } },
    { id: 'T4', section: 'tech', esc: false,
        kw: { en: 'password reset forgot password what is my password dont have', hr: 'lozinka poništiti zaboravio lozinku koja je moja lozinka nemam' },
        a: { en: 'There is no password to remember. Med&X signs you in with a one-time link sent to your email, so there is nothing to reset. If you are being asked for a password somewhere, it is not us, only ever sign in from the official portal.',
             hr: 'Nema lozinke koju biste pamtili. Med&X Vas prijavljuje jednokratnom poveznicom poslanom na e-adresu pa nema ničega za poništiti. Ako Vas negdje traže lozinku, to nismo mi, prijavljujte se isključivo sa službenog portala.' } },
    { id: 'T5', section: 'tech', esc: 'support',
        kw: { en: 'change email account switch email wrong email move account', hr: 'promijeniti e-adresu racun zamijeniti e-poštu pogresna e-adresa premjestiti racun' },
        a: { en: 'Because your login and tickets are tied to your email, an email change is done carefully. Open your profile to update it if self-service is available, otherwise let me connect you with the team from your current email stating the new one, and they will move your account, tickets, and history across.',
             hr: 'Budući da su prijava i ulaznice vezani uz Vašu e-adresu, promjena se obavlja pažljivo. Otvorite profil da je ažurirate ako je samostalna izmjena dostupna, inače ću Vas povezati s timom s Vaše trenutne e-adrese uz navedenu novu, pa će prenijeti račun, ulaznice i povijest.' } },
    { id: 'T6', section: 'tech', esc: false,
        kw: { en: 'add calendar add to calendar reminder google apple outlook', hr: 'dodati u kalendar podsjetnik google apple outlook' },
        a: { en: 'Yes, on the event page and in your confirmation email there is an Add to calendar option that drops the event straight into Google, Apple, or Outlook calendar with the date, time, and venue. Add it and you will have the details and a reminder ready.',
             hr: 'Da, na stranici događanja i u potvrdi e-poštom postoji mogućnost Dodaj u kalendar koja događanje unosi izravno u Google, Apple ili Outlook kalendar s datumom, vremenom i mjestom. Dodajte ga i imat ćete detalje i podsjetnik spremne.' } },
    { id: 'T7', section: 'tech', esc: false,
        kw: { en: 'portal not loading site wont load page broken button not working crash crashed error frozen', hr: 'portal se ne ucitava stranica se ne ucitava pokvareno gumb ne radi srusio pao greska zamrznuo' },
        a: { en: 'Try a hard refresh, a different browser, or an incognito window first, that clears most glitches. If it is still broken, tell us what you were doing, on what device and browser, and a screenshot if you can, and we will look into it.',
             hr: 'Prvo pokušajte tvrdo osvježavanje, drugi preglednik ili anoniman prozor, to rješava većinu smetnji. Ako i dalje ne radi, recite nam što ste radili, na kojem uređaju i pregledniku, i pošaljite snimku zaslona ako možete, pa ćemo provjeriti.' } },
    { id: 'T8', section: 'tech', esc: false,
        kw: { en: 'browser device phone best browser work on my phone', hr: 'preglednik uredaj telefon najbolji preglednik radi na telefonu' },
        a: { en: 'The portal works on any modern browser, Chrome, Safari, Edge, or Firefox, on phone, tablet, or computer. Keep your browser up to date. Your digital membership card and QR code are designed to be shown from your phone at events.',
             hr: 'Portal radi u svakom modernom pregledniku, Chrome, Safari, Edge ili Firefox, na telefonu, tabletu ili računalu. Držite preglednik ažuriranim. Vaša digitalna članska iskaznica i QR kod predviđeni su za prikaz s telefona na događanjima.' } },
    { id: 'T9', section: 'tech', esc: false,
        kw: { en: 'not getting emails stopped getting emails emails not reaching me', hr: 'ne dobivam e-poruke prestao dobivati e-poruke ne stizu' },
        a: { en: 'Check spam or junk and add our address to your contacts so future mail lands in your inbox. Confirm the email on your profile is correct and current. If confirmations and links still do not arrive, your provider may be filtering us, let us know and we will help.',
             hr: 'Provjerite neželjenu poštu i dodajte našu adresu u kontakte kako bi buduće poruke stizale u sandučić. Provjerite je li e-adresa u profilu točna i ažurna. Ako potvrde i poveznice i dalje ne stižu, možda nas Vaš pružatelj filtrira, javite nam pa ćemo pomoći.' } },

    // ---- 7. Guest Passes ----
    { id: 'G1', section: 'guests', esc: false,
        kw: { en: 'guest plus one bring someone partner come to gala plus-one', hr: 'gost pratnja dovesti nekoga partner doci na galu plus jedan' },
        a: { en: 'For the Gala and evening events, guest or plus-one places are often available. Where they are, you will see a guest ticket option on the event page, and your guest gets their own QR code. If you do not see the option for your event, just ask and I will check.',
             hr: 'Za Galu i večernja događanja mjesta za goste često su dostupna. Gdje jesu, na stranici događanja vidjet ćete opciju gostinske ulaznice, a Vaš gost dobiva vlastiti QR kod. Ako ne vidite opciju za svoje događanje, pitajte pa ću provjeriti.' } },
    { id: 'G2', section: 'guests', esc: false,
        kw: { en: 'guest own ticket pay separately plus one included', hr: 'gost vlastita ulaznica platiti odvojeno pratnja ukljucena' },
        a: { en: 'In most cases a guest needs their own ticket with their own QR code, so we know who is attending for catering and check-in. Add your guest during checkout or from My Events. Guest pass pricing is shown per event.',
             hr: 'U većini slučajeva gost treba vlastitu ulaznicu s vlastitim QR kodom kako bismo znali tko dolazi radi ugostiteljstva i prijave. Gosta dodajte pri naplati ili iz dijela Moja događanja. Cijena gostinske ulaznice prikazana je po događanju.' } },
    { id: 'G3', section: 'guests', esc: false,
        kw: { en: 'add guest details name where enter guest register plus one', hr: 'dodati podatke gosta ime gdje unijeti gost registrirati pratnju' },
        a: { en: 'After you buy a guest pass, open My Events and enter your guest name, email, and any dietary needs. They receive their own QR code by email. Please add their details before the event so check-in and seating are ready.',
             hr: 'Nakon kupnje gostinske ulaznice otvorite Moja događanja i unesite ime gosta, e-adresu i eventualne prehrambene potrebe. Gost dobiva vlastiti QR kod e-poštom. Podatke unesite prije događanja kako bi prijava i sjedenje bili spremni.' } },
    { id: 'G4', section: 'guests', esc: false,
        kw: { en: 'non-member guest outside not a member okay bring someone', hr: 'gost nije clan izvana nije clan u redu dovesti nekoga' },
        a: { en: 'Yes, a guest does not need to be a Med&X member to attend a paid event with you, as long as they have a valid guest pass. If the specific event has eligibility limits, those still apply, so check the event page or just ask.',
             hr: 'Da, gost ne mora biti član Med&X-a da bi s Vama došao na plaćeno događanje, dok god ima valjanu gostinsku ulaznicu. Ako pojedino događanje ima uvjete, oni i dalje vrijede pa provjerite stranicu događanja ili pitajte.' } },

    // ---- 8. Talk Library ----
    { id: 'TL1', section: 'talks', esc: false,
        kw: { en: 'watch talks recordings video library rewatch sessions recorded', hr: 'gledati predavanja snimke videoteka ponovno gledati sesije snimljeno' },
        a: { en: 'Recorded sessions live in the Talk Library inside the member portal. Sign in and browse past talks on demand. Which sessions are recorded and when they go up depends on the event and speaker permissions.',
             hr: 'Snimljene sesije nalaze se u Knjižnici predavanja unutar članskog portala. Prijavite se i pregledavajte prošla predavanja na zahtjev. Što je snimljeno i kada se objavljuje ovisi o događanju i dopuštenjima izlagača.' } },
    { id: 'TL2', section: 'talks', esc: false,
        kw: { en: 'attended access recordings rewatch what i saw videos afterward', hr: 'prisustvovao pristup snimkama ponovno gledati sto sam vidio videi poslije' },
        a: { en: 'Where a session was recorded, attendees can revisit it in the Talk Library after the event. If a talk you attended is not there, it may not have been recorded or is still processing, check back or just ask.',
             hr: 'Ondje gdje je sesija snimljena, sudionici je mogu ponovno pogledati u Knjižnici predavanja nakon događanja. Ako predavanja kojem ste prisustvovali nema, možda nije snimljeno ili se još obrađuje, provjerite kasnije ili pitajte.' } },
    { id: 'TL3', section: 'talks', esc: 'team',
        kw: { en: 'talk library without attending need ticket watch talks recordings access scope', hr: 'knjiznica predavanja bez prisustvovanja trebam ulaznicu gledati snimke pristup' },
        a: { en: 'Talk Library access rules vary, some content is open to all members and some is for attendees of that event. Let me confirm for the specific talk with the team.',
             hr: 'Pravila pristupa Knjižnici predavanja razlikuju se, dio sadržaja otvoren je svim članovima, a dio je za sudionike tog događanja. Provjerit ću za pojedino predavanje s timom.' } },
    { id: 'TL4', section: 'talks', esc: false,
        kw: { en: 'download share talk video download share with colleague', hr: 'preuzeti podijeliti predavanje video preuzimanje podijeliti s kolegom' },
        a: { en: 'Talks are for streaming in the member portal and are not available to download or re-share, to respect speaker rights. Point colleagues to the Talk Library, where they can watch it themselves as members.',
             hr: 'Predavanja su za gledanje u članskom portalu i nisu dostupna za preuzimanje ni dijeljenje, radi poštovanja prava izlagača. Uputite kolege na Knjižnicu predavanja, gdje ih kao članovi mogu sami pogledati.' } },

    // ---- 9. Contact & Escalation ----
    { id: 'X1', section: 'contact', esc: false,
        kw: { en: 'contact team reach human help email someone talk to a person', hr: 'kontakt tim doci do covjeka pomoc e-posta netko razgovarati s osobom' },
        a: { en: 'For anything I cannot resolve, the team is reachable at {team_inbox} for general matters and {president_email} for sponsorship, partnerships, or press. I can also pass your question straight to them from here, just say the word. Include your name and the email on your account so we can find you fast.',
             hr: 'Za sve što ne mogu riješiti, tim je dostupan na {team_inbox} za opća pitanja i {president_email} za sponzorstva, partnerstva ili medije. Vaše pitanje mogu proslijediti i odavde, samo recite. Navedite svoje ime i e-adresu s računa kako bismo Vas brzo pronašli.' } },
    { id: 'X2', section: 'contact', esc: 'president',
        kw: { en: 'sponsorship partnership sponsor company partner gala who handles', hr: 'sponzorstvo partnerstvo sponzor tvrtka partner gala tko vodi' },
        a: { en: 'Wonderful. Sponsorship and partnership enquiries go straight to our president office at {president_email}. Share your organization, which event, and the kind of involvement you have in mind, and the team will follow up with the options. I can pass your note along now if you like.',
             hr: 'Divno. Upiti za sponzorstvo i partnerstvo idu izravno u ured predsjednika na {president_email}. Podijelite svoju organizaciju, koje događanje i kakav oblik suradnje zamišljate pa će tim javiti mogućnosti. Vašu poruku mogu proslijediti odmah ako želite.' } },
    { id: 'X3', section: 'contact', esc: 'team',
        kw: { en: 'speaker program question coordinate speaking session', hr: 'izlagac program pitanje koordinirati govorim sesija' },
        a: { en: 'For speaker and program matters, let me route you to the program team. Include the event and your session so they can help quickly.',
             hr: 'Za pitanja o izlagačima i programu, usmjerit ću Vas programskom timu. Navedite događanje i svoju sesiju kako bi Vam brzo pomogli.' } },
    { id: 'X4', section: 'contact', esc: 'president',
        kw: { en: 'press media journalist media request press access', hr: 'mediji novinar medijski upit pristup medijima' },
        a: { en: 'Press and media enquiries go to {president_email}. Tell us your outlet, the event, and your deadline, and the team will respond. I can forward your note now if you like.',
             hr: 'Medijski upiti idu na {president_email}. Recite nam svoju redakciju, događanje i rok pa će tim odgovoriti. Vašu poruku mogu proslijediti odmah ako želite.' } },
    { id: 'X5', section: 'contact', esc: 'support',
        kw: { en: 'urgent at the event now stuck door qr wont scan help now on-site', hr: 'hitno na dogadanju sada zapeo vrata qr ne skenira pomoc odmah na licu mjesta' },
        a: { en: 'If you are on-site, go to the registration or check-in desk, staff can look you up by name or email and let you in even if your QR will not scan. If you cannot reach the desk, let me flag this to the team as urgent with your name.',
             hr: 'Ako ste na licu mjesta, otiđite na prijavni pult, osoblje Vas može pronaći po imenu ili e-adresi i pustiti unutra i ako se QR ne očita. Ako ne možete doći do pulta, označit ću ovo timu kao hitno s Vašim imenom.' } },

    // ---- direct "quick fact" entries (flagship live-data questions) ----
    { id: 'QGALA', section: 'logistics', esc: false, prio: 3,
        kw: { en: 'when is the gala where gala gala date gala when gala evening time', hr: 'kada je gala gdje gala datum gale gala večer vrijeme gale' },
        a: { en: '{gala_answer}', hr: '{gala_answer}' } },
    { id: 'QPRICE', section: 'payment', esc: false, prio: 3,
        kw: { en: 'how much ticket cost price tickets price of a ticket how much is', hr: 'koliko kosta ulaznica cijena ulaznice cijena karte koliko je' },
        a: { en: '{price_answer}', hr: '{price_answer}' } },
    { id: 'QCONF', section: 'logistics', esc: false, prio: 3,
        kw: { en: 'when is the conference where conference plexus date plexus where held conference location', hr: 'kada je konferencija gdje konferencija plexus datum gdje se odrzava lokacija konferencije' },
        a: { en: '{conf_answer}', hr: '{conf_answer}' } },
    { id: 'QAPPLY', section: 'registration', esc: false, prio: 3,
        kw: { en: 'are applications open accelerator applications open apply now application window', hr: 'jesu li prijave otvorene accelerator prijave otvorene prijaviti sada razdoblje prijava' },
        a: { en: '{apply_answer}', hr: '{apply_answer}' } },
];

// ---------- medical / clinical out-of-scope detector (MUST escalate) ----------
// Med&X members are physicians and researchers, so health words are ordinary PROGRAM vocabulary
// here — "which talks cover breast cancer" is a program question, not a request for care. The
// detector therefore only declines a request for personal clinical advice, in two tiers:
//   1. an explicit advice/care ask (should I take, dosage, side effects, boli me...) ALWAYS declines
//   2. a health topic word alone is NOT enough — it must be personally framed (I have, my, am I...)
//      AND carry no program/event/portal context (session, talk, venue, certificate, portal...)
// Everything is word-bounded, so "crashed" can never trip "rash".
const MED_ADVICE_RE = new RegExp([
    'is it safe to take', 'should i (?:take|stop|use)', 'what (?:medication|medicine|dose|dosage)',
    'my (?:symptoms?|pain|rash|blood pressure|diagnosis|medication|prescription|headache|fever|nausea|infection|anxiety|depression|illness|condition)',
    '\\bprescri(?:be|ption)', '\\bdosage\\b', '\\bdose of\\b', '\\b\\d+\\s?mg\\b', 'side effects?',
    'chest pain', 'medical advice', 'am i pregnant', 'i (?:am|feel) (?:sick|ill|unwell)',
    'i (?:have|feel|am having|keep getting) (?:a |an )?(?:fever|headache|rash|nausea|pain|symptoms?)',
    // HR
    'trebam li uzeti', 'smijem li uzeti', 'koju dozu', 'koji lijek', 'nuspojav', 'boli me',
    'bol u (?:prsima|grudima|glavi|trbuhu)', 'recept za', 'medicinski savjet',
    'imam (?:simptome?|temperaturu|osip|bolove|glavobolju|mu[cč]ninu)',
].join('|'), 'i');
const MED_TOPIC_RE = new RegExp('\\b(?:' + [
    'symptoms?', 'diagnos\\w*', 'treatments?', 'medications?', 'medicines?', 'antibiotics?',
    'infections?', 'pregnan\\w*', 'rash(?:es)?', 'tumou?rs?', 'cancers?', 'depress\\w*', 'anxiety',
    'fevers?', 'headaches?', 'nausea', 'illness(?:es)?', 'blood pressure',
    // HR
    'simptom\\w*', 'dijagnoz\\w*', 'lijek', 'lijekov\\w*', 'doza', 'terapij\\w*', 'lije[cč]enj\\w*',
    'trudn\\w*', 'infekcij\\w*', 'antibiotik\\w*', 'krvni tlak', 'temperatur\\w*',
].join('|') + ')\\b', 'i');
const MED_PROGRAM_CONTEXT_RE = new RegExp('\\b(?:' + [
    'sessions?', 'talks?', 'lectures?', 'speakers?', 'topics?', 'research', 'conference',
    'program(?:me)?s?', 'agenda', 'panels?', 'workshops?', 'symposi\\w*', 'venues?', 'rooms?',
    'certificates?', 'regist\\w*', 'tickets?', 'portal', 'website', 'site', 'gala', 'events?',
    'abstracts?', 'posters?', 'covers?', 'tracks?', 'keynotes?',
    // HR
    'sesij\\w*', 'predavanj\\w*', 'tem\\w', 'istra[zž]ivanj\\w*', 'konferencij\\w*', 'dvoran\\w*',
    'kotizacij\\w*', 'ulaznic\\w*', 'potvrd\\w*', 'prijav\\w*', 'doga[dđ]anj\\w*', 'izlaga[cč]\\w*',
    'raspored\\w*', 'radionic\\w*',
].join('|') + ')', 'i');
const MED_PERSONAL_RE = new RegExp('\\b(?:' + [
    'i have', 'i am', "i'?m", 'i feel', "i'?ve", 'i keep', 'i got', 'my', 'me', 'am i',
    'should i', 'do i need', 'what should i do', 'is it safe',
    'imam', 'osje[cć]am', 'moj\\w*', 'boli', 'trebam li', 'smijem li',
].join('|') + ')\\b', 'i');
// Tier-1 program-context exemption. A tier-1 advice ask (side effects, "what medicine", "dose of")
// is still an in-scope PROGRAM question when it is plainly about the curriculum — a session, talk,
// topic, agenda, slide, or schedule. Deliberately NARROWER than MED_PROGRAM_CONTEXT_RE (no
// gala / ticket / venue), so a genuine advice ask that only names an event as timing ("what should
// I take before the gala") still declines.
const MED_TALK_CONTEXT_RE = new RegExp('\\b(?:' + [
    'sessions?', 'talks?', 'lectures?', 'topics?', 'agenda', 'program\\w*', 'schedules?',
    'slides?', 'presentations?', 'panels?', 'workshops?', 'symposi\\w*', 'keynotes?', 'tracks?',
    'abstracts?', 'posters?', 'speakers?', 'curriculum',
    // HR
    'sesij\\w*', 'predavanj\\w*', 'tem[ae]\\w*', 'raspored\\w*', 'radionic\\w*',
    'prezentacij\\w*', 'izlaganj\\w*', 'slajd\\w*',
].join('|') + ')', 'i');
function isMedicalQuestion(text) {
    var t = String(text || '').toLowerCase();
    // tier 1: an explicit advice/care ask declines — UNLESS it is plainly a program/curriculum
    // question (session, talk, topics, agenda, slides, schedule), which routes to normal retrieval.
    if (MED_ADVICE_RE.test(t)) return !MED_TALK_CONTEXT_RE.test(t);
    if (!MED_TOPIC_RE.test(t)) return false;         // no health vocabulary at all
    if (MED_PROGRAM_CONTEXT_RE.test(t)) return false; // program/event/portal context, in scope
    return MED_PERSONAL_RE.test(t);                  // health topic framed personally
}

// ---------- retrieval ----------
function entryKwSet(entry) {
    var bag = new Set();
    ['en', 'hr'].forEach(function (l) {
        tokenize(entry.kw[l] || '').forEach(function (w) { bag.add(w); });
    });
    return bag;
}
// One-edit tolerance for longer tokens — a single substitution, insertion, deletion, or ADJACENT
// TRANSPOSITION ("regsitrirati" ~ "registrirati") that the common-prefix check misses.
function oneEditApart(a, b) {
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    var min = Math.min(la, lb), i = 0;
    while (i < min && a[i] === b[i]) i++;
    if (i === min) return la !== lb; // identical up to length, one trailing char differs
    if (la === lb) {
        if (a.slice(i + 1) === b.slice(i + 1)) return true; // substitution
        return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2); // transposition
    }
    var s = la < lb ? a : b, l = la < lb ? b : a; // insertion / deletion
    return s.slice(i) === l.slice(i + 1);
}
// Score a query against every entry. Returns sorted [{entry, score, norm, hits, qlen, oov}], best
// first. hits = how many query tokens this entry matched (exact or fuzzy). oov = informative query
// tokens NO entry in the whole KB recognises — the off-topic signal ("dog", "wifi").
function scoreAll(question) {
    var qTokens = tokenize(question);
    if (!qTokens.length) return [];
    var qset = new Set(qTokens);
    var known = new Set();
    var results = FAQ_ENTRIES.map(function (entry) {
        var kw = entryKwSet(entry);
        var score = 0, hits = 0;
        qset.forEach(function (tok) {
            if (kw.has(tok)) { score += 2; hits += 1; known.add(tok); return; }
            // fuzzy: shared word-stem with a keyword — catches HR inflections (registriram ~
            // registrirati ~ registracija) and EN plurals/typos, without whole-word equality.
            var best = 0;
            kw.forEach(function (k) {
                if (k.length < 4 || tok.length < 4) return;
                if (k.indexOf(tok) === 0 || tok.indexOf(k) === 0) { best = Math.max(best, 1.5); return; }
                if (k.length >= 6 && tok.length >= 6 && oneEditApart(k, tok)) { best = Math.max(best, 1.5); return; }
                // common-prefix length — a long shared stem is the same word family (HR inflections)
                var n = Math.min(k.length, tok.length), p = 0;
                while (p < n && k.charCodeAt(p) === tok.charCodeAt(p)) p++;
                if (p >= 6) best = Math.max(best, 1.5);
                else if (p >= 5) best = Math.max(best, 1);
            });
            score += best;
            if (best > 0) { hits += 1; known.add(tok); }
        });
        // coverage-normalized, then priority nudge for flagship quick-facts
        var norm = score / Math.sqrt(qTokens.length);
        if (score > 0 && entry.prio) norm += entry.prio * 0.15;
        return { entry: entry, score: score, norm: norm, hits: hits, qlen: qTokens.length };
    }).filter(function (r) { return r.score > 0; });
    var oov = 0;
    qset.forEach(function (tok) {
        if (tok.length >= 3 && !/^\d+$/.test(tok) && !known.has(tok)) oov += 1;
    });
    results.forEach(function (r) { r.oov = oov; });
    results.sort(function (a, b) { return b.norm - a.norm; });
    return results;
}

// Render an answer template against resolved facts. Returns { text, ok } where ok=false when a
// referenced placeholder is unresolved (so the caller escalates instead of showing a blank).
function renderAnswer(entry, locale, facts) {
    var tmpl = (entry.a && (entry.a[locale] || entry.a.en)) || '';
    var ok = true;
    var text = tmpl.replace(/\{(\w+)\}/g, function (m, key) {
        var v = facts[key];
        if (v == null || String(v).trim() === '') { ok = false; return ''; }
        return String(v);
    });
    text = text
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([.,!?])/g, '$1')
        .replace(/\.\s*\.(?!\.)/g, '.') // collapse a doubled full stop (HR dates end in ".")
        .replace(/\.{2,}/g, '.')
        .trim();
    return { text: text, ok: ok };
}

// ---------- QPRICE subject gate ----------
// QPRICE keeps generic money words ("how much", "cost", "koliko", "kosta") in its keywords so it
// surfaces on a real ticket-price question. Those words ALONE must never quote ticket prices, though:
// "how much does a taxi cost" is not a registration question. QPRICE therefore also requires the money
// question to name a TICKET / REGISTRATION subject (ticket, registration, pass, entry, kotizacija,
// ulaznica...). A cost question whose subject is anything else (taxi, dinner, parking, abstract, hotel,
// flight) fails this gate and the caller hands off to the team instead of quoting prices.
const QPRICE_SUBJECT_RE = new RegExp('\\b(?:' + [
    // EN — the priced thing must be a ticket / registration subject, not a generic purchase
    'tickets?', 'registration', 'registrations', 'register', 'registering', 'admission',
    'entry', 'entrance', 'pass(?:es)?', 'seats?', 'delegate', 'attend(?:ance|ee)s?',
    'conference fee', 'registration fee', 'entry fee', 'day pass',
    // HR
    'ulaznic\\w*', 'kotizacij\\w*', 'karta', 'karte', 'kartu', 'registracij\\w*', 'prijav\\w*',
    'sjedal\\w*',
].join('|') + ')\\b', 'i');
function priceHasTicketSubject(text) {
    return QPRICE_SUBJECT_RE.test(deburr(String(text || '')));
}

module.exports = {
    ESC_TARGETS,
    buildFacts,
    scoreAll,
    renderAnswer,
    isMedicalQuestion,
    priceHasTicketSubject,
    FAQ_ENTRIES,
    _internal: { tokenize, deburr, fmtDate, fmtRange, euro },
};
