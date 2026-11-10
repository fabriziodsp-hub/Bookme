# Phase 0 – Market & user research

> Status: Phase 0 complete, awaiting owner review (2026-10-27).
> Scope: booking apps for hair salons, with priority on the German market.
> Method: public pages only (Trustpilot, Capterra/G2, App Store / Google Play listings, vendor pages, trade press, consumer-protection sites). No login walls, no paywalls, no bulk scraping — single page fetches only.

## 0. Methodology and limits (read first)

- **Sample, not census.** For each source I read one page of reviews (typically the newest 5–25). Counts below are **mentions in that sample**, not totals across the platform. They indicate direction, not statistical significance.
- **Recency.** I prioritised reviews from 2025-04 to 2026-10. Where a source only showed older reviews (e.g. Shore on Capterra DE, newest from 2019) this is flagged and weighted less.
- **Reddit / forums.** Searches restricted to reddit.com returned no usable threads through the search tool, and I did not try to work around that. **Reddit is therefore not represented** — a known gap.
- **Biased sources.** Several pricing comparisons are published by competitors (studiolution, Pabau, TrimCheck). They are used only for facts that can be cross-checked (published prices), and marked as such.
- **Quotes** were extracted from the fetched pages and kept ≤ 15 words. Spot-check before publishing anything externally.
- **Not legal advice.** Notes on BFSG and no-show fees summarise public guidance from IHK and Verbraucherzentrale; they need validation by a lawyer.

## 1. App overview (status October 2026)

