# Med&X User Portal — Per-Screen Inventory

Screen-by-screen implementation companion to `design/CONNECTIONS-MAP.md` and `design/IMPLEMENTATION_CONTRACT.md`.
Purpose: reimplement every screen 1:1 under the new design without re-reverse-engineering the old code.

**Captured:** 2026-08-10 against a local instance (scratch DB) of `user-portal/backend/server.js` + `user-portal/frontend/index.html`.
**Sources cross-checked:** `user-portal/frontend/index.html` (19,056 lines) + `assets/app.part1–14.js` (bulk of logic in `app.part9.js`, 53,672 lines).
**Screenshots:** `design/baseline-screens/<screen-id>_d.jpg` (1440px) and `<screen-id>_m.jpg` (390px), JPEG q80, viewport shots per scroll section (`_d2`, `_d3`… = further scroll sections of the same screen).

## Global contract (applies to every SPA screen)

- **Boot:** `UserPortal.init()` in `app.part9.js:3361`. Logged-in iff `localStorage.medx_user_token` holds a JWT; user object cached in `localStorage.medx_user_data`. A `?mxt=<token>` URL param is swallowed into `medx_user_token` on load (index.html:54). `?register=<token>` and `?invite=<data>` bypass the portal entirely (direct-registration takeover, `GET/POST /api/register-direct/:token`).
- **Auth header:** `UserPortal.api()` sends `Authorization: Bearer <token>` + JSON content type, 30s abort timeout.
- **Navigation:** `UserPortal.showSection(id)` toggles `.up-section.active` on `#up-section-<id>`, pushes `#<id>` to history; popstate/hash restores it. Sections: `dashboard, plexus, gala, accelerator, forum, af26, network, talks, mymedx, rewards, bridges, speaker, settings` (titles map `sectionTitles`, app.part9.js:3346). Every navigation fires a page-view beacon `POST /api/public/pv` with `/portal/<section>`.
- **Boot API burst (every reload):** `GET /api/project-status, /api/auth/me, /api/me/locale, /api/member/meta, /api/member/profile-nudge, /api/member-card-visibility, /api/registrations/my, /api/rewards/summary, /api/feed/home, /api/forum/wing/me, /api/user-notifications(?placement=homepage|both&limit=10), /api/announcements, /api/user/admin-messages, /api/notify-topics, /api/portal-content/published(+/featured), /api/plexus/{settings,cme/status,speakers,sessions,stats,stripe-config,qa}, /api/accelerator/{my-applications,countdown,key-dates?year=…,overview-config,institutions,sites}, /api/networking/{discover,coffee-match}`.
- **Top bar (desktop):** logo → dashboard · Home · Projects ▾ (`UserPortal.toggleProjectsMenu()`) · Network · Talk Library · My Med&X · Website ↗ (external) · search (`GlobalSearch.open()`, ⌘K) · bell (`UserPortal.toggleNotifications()`) · EN/HR locale pills (persist `localStorage.medx_locale` + `PUT /api/me/locale` semantics via profile) · avatar (`UserPortal.toggleAccountMenu()`).
- **Floating buttons (bottom-right):** Alan AI chat bubble (`AlanAI.toggle()`), QR check-in (`showQuickQR()`, `#floatingQRBtn`), help "?" (`ContactForm.toggle()`). Mobile adds a bottom tab bar (`MedXBottomNav`) synced by `showSection`, and a float-nav (`#upFloatBack`, `UserPortal.toggleFloatNav()`).
- **Quiet-member gate:** `MedXQuiet.allowPlayful()` — quiet profiles are hard-redirected away from `rewards` even via deep link (showSection line 4413).
- **Theme:** `SettingsPortal.setTheme` → `localStorage.medx_theme` (`light|dark|system`).
- **Key localStorage keys (user-portal side):** `medx_user_token`, `medx_user_data`, `medx_locale`, `medx_theme`, `medx_onboarding_completed`, `plexus_registration_id`, `plexus_registered`, `plexus_my_schedule`, `plexus_interested`, `mymedx_interests` (via `mymedx`), `medx_notify_topics` (notify-bell cache — single source of truth for the hub bell), `medx_accelerator_applications`, `ax_application_draft`, `bb_applications_*`, `forum_registered_events`, `medx_speaker_data`, `medx_speaker_prefs`, `medx_rewards_last_balance`, `pwa_install_dismissed`.
- **Payments:** all checkouts go through Stripe Checkout sessions (`POST /api/{plexus,gala,accelerator}/checkout-session`, `POST /api/forum/events/:id/checkout-session`) → redirect off-site; success/cancel return to server pages (`/invite-success`, `/invite-cancelled`).

---

# A. Global chrome (logged-in overlays)

## chrome-search — Global search overlay
| | |
|---|---|
| Reach | ⌘K / Ctrl+K, magnifier in top bar, or float-nav search → `GlobalSearch.open()` |
| Shots | `chrome-search_d.jpg`, `chrome-search_m.jpg` (query "plexus" typed) |
| API | `GET /api/member/search?q=<query>` per keystroke (debounced); results mixed with client-side section/talk index |
| Root el | `#upSearchOverlay` (role=dialog), input `#upSearchInput` |
| Actions | result rows → `GlobalSearch._go(i)` (navigates to section/talk/registration); Esc closes |

## chrome-notifications — Notifications panel
| | |
|---|---|
| Reach | bell icon → `UserPortal.toggleNotifications()` |
| Shots | `chrome-notifications_d.jpg`, `chrome-notifications_m.jpg` |
| API on open | `GET /api/user-notifications`, `GET /api/announcements` |
| Actions | "Mark all read" → `UserPortal.markAllNotificationsRead()` → `PUT /api/user-notifications/mark-all-read`; row click → `PUT /api/user-notifications/:id/read` then navigates `notif.link` (sets `location.hash`) |
| Root el | `#upNotificationsPanel` (display:flex/none toggled inline) |

## chrome-account-menu — Avatar dropdown
| | |
|---|---|
| Reach | avatar (top-right) → `UserPortal.toggleAccountMenu()` |
| Shots | `chrome-account-menu_d.jpg`, `chrome-account-menu_m.jpg` |
| Items | name + email header · My Med&X → `showSection('mymedx')` · Rewards (live points badge from `/api/rewards/summary`) → `showSection('rewards')` · Edit profile → `showSection('settings')` · Settings → `showSection('settings')` · Notifications → toggleNotifications · Install app → `MedXInstall.trigger()` · Sign out → `UserPortal.logout()` (clears `medx_user_token`/`medx_user_data`, `?logout=true` also honored) |

## chrome-projects-menu — "Projects" nav dropdown
| | |
|---|---|
| Reach | top nav "Projects ▾" → `UserPortal.toggleProjectsMenu()` |
| Shots | `chrome-projects-menu_d.jpg`, `chrome-projects-menu_m.jpg` |
| Items | Plexus Conference, Gala Evening, Accelerator, Biomedical Forum, Building Bridges, Annual Forum 2026 → each `UserPortal.showSection(...)` |

## chrome-help-modal — Help modal
| | |
|---|---|
| Reach | dashboard quick link "Help" → `UserPortal.openHelp()`; close `UserPortal.closeHelp()`/Esc |
| Shots | `chrome-help-modal_d.jpg`, `chrome-help-modal_m.jpg` |
| Form | `#helpModal`: `helpType` (select), `helpMessage` (textarea, required) → `UserPortal.sendHelpMessage(event)` |
| ⚠ Contract | **client-side only** — no API call; shows a success toast. Redesign decision needed: wire to a real endpoint or keep. |

## chrome-contact-form — Contact Support slide-in
| | |
|---|---|
| Reach | floating "?" button (bottom-right) → `ContactForm.toggle()` (also footer "Contact" links) |
| Shots | `chrome-contact-form_d.jpg`, `chrome-contact-form_m.jpg` (also visible in `chrome-quickqr_d.jpg`) |
| Form | `#contactForm`: `contactEmail` (email, prefilled from user), `contactSubject` (select: General Inquiry/…), `contactMessage` (textarea, 500 max, counter) → `ContactForm.submit(event)` |
| ⚠ Contract | **client-side only** — validates, then success toast "Message sent!"; no API call. |

## chrome-quickqr — Quick check-in QR modal
| | |
|---|---|
| Reach | floating QR button `#floatingQRBtn` → `showQuickQR()`; dashboard hero "Check in" button |
| Shots | `chrome-quickqr_d.jpg`, `chrome-quickqr_m.jpg` |
| Content | member QR (crimson-bordered dark modal): "MED&X MEMBER", QR image (`/qr/:registrationId.png` when registered, else member id), name, tier, "Save QR" download. No API beyond the QR image GET. |

## chrome-alan-ai — "Alan" AI assistant chat
| | |
|---|---|
| Reach | gold chat bubble (bottom-right) → `AlanAI.toggle()` |
| Shots | `chrome-alan-ai_d.jpg`, `chrome-alan-ai_m.jpg` |
| Elements | quick-question chips (`AlanAI.askQuick(...)`), input + send (`AlanAI.send()`), close (`AlanAI.toggle()`) |
| ⚠ Contract | **fully client-side** — canned keyword-matched answers from an inline `knowledge` object (app.part9.js:5366). No API. |

---

# B. SPA sections

## spa-dashboard — Home / member hub
| | |
|---|---|
| Route | `#dashboard` (default). Init: `Dashboard.init()` + `QuizSystem.init()` (quiet-gated) + `HubEvents.render()` + `MemberFeed.load()` + `MedXProfileNudge.render()` |
| Shots | `spa-dashboard_d.jpg` … `_d4.jpg`, `spa-dashboard_m.jpg` … `_m3.jpg` |
| API on load | (boot burst, above) + `GET /api/rewards/summary`, `GET /api/feed/home`, `GET /api/member/profile-nudge` |

Layout blocks top→bottom: hero "Good afternoon, {first}" with next-event card (from `/api/registrations/my`; PAID chip, countdown) · profile-completeness nudge banner · "01 Your projects" project cards row · quick links · "Latest from Med&X" feed · network promo.

| Interactive | Action |
|---|---|
| Show ticket / My Med&X / Event tickets | `showSection('mymedx')` |
| Add to calendar (hero) | `medxICS(MedXNextEvent._reg)` → client-built .ics download |
| Check in (hero) | `showQuickQR()` |
| Project card (Plexus/Gala/Accelerator/Forum/Bridges) | `MedXProjectHub.go('<key>')` → showSection; card bell → `MedXProjectHub.toggle('<key>',this)` → `POST /api/notify-topics {project, on}` |
| Profile nudge "Add a photo" / × | `MedXProfileNudge.addPhoto()` (→ settings photo upload) / `.dismiss()` |
| Feed items | `MemberFeed.open('<project>')` → showSection; "See all" → `MemberFeed.viewAll()` |
| Quick links | Member directory→network · Event tickets→mymedx · Opportunity board→forum · Forum eligibility→forum · Help→`UserPortal.openHelp()` |

Load-bearing: `#up-section-dashboard`, `#hubWelcomeSection`, `#forYouSection`, `#newsWidget`, `medx_notify_topics` cache drives every project-card bell state.

## spa-plexus — Plexus Conference (tabbed mini-portal)
| | |
|---|---|
| Route | `#plexus`; init `PlexusPortal.init()`. Tab state via `PlexusPortal.showTab(t)`, t ∈ `overview, myplexus, register, abstract, schedule, speakers, city, connect, live` |
| Shots | `spa-plexus_d.jpg`…`_d4.jpg`, `spa-plexus_m.jpg`,`_m2.jpg` (overview, registered state "YOU'RE GOING") |
| API on load | `GET /api/plexus/{settings,cme/status,speakers,sessions,stats,stripe-config,qa}`, `GET /api/registrations/my`, `GET /api/member/meta` |

Overview tab: hero (notify toggle `MedXNotify.toggle('plexus')` → `POST /api/notify-topics`), tab bar, Conference Guide (booklet `PlexusPortal.downloadWelcomeBooklet()`/`openWelcomeBooklet()`), My Badge (`downloadBadgeAsImage()`, `printBadge()`, `addToAppleWallet()`), Quick Access, My Package, "Who from your network attends", Pre-Event Checklist (`PrepChecklist.toggle(id)` items: profile/schedule/network/download/travel; state in `medx_prep_checklist`), My Schedule, Add-to-Calendar dropdown (`EventCalendar.addTo('google'|'outlook'|'apple'|'ics')` — client-built links/ICS), support links: Request Refund / Apply for Scholarship / Request Visa Letter / Transfer to a colleague (open the four modals below), `ContactForm.toggle()`.