| App | Users | Key functions | Price / model | Status & recent changes | Sources (date) |
|---|---|---|---|---|---|
| **Treatwell** | Clients (marketplace app) + staff (Treatwell Connect) | Marketplace, online booking, prepayment, SMS confirmations, labelled blocked time, card terminals, AI phone receptionist | ~39 €/month + **35 % commission on first booking of a new client** via marketplace; prepayment +2 % (competitor source) | Active in DE. Mar 2026: free SMS confirmations, labelled blocked time (lunch/breaks). Sep 2026: AI receptionist from £69/month | [Treatwell blog 03/2026](https://www.treatwell.co.uk/partners/resources/blog/the-salon-pulse-whats-new-in-treatwell-connect-march-2026/), [ITBrief 09/2026](https://itbrief.co.uk/story/treatwell-launches-ai-receptionist-for-salons-across-europe), [studiolution 06/2026](https://www.studiolution.com/online-terminbuchung-kosten-vergleich/), [Google Play 08/2026: 4.8★, 109k](https://play.google.com/store/apps/details?id=com.wahanda.marketplace&hl=en_GB) |
| **Shore** | Staff + booking widget for clients | Online booking, reminders, client CRM, POS, marketing | 49.90 €/month (annual) / 59.90 € (monthly), no commission; marketing tier 69.90 € (competitor source; Shore's own FAQ figure inconsistent) | Munich, **acquired by group.one (Aug 2024)**. Still active | [Munich Startup 08/2024](https://munich-startup.de/news/group-one-uebernimmt-shore), [App Store: 4.7★, 73](https://apps.apple.com/app/id548235635), [Capterra DE: 4.1★, 36 — newest review 2019](https://www.capterra.com.de/reviews/141463/shore-com) |
| **TIMIFY** | Staff + widget | Online calendar, booking widget, payments; reminders and mobile apps only in paid tier; AI assistant | Free "Classic"; Premium 31 €; Enterprise 53 € | Active (Munich origin) | [Capterra pricing 2026](https://www.capterra.com/p/158066/TIMIFY/pricing/), [Capterra DE: 4.5★, 54](https://www.capterra.com.de/reviews/158066/timify) |
| **Fresha** | Clients (marketplace app) + staff | Marketplace, booking, payments, reminders, no-show card protection, marketing add-ons | **No longer free**: subscription (UK solo £14.95, team £9.95/bookable person) + **20 % new-client fee** for marketplace clients; card fees; Feb 2026 top plan price cut | Active. DE availability not verified in this pass | [TrimCheck 09/2026 (competitor)](https://trimcheck.com/for-barbers/fresha-fees/), [Costbench 02/2026](https://costbench.com/changelog/fresha-price-decrease-2026-02/), [Capterra: 4.8★, 1,449](https://capterra.com/p/142138/Shedul-com/reviews/) |
| **Booksy** | Clients (app) + staff (Booksy Biz) | Marketplace, booking, Boost (paid promotion), cancellation fees with card pre-hold, messaging | Subscription + Boost fees per new client | Active in DE (de-de site). Apr 2026 card pre-hold for high-risk clients; Aug 2026 card-removal loophole closed; Oct 2026 booking via ChatGPT | [Booksy What's new 10/2026](https://biz.booksy.com/whats-new/fixed-cancellation-fees-now-more-reliable), [Booksy DE](https://biz.booksy.com/de-de/funktionen/marktplatz), [Trustpilot: 2.9, 16,583](https://www.trustpilot.com/review/booksy.com?page=1), [Capterra: 4.4★, 482](https://capterra.com/p/142741/Booksy/reviews/) |
| **Planity** | Clients (marketplace app) + staff (Planity Pro) | Marketplace page, 24/7 booking, reminders, deposits, TSE cash register, terminal | **Price on request** (~69 €/month calendar, ~99 € with POS per competitor source); no commission; 100 SMS/month included | Active and growing in DE (French origin; present at BEAUTY/TOP HAIR Düsseldorf 2026) | [Pabau 10/2026 (competitor)](https://pabau.com/de/blog/planity-kosten/), [App Store DE: 4.9★, 23,628](https://apps.apple.com/DE/app/id1434056190), [Capterra DE: 3.3★, 4](https://www.capterra.com.de/software/1027177/planity), [Estetica 02/2026](https://www.esteticahairmagazine.de/2026/02/18/planity-auf-der-beauty-top-hair-messe-duesseldorf-2026/) |
| **Salonized** | Staff + widget | Booking widget, reminders, prepayment, POS, stock | 19 € / 35 € / 55 € per user/month | Active (NL). One 2024 review reports price nearly doubled in 2 years | [Capterra pricing](https://www.capterra.com/p/141697/Salonized/pricing/), [Capterra: 4.7★, 45](https://www.capterra.com/p/141697/Salonized/reviews/) |
| **Phorest** | Staff (+ client app) | Booking, reminders, reporting, marketing, tips | Not retrieved | Active (IE/UK/US); DE presence not verified | [Capterra: 4.8★, 431 (reviews Feb 2026)](https://capterra.com/p/113530/Phorest-Salon-Software/reviews/) |
| **Vagaro** | Clients + staff | All-in-one: booking, payments, CRM, marketing | From $23.99/month base + per-employee and add-ons | Active (US, UK, CA, AU). Not targeted at DE | [checkthat.ai summary](https://checkthat.ai/brands/vagaro/reviews), [Capterra: 4.7★, 290](https://www.capterra.com/p/153752/Vagaro) |
| **theCut** | Clients + barbers | Barber discovery, booking, portfolio, payments | Monthly fee + transaction % (reviews) | Active, US-focused barber niche | [JustUseApp: 4.7★ store avg](https://justuseapp.com/en/app/1101408626/thecut-find-book-barbers/reviews) |
| **Squire** | Barbershops + clients | Booking, POS, reporting | $30–250/month flat | Active, US barbershops | [Capterra: 4.2★, 38](https://www.capterra.com/p/153899/Squire-Barber-Appointment-App/) |
| **Mindbody (+ Booker)** | Studios/spas/salons | Booking, payments, marketplace (ClassPass) | Enterprise pricing | Parent renamed **Playlist**; **merged with EGYM, closed 31 Mar 2026** ($7.5B). Focus on fitness; little salon relevance in DE | [TechCrunch 03/2026](https://techcrunch.com/2026/03/31/the-company-behind-classpass-and-mindbody-just-got-a-lot-bigger-with-a-7-5b-merger/) |

**Takeaway on the market.** All 12 still exist. In 2026 the movement is towards (a) monetising the marketplace (Fresha dropped its free plan, Treatwell 35 % on new clients, Booksy Boost), (b) stricter payment-backed no-show protection (Booksy card pre-holds), (c) AI front doors (Treatwell AI receptionist, Booksy in ChatGPT). Our salon has one stylist and no need for a marketplace — most of that movement does not apply.

## 2. Feature analysis

Score 0–5 = satisfaction with **how the feature works in today's apps**, from the share of positive mentions, adjusted down for small/old samples. The decision (section 4) asks a different question: *does the feature belong in our product?*

| # | Feature | + | − | Score | Representative quotes (≤ 15 words) |
|---|---|---|---|---|---|
| F1 | Simple online self-booking, 24/7 | 18 | 5 | **4.0** | + "The website is easy to navigate" ([Trustpilot, Treatwell, 08/2026](https://ie.trustpilot.com/review/treatwell.com?page=8)) · + "very reliable booking app" ([Trustpilot, Booksy, 09/2026](https://www.trustpilot.com/review/booksy.com?page=1)) · − "it was much faster to find the salon's phone number" ([Google Play, Treatwell, 08/2026](https://play.google.com/store/apps/details?id=com.wahanda.marketplace&hl=en_GB)) |
| F2 | Automatic confirmation + reminders | 7 | 3 | **4.5** | + "reduces no-shows with automated reminders" ([Capterra, Fresha, 01/2026](https://capterra.com/p/142138/Shedul-com/reviews/)) · + "the program does it automatically" ([Capterra DE, Shore, 2016](https://www.capterra.com.de/reviews/141463/shore-com)) · − clients confused by reminder dates written as numbers ([Capterra, Phorest, 02/2026](https://capterra.com/p/113530/Phorest-Salon-Software/reviews/)) |
| F3 | Self-service reschedule / cancel | 1 | 3 | **2.5** | + clear and easy for customers to reschedule ([App Store DE, Planity](https://apps.apple.com/DE/app/id1434056190)) · − "the ability to edit appointments" is missing ([theCut reviews](https://justuseapp.com/en/app/1101408626/thecut-find-book-barbers/reviews)) · − rebooking assigns a different stylist ([App Store DE, Planity, 2024](https://apps.apple.com/DE/app/id1434056190)) |
| F4 | Mandatory account / app download | 0 | 4 | **0.5** | − "It wouldn't let me sign in or create an account" ([Trustpilot, Treatwell, 08/2026](https://ie.trustpilot.com/review/treatwell.com?page=8)) · − "referral links lead to mandatary app download" ([Capterra, Booksy, 10/2025](https://capterra.com/p/142741/Booksy/reviews/)) · context: 19 % abandon checkouts over forced accounts ([Baymard, 2026](https://baymard.com/blog/reduce-cart-abandonment)) |
| F5 | Deposits / card on file / no-show fees | 3 | 7 | **2.0** | + "The ability to pay in advance has received excellent feedback" ([Capterra, Salonized](https://www.capterra.com/p/141697/Salonized/reviews/)) · − "Booksy charged me anyway." ([Trustpilot, 10/2026](https://www.trustpilot.com/review/booksy.com?page=1)) · − "its been 3 weeks of chasing my refund" ([Google Play, Treatwell, 02/2026](https://play.google.com/store/apps/details?id=com.wahanda.marketplace&hl=en_GB)) |
| F6 | Marketplace, commissions, paid boost | 0 | 13 | **1.0** | − "I'm being charged for customers who scan my in-store QR code" ([Capterra, Fresha, 10/2025](https://capterra.com/p/142138/Shedul-com/reviews/)) · − "they're overcharging for boost" ([Trustpilot, Booksy, 10/2026](https://www.trustpilot.com/review/booksy.com?page=1)) |
| F7 | Tip prompt during booking | 0 | 2 | **0.5** | − "I'm asked for a tip while booking the appointment" ([Trustpilot, Booksy, 10/2026](https://www.trustpilot.com/review/booksy.com?page=1)) |
| F8 | Choose your stylist | 2 | 2 | **3.0** | + "can choose stylist/beautician of your choice without feeling awkward" ([Google Play, Treatwell, 04/2026](https://play.google.com/store/apps/details?id=com.wahanda.marketplace&hl=en_GB)) · − "pushed me off on a barber whose work I had never seen" ([theCut](https://justuseapp.com/en/app/1101408626/thecut-find-book-barbers/reviews)) |
| F9 | Transparent price & duration, no hidden add-ons | 0 | 3 | **1.5** | − app showed £55 vs salon's £35 ([Google Play, Treatwell, 04/2026](https://play.google.com/store/apps/details?id=com.wahanda.marketplace&hl=en_GB)) · − procedures added "that can't be unchecked" ([same, 08/2026](https://play.google.com/store/apps/details?id=com.wahanda.marketplace&hl=en_GB)) |
| F10 | Staff calendar UX (esp. mobile) | 4 | 7 | **3.0** | + "the easiest application I've ever had" ([Trustpilot, Booksy, 09/2026](https://www.trustpilot.com/review/booksy.com?page=1)) · − "The calendar can be a little confusing to navigate" ([Capterra, Booksy, 10/2025](https://capterra.com/p/142741/Booksy/reviews/)) · − "the iPhone app is missing a button like that" (back to today) ([Capterra, Timely, 2023](https://capterra.com/p/142756/Timely/reviews/)) · − "I have to edit each item one by one" ([Capterra, Booker, 2017](https://capterra.com/p/90708/Booker/reviews/?page=3)) |
| F11 | Blocked time / absences with labels; per-date hours | 0 | 1 | **n/a** (demand signal) | Treatwell shipped labelled blocked time in 03/2026 ([blog](https://www.treatwell.co.uk/partners/resources/blog/the-salon-pulse-whats-new-in-treatwell-connect-march-2026/)) · − "Unable to change bookable times of individual days." ([Capterra DE, Timify](https://www.capterra.com.de/reviews/158066/timify)) |
| F12 | Reliable booking — no lost or double bookings | 0 | 4 | **1.0** | − "they have no record of the appointment." ([Trustpilot, Booksy, 04/2026](https://www.trustpilot.com/review/booksy.com?page=1)) · − "people thinking they booked appointments but … it didn't go through" ([Capterra, Booker](https://capterra.com/p/90708/Booker/reviews/?page=3)) |
| F13 | Notification volume / marketing messages | 0 | 3 | **1.0** | − too many notifications ([theCut](https://justuseapp.com/en/app/1101408626/thecut-find-book-barbers/reviews)) · − unsubscribed clients re-subscribed ([Capterra, Squire, 2022](https://www.capterra.com/p/153899/Squire-Barber-Appointment-App/)) |
| F14 | Contact client from staff view | 1 | 1 | **3.0** | + "the ability to contact clients from within the app" ([Trustpilot, Booksy, 09/2026](https://www.trustpilot.com/review/booksy.com?page=1)) · − customer communication underdeveloped ([Capterra DE, Planity, 2024](https://www.capterra.com.de/software/1027177/planity)) |
| F15 | Waitlist | 0 | 1 | **n/a** | − waitlist bugs, "take forever to get fixed" ([Capterra, Phorest, 02/2026](https://capterra.com/p/113530/Phorest-Salon-Software/reviews/)) |
| F16 | Recurring appointments / rebook in N weeks | 0 | 1 (request) | **n/a** | request for "every two weeks" bookings ([Capterra, Salonized, 2018](https://www.capterra.com/p/141697/Salonized/reviews/)) |
| F17 | Calendar file / sync | 1 | 2 | **2.5** | + linked Google Calendar ([Capterra, Salonized, 2017](https://www.capterra.com/p/141697/Salonized/reviews/)) · − calendar invitations can't be edited ([App Store DE, Planity](https://apps.apple.com/DE/app/id1434056190)) · − lacks calendar integration ([theCut](https://justuseapp.com/en/app/1101408626/thecut-find-book-barbers/reviews)) |
| F18 | Reporting | 2 | 0 | **4.0** | + "the BEST reporting system I have ever worked with!" ([Capterra, Phorest, 02/2026](https://capterra.com/p/113530/Phorest-Salon-Software/reviews/)) |
| F19 | AI receptionist / booking via chatbots | 0 | 0 | **n/a** (too new) | Launched 09/2026 (Treatwell) and 10/2026 (Booksy); no user evidence yet |
| F20 | Phone/OTP verification at booking | 0 | 1 | **n/a** | − "Phone number verification problems" ([Capterra DE, Planity, 05/2025](https://www.capterra.com.de/software/1027177/planity)) |
| F21 | POS / cash register (TSE), gift cards, loyalty | 1 | 2 | **n/a** | out of our scope, see section 4 |

## 3. Recurring pain points

| Pain point | Evidence | What it means for us |
|---|---|---|
| **Hidden or surprising costs** (commission on own clients, boost, tips, price increases) | 13+ mentions (Booksy, Fresha, Salonized, theCut, Treatwell) | Own booking page, no marketplace; nothing paid in the client flow |
| **Money held / not refunded** (deposits, cancellation fees, chargebacks) | 7 mentions; German law requires an explicitly agreed fee *and* provable damage ([Verbraucherzentrale NI, 07/2026](https://www.verbraucherzentrale-niedersachsen.de/node/120246)) | No online payment in the MVP; prevent no-shows with reminders and an easy cancel link |
| **Forced account / app download** | 4 mentions + Baymard 19 % | Guest booking only; management by signed link |
| **Lost or double bookings** | 4 mentions | DB-level exclusion constraint + immediate confirmation with a reference code |
| **Prices/services changed by the platform** | 2 recent Treatwell reviews | Show exact service, options, duration and price in every step and in the confirmation |
| **Staff calendar awkward on mobile** (no "today", too many screens, edit phases one by one) | 7 mentions | Big « ‹ Heute › » navigation, drag & drop per phase, keyboard/panel alternative |
| **Notification spam / ignoring unsubscribe** | 3 mentions | Transactional messages only (confirmation, 1 reminder, change/cancel). No marketing |
| **Unreachable support** | many, all vendors | N/A for a single-salon product, but the client always sees the salon's phone number |
| **Unreadable dates in reminders** | 1 mention (Phorest) | Write dates in words: "Di., 3. November 2026, 09:15 Uhr" |

## 4. Decision per feature

| # | Feature | Decision | Reason |
|---|---|---|---|
| F1 | Simple self-booking, few steps | **ADOPT** | Highest satisfaction; core of the brief |
| F2 | Confirmation + reminder (e-mail; SMS optional) | **ADOPT** | 4.5 score; the main no-show lever that does not hold the client's money. Dates written in words |
| F3 | Reschedule/cancel via link | **ADOPT** | Today's implementations are weak (2.5), so doing it well is a real advantage; keeps the same stylist |
| F4 | Mandatory account | **REJECT** | Clearly negative; brief already requires "no account" |
| F5 | Deposits / card-on-file / no-show fee | **REJECT for MVP** | Negative sentiment, legal friction in DE, adds payment-provider costs → a scope/cost decision for the owner. We record no-shows internally instead |
| F6 | Marketplace / commission / boost | **REJECT** | Most negative feature; irrelevant for a single salon |
| F7 | Tip prompt in booking | **REJECT** | Negative, no benefit |
| F8 | Choose stylist | **ADAPT** | Data model supports N stylists; the choice step stays hidden while there is only 1 |
| F9 | Transparent price & duration | **ADOPT** | Negative today = differentiator; segmented duration bar already in brief. Price shown only if the owner provides prices (assumption) |
| F10 | Staff calendar with drag & drop, Heute, phase editing | **ADOPT** | Required by brief; complaints point to exactly what to fix |
| F11 | Absences, labelled blocks, per-date exceptions | **ADOPT** | Shipped by market leader in 2026; Timify complaint on per-date hours |
| F12 | Double-booking prevention + reference code | **ADOPT** | Trust killer when it fails |
| F13 | Marketing notifications | **REJECT** | Transactional messages only |
| F14 | Contact client from staff view | **ADAPT** | `tel:` / `mailto:` links on the appointment; no in-app chat |
| F15 | Waitlist | **REJECT for now** | No satisfaction evidence; adds complexity |
| F16 | Recurring / "rebook in N weeks" | **ADAPT (later)** | Staff-side shortcut "Folgetermin" proposing the same service in N weeks; not for clients in MVP |
| F17 | Calendar file | **ADAPT** | `.ics` attachment for the client (cheap, no sync). Staff calendar sync rejected for MVP |
| F18 | Reporting | **ADAPT (minimal)** | Utilisation % and no-show count per week only |
| F19 | AI receptionist / chatbot booking | **REJECT** | Fashionable, no user evidence, cost and privacy impact |
| F20 | OTP verification at booking | **REJECT** | Friction; abuse handled with rate limiting + honeypot + confirmation link |
| F21 | POS/TSE, gift cards, loyalty | **REJECT** | Out of scope; TSE has legal requirements of its own |

## 5. Related regulatory findings (to validate, not legal advice)

- **BFSG** (in force since 28 Jun 2025) covers online booking as a service in e-commerce. Micro-enterprises (< 10 employees **and** ≤ 2 M € turnover or balance sheet) offering services are exempt. IHK Berlin uses exactly this example: a salon with 4 staff is exempt, with 12 it is not ([IHK Berlin](https://www.ihk.de/berlin/service-und-beratung/recht-und-steuern/informationsseite-bfsg-6451846)). → Our salon is probably exempt, but we build to WCAG 2.2 AA anyway (brief requirement, and the exemption depends on headcount).
- **No-show fees**: only if agreed explicitly at booking, and damage must be provable ([Verbraucherzentrale Niedersachsen, 07/2026](https://www.verbraucherzentrale-niedersachsen.de/node/120246)). → supports F5 = reject for MVP.

## 6. Originality

We take principles (few steps, guest booking, clear confirmation, phase-aware calendar) — no assets, copy, logos, exact colours or code from any vendor. No third-party brand appears in the UI.