### spa-plexus-register — Registration wizard (3 steps)
Shots: `spa-plexus-register_d.jpg`…`_d3`, `_m`,`_m2` (step 1 "Choose Your Pass"), `spa-plexus-register-step1sel_d/m.jpg` (pass selected + package builder), `spa-plexus-register-step2_d/m(+2).jpg`, `spa-plexus-register-step3_d/m(+2,3).jpg`.

- **Step 1 – Build Package:** pricing cards (Student/Professional × Early Bird/Regular, €39/59/99/149 from `/api/plexus/settings`) → `PlexusPortal.selectPricingCard(el, tierId)`; package add-ons (`togglePackageOption(this)`, `data-item`/`data-price`: Day 1, Day 2, Welcome Reception…); Continue → `nextStep()` (blocks without `selectedPricing`). Stepper `#regStepper`, panels `#px-wizard-step-{1,2,3}`, step markers `.px-wizard-step[data-step]`.
- **Step 2 – Your Info:** `pxRegFirstName`*, `pxRegLastName`*, `pxRegEmail`* (validated), `pxRegInstitution`, `pxRegCountry` (select), `pxRegDiet` (select), `pxRegAccessibility` (textarea, 2000). CME section `#pxCmeSection` (chamber-accredited events only): `pxCmeConsent` checkbox gates `pxCmeDob` + `pxCmeOib` (11-digit OIB, ISO 7064 check).
- **Step 3 – Billing & Payment:** `pxBillingName, pxBillingCompany, pxBillingAddress, pxBillingCity, pxBillingZip, pxBillingCountry, pxBillingOIB` (11 digits, check-digit validated), `pxBillingVAT`, `pxBillingEmail`; coupon `pxCouponInput` → `applyCouponCode()`; rewards-points redeem slider (`togglePointsRedeem`/`updateRedeemSlider`); payment method `selectPaymentMethod('card'|'bank')` (`switchToBankTransfer`); legal links → `UserPortal.showLegalModal('terms'|'privacy'|'refund')`.
- **Submit:** `PlexusPortal.submitRegistration()` (`#pxSubmitRegBtn`) → `POST /api/plexus/register` with idempotency key; payload `{first_name,last_name,email,institution,country,pricing,package_items,payment_method,total,subtotal,points_redeemed,points_discount,coupon_discount,dietary,accessibility,coupon,event:'plexus-2026',billing:{name,company,address,city,zip,country,oib,vatNumber,email}|null}` → then `POST /api/plexus/checkout-session {registration_id}` → Stripe redirect (or bank-transfer instructions + `GET /api/plexus/registration/:id/invoice`). Stores `plexus_registration_id`/`plexus_registered`.

### spa-plexus-abstract — Submit Abstract
Shots: `spa-plexus-abstract_d(+2,3)/m(+2).jpg`. Fields: `pxAbstractTitle` (200), `pxAbstractCategory` (select), `pxAbstractType` (select oral/poster), dynamic co-author rows (name + institution), `pxAbstractText` (textarea w/ word counter), file upload (PDF). Submit `PlexusPortal.submitAbstract()` → `POST /api/plexus/abstracts` then `POST /api/plexus/abstracts/:id/files` (or `POST /api/upload/abstracts`). My abstracts: `GET /api/abstracts/my` (server).

### spa-plexus-schedule / -speakers / -city / -connect / -live / -myplexus
Shots: `spa-plexus-<tab>_d(+…)/m(+2).jpg`.
- **schedule:** sessions from `/api/plexus/sessions`; day toggle `toggleScheduleView`; per-session bookmark `toggleAttendSession` + "save to My Schedule" `saveSelectionToMySchedule()` → `localStorage.plexus_my_schedule`; per-session `POST/DELETE /api/plexus/my-schedule/:sessionId`, `POST/DELETE /api/schedule/:sessionId` (server).
- **speakers:** cards from `/api/plexus/speakers`; filter `setSpeakerFilter`; modal `showSpeakerModal`/`closeSpeakerModal`; keynote bios `showKeynoteBio`.
- **city:** static Explore Zagreb content.
- **connect:** `GET /api/plexus/attendees` (attendee list, connect CTAs into Network section).
- **live:** live day switcher `showLiveDay`, Q&A feed `GET/POST /api/plexus/qa` (also polled globally), venue map `openVenueMap()`, check-in `POST /api/plexus/checkin`.
- **myplexus:** registered-member hub (badge, package, checklist — same blocks as overview when registered).

### Plexus support modals (desktop shots only)
| Screen | Fields → submit |
|---|---|
| `spa-plexus-modal-refundrequest` | `refundReason` (select), `refundDetails` (textarea) → `submitRefundRequest()` → `POST /api/plexus/registration/:id/refund-request` |
| `spa-plexus-modal-scholarship` | `scholarshipType` (career stage select), `scholarshipStatement`, `scholarshipCountry` → `submitScholarship()` → `POST /api/plexus/scholarship {institution,country,career_stage,financial_need_statement,research_statement,amount_requested}` |
| `spa-plexus-modal-visarequest` | `visaFullName, visaPassportNo, visaNationality, visaEmbassy, visaNotes` → `submitVisaRequest()` → `POST /api/plexus/visa-request {passport_name,passport_number,nationality,embassy_city,…}` |
| `spa-plexus-modal-tickettransfer` | `transferName, transferEmail, transferReason` → `submitTicketTransfer()` → `POST /api/plexus/registration/:regId('current')/transfer {new_user_name,new_user_email,reason}` |

All four are plain `display:flex` overlay divs by id (`#refundRequestModal`, `#scholarshipModal`, `#visaRequestModal`, `#ticketTransferModal`).

## spa-gala — Gala Evening 2026
| | |
|---|---|
| Route | `#gala`; init `GalaPortal.init()`. Tabs `GalaPortal.showTab(t)`, t ∈ `overview, speakers, schedule, register` |
| Shots | `spa-gala_d.jpg`…`_d3`, `spa-gala_m(+2).jpg` (overview) · `spa-gala-speakers_d(+2,3)/m(+2)` · `spa-gala-schedule_d(+2,3)/m(+2)` · `spa-gala-register_d(+2,3)/m(+2)` |
| API on load | `GET /api/gala/settings`, `GET /api/gala/my-status` (mymedx also pulls `GET /api/gala/my`, `GET /api/gala/my-seat`) |

Overview: hero (notify `MedXNotify.toggle('gala')`), Reserve Your Seat → register tab, View the Evening Program → schedule tab, Add to Calendar → `/calendar/gala.ics` (server ICS), featured performers, about/why-attend, gallery.

**Register tab:** captured in confirmed state ("Ticket Confirmed!" — current user approved+paid). Unregistered form (source, app.part9.js:12100+): first/last/email + `galaInstitution`, `galaTitle`, `galaDietary`, `galaRequests`, pricing selection → `POST /api/gala/register {first_name,last_name,email,institution,title,dietary,requests,pricing,event:'gala-2026',status:'pending_approval'}`. Flow is **request → admin approval → payment**: on approval `POST /api/gala/checkout-session {registration_id}` → Stripe (see gala approval flow). Seat shown from `/api/gala/my-seat`.

## spa-accelerator — Med&X Accelerator
| | |
|---|---|
| Route | `#accelerator`; init `AcceleratorPortal.init()`. Tabs `showTab(t)`, t ∈ `overview, institutions, intake, apply, myapplications, results` (nav labels: Overview / Labs & Clinics / Apply / Placements / My Applications / Results — NOTE: "Apply" opens `intake`, "Placements" opens `apply`) |
| Shots | `spa-accelerator_d(+2,3)/m(+2)` (overview, countdown hero) · `-institutions_d(+2,3)/m(+2)` · `-intake_d(+2,3)/m(+2)` · `-apply_d(+2,3)/m(+2)` (application wizard step 1) · `-apply-step2…7_d/m` · `-myapplications_d(+2,3)/m(+2)` · `-results_d(+2,3)/m(+2)` |
| API on load | `GET /api/accelerator/{my-applications,countdown,key-dates?year=2026,overview-config,institutions,sites}` |

Overview: countdown hero (Apply Now → intake, View Institutions), About / Application Process / Required Documents (`toggleRequiredDocs()`), Timeline, What's Included, Meet the Team, FAQ accordions (`toggleFaq(this)`), `askCoordinator()` → `POST /api/accelerator/ask-coordinator`, mailto accelerator@medx.hr, socials.

- **institutions (Labs & Clinics):** cards from `/api/accelerator/institutions` + `/api/accelerator/sites`; compare tray (`showComparison()` / `clearComparison()`).
- **intake ("Apply"):** pre-launch state = "Applications open in November 2026" + interest form → `GET /api/accelerator/intake`, `GET /api/accelerator/intake/mine`, `GET /api/notify-topics`; save draft `POST /api/accelerator/intake/draft`, submit `POST /api/accelerator/intake/`, notify `POST /api/notify-topics {project:'accelerator',on:true}`. When the window opens this tab hosts the live intake wizard (`totalSteps: 3`, `#axiStepNum`).
- **apply ("Placements") — 7-step application wizard.** Stepper `.ax-wizard-step[data-step=1..7]`, panels `#ax-wizard-step-1..7`; `nextStep()`/`prevStep()`/`saveDraft()` (draft → `localStorage.ax_application_draft`); validation per step (app.part9.js:13332).
  | Step | Fields |
  |---|---|
  | 1 Personal | `axFirstName`* `axLastName`* `axEmail`* `axPhone` `axDob`* (date) `axNationality` `axCountry` (select) |
  | 2 Education | `axInstitution`* `axDegree`* (select) `axYear`* (select) `axField`* `axGraduation` (month) |
  | 3 Program | `axChoice1`* `axChoice2` `axChoice3` (institution selects, must be distinct) `axResearchInterests`* (textarea) |
  | 4 Supplementary | `axStatement`* (personal statement) `axExperience` `axPublications` (textareas) |
  | 5 Documents | `axCvFile`* (.pdf) `axTranscriptFile` (.pdf) `axRecFile` (.pdf) |
  | 6 Consent | `axConsent1` `axConsent2` `axConsent3` (checkboxes; GDPR) |
  | 7 Review | read-only summary (`updateReview()`, `#axReviewDocs`) → `submitApplication()` |
  Submit → `POST /api/accelerator/applications` `{first_name,last_name,email,phone,date_of_birth,nationality,country_of_residence,current_institution,degree_program,year_of_study,program_type,selected_institution,alternative_institution,previous_experience,special_arrangements,gdpr_consent:true,status:'submitted',submitted_at}` then document upload `POST /api/accelerator/applications/:id/documents` / `POST /api/upload/accelerator`; local mirror in `medx_accelerator_applications`. Payment step (when fees apply): `POST /api/accelerator/checkout-session`.
- **myapplications:** list from `GET /api/accelerator/my-applications` (empty state captured); per-app docs `GET /api/accelerator/applications/:id/documents`, messages `POST /api/accelerator/applications/:id/message`, doc checklist state `medx_ax_doc_checklist_*`.
- **results:** lookup input `axResultsCode` (placeholder `AX26-XXXX`, max 9) → `GET /api/accelerator/results?code=…`.

## spa-forum — Biomedical Forum (invite gate + member area)
| | |
|---|---|
| Route | `#forum`; init `ForumPortal.init()`. Gate → member area via invite code; verified flag in `sessionStorage.medx_forum_verified` |
| Shots | gate: `spa-forum_d(+2)/m(+2)` · member area: `spa-forum-member-home_d(+…4)/m(+2)`, `-events`, `-network`, `-projects`, `-profile` (each `_d(+2,3)/m(+2)`) |
| API | `GET /api/forum/wing/me` on load. Member events: `GET /api/forum/events/:id`, register `POST /api/forum/events/:id/register`, pay `POST /api/forum/events/:id/checkout-session`; opportunity board `POST /api/forum/opportunities` |

**Gate screen:** "Invitation Required" — input `#fmInviteCode` + verify (`ForumPortal.verifyInviteCode()`); "Enter the Forum →" links to server wing `/forum`; "Try Demo Mode" fills `MEDX2026`. ⚠ **Client-side only check:** valid codes hardcoded `['MEDX2026','FORUM2026','BIOMEDICAL','MEMBER']` (app.part9.js:14783+); no API. Concierge modal: `fmConciergeSubject` (select) + `fmConciergeMessage` → `submitConciergeRequest()` = **mailto:forum@medx.hr compose only**.

**Member area** (`#fmInviteRequired` hidden, `#fmMemberArea` shown): tabs `ForumPortal.switchTab(t)`, t ∈ `home, events, network, projects, profile`:
- home: welcome header (`#fmWelcomePhoto`), member search `fmSearchMembersPremium`, concierge.
- events: All Events timeline; register per event `registerEvent(eventId, btn)` (tracks `forum_registered_events`/`_data`, interested `forum_interested_events`); details `toggleEventDetails`.
- network: My Network; sub-tabs `switchNetworkTab('browse'|'connections'|'discover'|'requests')`; universal search `fmUniversalSearch`; filters `fmFilterCountry/Continent/Field/Sector`; per-member `connectMember`, `messageMember`, `openDirectoryProfile`; view toggle `setNetworkView`.
- projects: project interest board (`forum_project_interests`, `toggleInterest`).
- profile: `fmProfileFirstName/LastName/Title/Institution/Specialty/Bio/LinkedIn/Expertise` + `fmProfileCoffeeChats`/`fmProfileCollaborators` checkboxes; `uploadPhoto()`; saved to `localStorage.medx_forum_profile` (client-side).

## spa-af26 — Annual Biomedical Forum 2026
| | |
|---|---|
| Route | `#af26`; init `AF26Portal.init()` |
| Shots | `spa-af26_d(+2)/m(+2)` · RSVP stepper `spa-af26-register-modal_d(+2)/m(+2)` |
| Content | hero (Register Now → `AF26Portal.showRegistration()`, View Schedule → `scrollToSchedule()`), Evening Schedule, Featured Speakers, contact forum@medx.hr |

**RSVP flow:** inline 3-step stepper (Event Details → Registration → Confirmed), not a modal. Form `#af26RegistrationForm` → `AF26Portal.submitRegistration(event)`: `af26FirstName`* `af26LastName`* `af26Email`* `af26Title` `af26Institution` + dietary fields → `POST /api/af26/register {firstName,lastName,email,title,institution,dietary,dietaryNotes,…}`.

## spa-network — My Network
| | |
|---|---|
| Route | `#network`; init `NetworkingPortal.init()`. Tabs `showTab(t)`, t ∈ `discover` (People), `requests`, `messages`, `profile` (My Card) |
| Shots | `spa-network_d(+2,3)/m(+2)` (People) · `spa-network-requests_d(+2)/m(+2)` · `spa-network-messages_d(+2)/m(+2)` · `spa-network-profile_d(+2)/m(+2)` · member modal `spa-network-member-modal_d.jpg` |
| API on load | `GET /api/networking/discover`, `GET /api/networking/coffee-match` |

- **People (discover):** search `#networkSearch` (name/institution/city/specialty) + filters `#filterSpecialty #filterCountry #filterCity` (+3 more selects); view toggle `setDiscoverView('list'|'city')`; "New and featured members" rail; member cards → `viewProfile(id)` (modal), `sendConnectionRequest(id)` → `POST /api/networking/connections` (also `POST /api/connections/request`), `messageConnection(id,name)` → messages tab. Coffee-match banner from `/api/networking/coffee-match`.
- **requests:** `GET /api/networking/connections/pending` + `GET /api/networking/meeting-requests`; accept/decline → `PUT /api/networking/connections/:id {status:'accepted'}` / `PUT /api/networking/meeting-requests/:id {status}`; empty state captured (0 requests). Meeting request compose → `POST /api/networking/meeting-requests`.
- **messages:** thread list `GET /api/messages`; conversation `GET /api/messages/:userId` (polled `pollCurrentChat`); send `POST /api/messages {content}` (+ `PUT /api/messages/:userId` mark-read). Admin messages surface here too: `GET /api/user/admin-messages`, reply `PUT /api/user/admin-messages/:id/reply`, read `PUT …/:id/read`. Empty state captured. |
- **profile (My Card):** preview card + `#networkingProfileForm`: `npCareerStage npLookingFor` (selects), `npResearchInput` (tag input), `npWorkingOn` (textarea), `npTimezone npMeetingFormat` (selects), `npCoffeeChats npCoffeeMatchmaker npLookingCollaborators` (checkboxes) → `PUT /api/networking/profile`; mirror in `localStorage.networkingProfile`. "Edit Profile" deep-links to Settings profile tab.
- **member modal:** profile detail + Connect (optional `connectMessage` textarea) → `POST /api/networking/connections`; Message → messages tab.

## spa-talks — Talk Library
| | |
|---|---|
| Route | `#talks`; init `TalkLibrary.init()` |
| Shots | `spa-talks_d(+2)/m(+2)` |
| API on load | `GET /api/talks` |

Filter chips: All sessions / Top rated / years (2015–2025) / event collections (Plexus 2025/2024/2023, Sleep science, Frontiers of biomedicine) → `TalkLibrary.setFilter(kind, value)`. Cards grouped by collection; card click → `TalkLibrary.play(url)` (YouTube embed; placeholder `#placeholder` = "Coming soon" toast). Per-card 5-star rating → `TalkLibrary.rate(talkId, n, event)` → `POST /api/talks/:id/rating {rating}`.

## spa-mymedx — My Med&X (passport, tickets, wallet, record)
| | |
|---|---|
| Route | `#mymedx`; init `MyMedXPortal.init()` |
| Shots | `spa-mymedx_d(+2,3)/m(+2)` (Passport view) · `spa-mymedx-card_d(+2)/m(+2)` (Card view) · `spa-mymedx-present-ticket_d/m` (full-screen ticket) · `spa-mymedx-guestpass-modal_d.jpg` |
| API on load | `GET /api/my/events`, `/api/gala/my`, `/api/gala/my-seat`, `/api/registrations/my`, `/api/member/passport`, `/api/auth/me`, `/api/rewards/summary`, `/api/member/record`, `/api/guest-passes`, `/api/member/giving`, `/api/plexus/cme/my` |

Blocks: **Passport | Card** toggle (membership passport vs. printable member card; card consent `POST /api/member/card-consent`) · Download membership card (`downloadMembershipCard()`) · **Wallet:** Add to Google Wallet → `GET /api/member/wallet/google`; Add to Apple Wallet → `addToAppleWallet()` (`GET /api/member/wallet/apple/…`) · Med&X Wrapped ("Create your card" → `openWrapped()` → `GET /api/member/wrapped`) · verify/share: `copyVerifyLink()` → `GET /api/member/verify-link`; `addToLinkedIn()`; `shareRecord()` → `GET /api/member/share-record-link` · Rewards teaser → `showSection('rewards')`.

**My events / tickets:** per registration — Ticket link → `/qr/:registrationId.png` · Calendar → `/calendar/plexus.ics` · `addToCalendar(i)` · `downloadTicket(i)` (PNG) · `saveTicketPdf(i)` · `openPresentMode(i)` (full-screen brightness QR; captured) · ticket wallet: `GET /api/member/wallet/google/ticket/:id`, `GET /api/member/wallet/apple/ticket/:id`.
**My projects:** status chips → respective sections. **Bring a colleague:** `GuestPass.open('plexus'|'bridges')` modal ← `GET /api/guest-passes` (create/share guest passes). **Past purchases:** `openPurchaseInquiry(i,'question'|'refund')` → `POST /api/purchases/inquiry {registration_id,kind,message}`. **My Interests:** chips add/remove (`addInterest()`/`removeInterest(name)`) → `localStorage.mymedx_interests`. **CME:** from `/api/plexus/cme/my`. **Giving:** from `/api/member/giving`. Founder welcome (first visit): `GET /api/member/founder-welcome`, dismiss `POST /api/member/founder-welcome/seen`.

## spa-rewards — Med&X Rewards
| | |
|---|---|
| Route | `#rewards`; init `RewardsPortal.init()`. ⚠ Quiet members are redirected to dashboard |
| Shots | `spa-rewards_d(+2)/m(+2)` |
| API | `GET /api/rewards/summary` (balance, history); redeem tier → `POST /api/rewards/redeem {tier}` (button disabled/"Locked" until threshold; state 200 pts captured) |

Sections: points hero, How you earn, Redeem (tier cards), Your codes, History. Points are awarded via `RewardsPortal.awardActivityPoints(action)` hooks all over the app (profile completion, connections…). `localStorage.medx_rewards_last_balance` caches the header badge.

## spa-bridges — Building Bridges
| | |
|---|---|
| Route | `#bridges`; init `BuildingBridgesPortal.init()`. Tabs `showTab(t)`, t ∈ `overview, upcoming, past, speakers, program, apply, myevents` |
| Shots | `spa-bridges_d(+2,3)/m(+2)` · `-upcoming`, `-past`, `-speakers`, `-program`, `-apply`, `-myevents` (each `_d(+…)/m(+2)`) |
| API | overview/upcoming: `GET /api/bridges/events` · speakers: `GET /api/bridges/speakers` · program: `GET /api/bridges/program` · myevents: `GET /api/guest-passes` |

Overview: mission, Event Cities, Who Can Apply, Event Format, per-event "Apply Now" → `applyToEvent('zurich-2026')` (→ apply tab with event preselected), notify toggle `MedXNotify.toggle('bridges')`, contact bridges@medx.hr.
**Apply tab form:** name, email, institution, title, motivation → `POST /api/bridges/apply {event_id,name,email,institution,title,motivation}` (per-event registration variant: `POST /api/bridges/events/:id/register`). Local application state in `localStorage.bb_applications_*`. **My events:** registered Bridges events + guest passes (`GuestPass.open('bridges')`).

## spa-speaker — Speaker Portal (code-gated)
| | |
|---|---|
| Route | `#speaker`; init `SpeakerPortal.init()` |
| Shots | `spa-speaker_d.jpg`, `spa-speaker_m(+2).jpg` (gate) |
| Gate form | `#spInviteCode` (required, placeholder `SPK-XXXX-2026`, max 20) → `SpeakerPortal.verifyInviteCode(event)` → `POST /api/speakers/auth {code}`; on success loads `GET /api/speakers/:code` and caches `localStorage.medx_speaker_data` + `medx_speaker_prefs` ("Having trouble? Click to reset" clears both) |
| Beyond gate | speaker dashboard: itinerary, talk details, document upload `POST /api/speakers/:code/documents` / delete `DELETE /api/speakers/:code/documents/:docId` — **not captured** (no valid speaker code with itinerary in scratch DB; DB has demo code `SPK-XWK8-2026` but no itinerary rows) |

## spa-settings — Settings (5 tabs)
| | |
|---|---|
| Route | `#settings`; init `SettingsPortal.init()`. Tabs `showTab(t)`, t ∈ `profile, account, notifications, appearance, privacy`. "Edit profile" everywhere lands on `profile` |
| Shots | `spa-settings_d(+2)/m(+2)` (Profile) · `spa-settings-account_d(+2,3)/m(+2)` · `-notifications` · `-appearance` · `-privacy` (each `_d(+…)/m(+2)`) |

- **profile:** Membership summary card + Profile Information form: `settingsFirstName settingsLastName settingsInstitution settingsTitle settingsSpecialty settingsCountry settingsBio settingsLinkedIn`; photo `uploadPhoto()` (FileReader → dataURL) / `removePhoto()`; submit `saveProfile(e)`. ⚠ **Saves to `localStorage.medx_user_data` ONLY — explicit `// TODO: Send to backend API` in source (app.part9.js:23882).** Completing profile awards rewards points (`medx_profile_complete_<email>` flag).
- **account:** `#passwordSettingsForm`: `settingsCurrentPassword settingsNewPassword settingsConfirmPassword` → `changePassword(event)` → `POST /api/auth/change-password {currentPassword,newPassword}` · 2FA toggle `#settings2FA` (client-side, `medx_2fa_enabled` + recovery codes in `medx_2fa_recovery_codes`) · Log Out All Devices → `logoutAllDevices()` · Delete Account → `deleteAccount()` → `DELETE /api/auth/account`.
- **notifications:** Push master toggle `#settingsPushToggle` → `GET /api/push/vapid-key` + `POST /api/push/subscribe` / `DELETE /api/push/unsubscribe` (service worker `sw.js`) · email topic checkboxes `notifPlexus notifAccelerator notifForum notifConnections notifMessages notifNewsletter` (persist client-side `medx_notification_settings`).
- **appearance:** Install app (`MedXInstall.trigger()`) · Theme Light/Dark/System → `setTheme` (`medx_theme`) · Display: `settingsCompactMode`, `settingsReduceAnimations` (client-side `medx_display_settings`).
- **privacy:** `privacyShowDirectory privacyShowEmail privacyAllowConnections privacyAllowMessages` → `savePrivacy()` → `localStorage.medx_privacy_settings` (client-side) · Download My Data → `downloadData()` → `GET /api/auth/my-data` (JSON download) · links open `/privacy`, `/terms`.

---

# C. Logged-out screens (SPA, no `medx_user_token`)

## out-landing — Marketing landing
| | |
|---|---|
| Route | `/` with no token |
| Shots | `out-landing_d.jpg` (single viewport; page does not scroll) · `out-landing_m(+2,3).jpg` |
| API | `GET /api/project-status` only |
| Elements | med&X wordmark, "MED&X MEMBER PORTAL / Connecting biomedicine's next generation", **Get Started** → `UserPortal.openLoginModal()`, **Create Account** → `UserPortal.openRegisterModal()`, EN/HR pills, floating QR + "?" buttons |
| Note | legacy `#landingPage` (index.html:692) and `#loginPage` (11729) markup exist but stay `display:none`; the live logged-out surface is this hero + the two auth modals (`#loginModal`, `#registerModal`) |

## out-login-modal — Sign in
| | |
|---|---|
| Reach | Get Started → `UserPortal.openLoginModal()` |
| Shots | `out-login-modal_d.jpg`, `out-login-modal_m.jpg` |
| Fields | `#userLoginEmail` (email), `#userLoginPassword` (password), error div `#userLoginError` |
| Actions | **Sign In** `#userLoginBtn` → `UserPortal.login()` → `POST /api/auth/login {email,password}` → stores `medx_user_token` + `medx_user_data`, boots portal. ⚠ endpoint is rate-limited — never script real submissions. · **Demo Login (Quick)** `#demoLoginBtn` → `UserPortal.demoLogin()` · biometric section `#biometricLoginSection` → `loginWithBiometrics()` (WebAuthn; `medx_biometric_enabled`/`_email`) · Forgot password? `#userForgotPwLink` → `openForgotPassword()` · unverified-email path shows `#resendVerificationSection` → `resendVerification()` → `POST /api/auth/request-verification` · "Create one" → `switchToRegister()` |

## out-register-modal — Create account
| | |
|---|---|
| Reach | Create Account → `UserPortal.openRegisterModal()`; stepper `regGoStep(n)` / finish `regFinish()` |
| Shots | `out-register-modal_d(+2).jpg`, `out-register-modal_m(+2).jpg` |
| Fields | `#registerFirstName`* (100) `#registerLastName`* (100) `#registerEmail`* (254) `#registerPassword`* (min 8) `#registerInstitution` (200) `#registerCountry`* (select) `#registerConsent` (checkbox) — errors `#registerError`, success `#registerSuccess` |
| Submit | `POST /api/auth/register {first_name,last_name,email,password,institution,country,role:'user',locale}` → returns a session token (soft-gated unverified) + email-verification flow (`/verify/:token` server route) |

## out-forgot — Forgot password
| | |
|---|---|
| Reach | login modal → `UserPortal.openForgotPassword()` |
| Shots | `out-forgot_d.jpg`, `out-forgot_m.jpg` |
| Contract | email input → `POST /api/auth/forgot-password {email}`; reset completes on server page `/reset-password/:token` → `POST /api/auth/reset-password` |

---

# D. Server-rendered pages (Express routes in `backend/server.js`)

## srv-plexus — /plexus (+ /plexus/:token) — Plexus Week reservation
Title "Plexus 2026 — Reserve Your Place". Shots `srv-plexus_d.jpg`…`_d5`, `_m(+2,3)`. Multi-event selector (`.event-option[data-key]`: conference / bridges / gala) + form `#plexForm`: `pf_first pf_last pf_email pf_inst pf_country pf_diet pf_allergies pf_guests` (select) `pf_coupon pf_notes` → `plexSubmit()` → `POST /api/croatians-abroad/register {source:'plexus', link_token?, first_name,last_name,email,institution,country,dietary,allergies,guest_count,coupon,notes,selected_conference,selected_bridges,selected_gala}` (Bearer token attached if the visitor is a logged-in member → account linking). Coupon validation `POST /api/invite/validate-coupon`. `:token` variant prefills/attributes via `registration_links`.

## srv-donor-night — /donor-night · srv-building-bridges — /building-bridges
Titles "Plexus Donor Night — Plexus Week 2026" / "Building Bridges in Biomedicine Croatia — Plexus Week 2026". Shots `srv-donor-night_d(+…4)/m(+2,3)`, `srv-building-bridges_d(+…4)/m(+2,3)`. Shared template (`renderPublicEventPage`): hero, program, venue, form `#peForm`: `pe_first pe_last pe_email pe_inst pe_role` (+ `pe_diet` on donor-night) → `peSubmit()` → `POST /api/public-events/register {event:<slug>, first_name,last_name,email,institution,role,dietary}` (Bearer attached when member). Success replaces `#peCard` with confirmation.

## srv-forum-wing — /forum (Biomedical Forum wing) · srv-forum-enter — /forum/enter
`/forum`: title "The Biomedical Forum — an initiative of Med&X"; hero "A standing circle of senior biomedical leaders.", **Enter by personal link** (token entry) and **Request consideration** (application form → forum considerations). Calls `GET /api/forum/wing/me` (renders member state if a wing cookie/token exists). Shots `srv-forum-wing_d(+…4)/m(+2,3)`. Static asset `frontend/forum-wing.html`.
`/forum/enter`: "A link is needed" gate shell (entry only via personal `/f/…`-style links). Shots `srv-forum-enter_d(+2).jpg`.

## srv-apply — /apply (Accelerator applicant portal)
Title "Med&X Accelerator - Apply". Standalone applicant SPA: auth tabs (`showAuthTab('login'|'register')`, `#loginForm`/`#registerForm`, fields `regEmail regPassword regFirstName …`) → `POST /api/applicant/register`, `POST /api/applicant/login`, verify `GET /api/applicant/verify/:token`; then `GET /api/applicant/programs`, applications CRUD `GET/POST /api/applicant/applications(/:id)`, documents `POST/GET/DELETE /api/applicant/documents/:docId`, profile `GET/PUT /api/applicant/profile`. Captured logged-out ("Welcome Back") state: `srv-apply_d(+2,3)/m(+2,3)`.

## srv-evaluate — /evaluate (Accelerator interviewer scoring)
Title "Med&X Accelerator - Evaluacija kandidata" (hr). Token-gated client page: interviewer opens `/evaluate?token=…` → `GET /api/accelerator/interview-access/:token` → candidate list + scoring UI (`POST` scores per candidate). Captured tokenless shell: `srv-evaluate_d(+2).jpg`.

## srv-invite-success / srv-invite-cancelled — Stripe returns
`/invite-success`: with `?session_id=` shows payment confirmation; captured no-session state "No recent payment session" (`srv-invite-success_d.jpg`). `/invite-cancelled`: "Payment cancelled — Plexus 2026" (`srv-invite-cancelled_d.jpg`). Both link back to the portal.

## srv-pass-shell — /pass/:token · srv-speaker-shell — /speaker/:token
Personalized VIP-pass page (from `vip_passes`, modules/venue/materials JSON; `/pass/:token/calendar.ics`, `/manifest.json`) and speaker itinerary page (from `speaker_itineraries`; `speakerLimiter` rate-limited; same `.ics`/`manifest` companions). Scratch DB has no rows → captured the `linkNoticePage` 404 shells: "This page is not available" (`srv-pass-shell_d.jpg`), "This plan is not available" (`srv-speaker-shell_d.jpg`).

## srv-f-slug — /f/:slug (signup forms)
Public signup-form pages from the `signup_forms` table (waitlist logic, `/f/:slug/qr.png`, `/f/:slug/calendar.ics`; submit → `POST /api/signup-forms/:slug/…`). Draft/missing slug → 404 form page; scratch DB has zero `signup_forms` rows, so captured the "Page not found" shell (`srv-f-slug_d.jpg`).

## srv-donate-checkout — /donate/checkout (redirect only)
`GET /donate/checkout?amount=&frequency=&designation=` — clamps amount 1–50,000 (default 50), frequency ∈ once|month|year, designation from `DONATION_DESIGNATIONS` → creates a Stripe Checkout session → `302` to Stripe. Any failure (incl. Stripe unconfigured, as on this scratch instance) → `302 https://medx.hr/donate?checkout_error=1`. Verified via curl; no page renders, nothing to screenshot.

## Legal / utility pages
| Screen | Route | Captured |
|---|---|---|
| `srv-privacy_d.jpg` | `/privacy` — Privacy Policy (numbered sections) | ✓ |
| `srv-terms_d.jpg` | `/terms` — Terms & Conditions (registration/payment/refund) | ✓ |
| `srv-reset-password_d.jpg` | `/reset-password/:token` — invalid-token state "Link invalid or expired"; valid token renders new-password form → `POST /api/auth/reset-password` | ✓ (invalid state) |
| `srv-verify-certificate_d.jpg` | `/verify-certificate` — certificate verification lookup | ✓ |
| `srv-unsubscribe_d.jpg` | `/unsubscribe` — needs `?token=`; blank without it | ✓ (blank) |
| `srv-email-prefs_d.jpg` | `/email-prefs` — needs token; blank without it | ✓ (blank) |

Asset/redirect routes (no UI to capture): `/qr/:id.png` (ticket QR PNG), `/calendar/medx-events.ics` + `/calendar/:file` (gala.ics, plexus.ics), `/r/:token` (tracking redirect), `/invite/:data` (direct-invite takeover of the SPA), `/pay/gala/:token` (gala payment link → Stripe), `/verify/:token` (email verification → portal), `/health` (JSON).

---

# E. Completeness checklist

**SPA sections found in source (`id="up-section-*"`, 13) vs covered:**

| Section | Covered | Sub-states captured |
|---|---|---|
| dashboard | ✓ | hero/projects/feed scroll sections; chrome overlays (search, notifications, account, projects menu, help, contact, QR, Alan AI) |
| plexus | ✓ | 9 tabs; registration wizard steps 1–3 (pass selected, info, billing); 4 support modals |
| gala | ✓ | overview, speakers, schedule, register (confirmed state) |
| accelerator | ✓ | overview, institutions, intake (pre-launch), apply wizard steps 1–7, my-applications (empty), results lookup |
| forum | ✓ | invite gate + demo-mode member area: home, events, network, projects, profile |
| af26 | ✓ | overview + inline RSVP stepper |
| network | ✓ | discover, requests (empty), messages (empty), my card, member profile modal |
| talks | ✓ | full library + filters (rating widget per card) |
| mymedx | ✓ | passport, card view, present-ticket mode, guest-pass modal |
| rewards | ✓ | 200-pt state (redeem tiers locked) |
| bridges | ✓ | 7 tabs incl. apply + my events |
| speaker | ✓ | code gate (portal-inside not reachable, see gaps) |
| settings | ✓ | all 5 tabs |

**Server-rendered GET routes in `server.js` vs covered:** all page-rendering routes captured (see D); asset/redirect/token-only routes documented without screenshots (`/qr`, `/calendar`, `/r`, `/invite/:data`, `/pay/gala/:token`, `/verify/:token`, `/health`, `/donate/checkout` = 302).

**NOT reachable on this scratch instance (needs data/state):**
1. **Speaker portal beyond the code gate** — `POST /api/speakers/auth` demo code exists (`SPK-XWK8-2026`) but no itinerary/documents data; likewise `/speaker/:token` personalized page (empty `speaker_itineraries`).
2. **/pass/:token real VIP pass** — `vip_passes` empty; only the 404 shell captured.
3. **/f/:slug live signup form** — `signup_forms` empty; only the 404 shell captured.
4. **/evaluate with a valid interviewer token** — `accelerator_interviewers.access_token` empty in scratch DB.
5. **Accelerator live intake wizard** — application window closed ("opens November 2026"); pre-launch notify state captured instead. The 7-step placement application (apply tab) IS captured.
6. **Plexus/Gala unregistered states** — the seeded user is registered+paid for Plexus and confirmed for Gala, so the "not going yet" hero, the gala request form, and pending-approval/payment-due variants were not renderable. Registration wizard was still walked (it permits a fresh pass selection); no submission was made.
7. **Stripe checkout + bank-transfer invoice states** — off-site / require live Stripe config.
8. **First-run onboarding overlay** — suppressed intentionally (`medx_onboarding_completed=true` injected) to keep captures deterministic; re-capture by clearing that key.
9. **Rewards redeemed/code states** — balance (200) below all redeem tiers.
10. **/unsubscribe, /email-prefs, /reset-password with valid tokens** — token-dependent content.
11. **Push-permission prompts / PWA install flow** — browser-chrome level, not capturable headless.

**Out of scope (documented, not inventoried):** the admin surface embedded in the same bundle (`#section-finances`, `#section-pr-media`, `#section-communications`, `#section-automations`, `#section-checkin-scanner`, `#section-speaker-management`, `#section-forum` under `App.showSection` + `#admin` hash, plus the `/api/admin/**`, `/api/finance/**`, `/api/pr/**` endpoint families). These belong to the admin-portal redesign track, not the member portal.
