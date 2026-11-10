# Kalender webapp – stato e prossimi passi

Aggiornato al 28 ottobre 2026 (pomeriggio) · risposte del titolare A-01…D-020 integrate

## Dove siamo

Le fasi 0–6 del brief sono tutte chiuse e ognuna ha il suo commit:

| Fase | Contenuto | Stato |
|---|---|---|
| 0 Ricerca | 12 app analizzate, pain point, decisioni ADOTTA/ADATTA/SCARTA (`docs/research.md`) | ✅ |
| 1 Specifica | ruoli, user stories, modello dati, stati, NFR, assunzioni (`docs/spec.md` v1.1) | ✅ |
| 2 Motore | libreria pura + property test (84 test, copertura ~99,7 %) | ✅ |
| 3 API + DB | multi-salone, richiesta → conferma, anti-doppia prenotazione nel DB (43 test) | ✅ |
| 4 UI cliente | flusso di prenotazione, calendario/lista, mese, link di gestione, temi, "Ansicht", splash | ✅ |
| 5 UI personale | Mein Tag / Team, drag & drop, richieste, impostazioni titolare, admin piattaforma | ✅ |
| 6 Qualità | 66 test e2e, axe, regressione visiva, Lighthouse 96/100, CI, Docker, documentazione | ✅ |

In totale **233 test automatici verdi** (motore 94, web 27, API 46, e2e 66 + 6 saltati sul profilo iPhone), oltre a lint e controllo dei tipi.

## Novità del 7 novembre 2026

- **Scheda cliente** per il personale: contatti, appuntamenti passati e futuri, ricette colore, note del team, allergie (solo con consenso scritto).
- **Appuntamenti passati** (da ieri in giù) non si possono più annullare.
- **Notiz** al cliente su conferma / rifiuto / Rücksprache: arriva nell'e-mail e si vede sulla pagina dell'appuntamento.
- **Prenotazione:** casella obbligatoria "Datenschutzhinweise gelesen". Nessun banner cookie (non usiamo cookie per i clienti).
- Da fare con l'avvocato: modulo di consenso scritto per le allergie.

## Novità del 9 novembre 2026

- Animazioni leggere (comparsa delle sezioni, pannelli che scorrono, conferme a "toast"), disattivabili con "Bewegung reduzieren".
- Area personale su telefono: menu in basso con icone, "Neuer Termin" come pulsante fluttuante, calendario molto più in alto.
- Le fasi di un appuntamento ora sembrano un'unica scheda; numeri di telefono leggibili.
- Linea dell'ora attuale che si muove da sola, con l'orario sull'asse; "Heute" porta la linea al centro.
- **Cassa:** da decidere quale sistema cassa usa il salone (vedi decisions D-046).

## Novità del 10 novembre 2026

- GitHub riallineato allo zip completo, CI verde (lint, tipi, test motore/web/API, e2e, Lighthouse).
- Docker verificato sul PC Windows; il progetto ora si trova fuori da OneDrive (`%USERPROFILE%\Claude GitHub\Bookme`), collegato a GitHub.
- `Dockerfile`: `pnpm` resta dentro l'immagine, l'app si avvia anche offline.
- **Leistungen & Dauern** (D-048): titolare e gestore della piattaforma modificano nome, Damen/Herren, "nur ab 18", passaggi e durate. Gli appuntamenti già presi non cambiano; un servizio con appuntamenti si può solo nascondere. Le durate mostrate nella prenotazione ora si calcolano dai dati.
- **Login con nome utente** (D-049): nello stesso campo si può scrivere l'e-mail oppure il nome utente (es. `maria`). Il nome utente vale per il salone della pagina di login; l'e-mail resta obbligatoria per chi accede.
- Pagina "Seite nicht gefunden" leggibile; `/salone/admin` porta alle impostazioni del salone (D-050).
- **Pagina iniziale del salone** (D-052): `/salone` mostra presentazione, servizi e prezzi, orari con stato "aperto ora", contatti con "Route planen", testi del titolare e team (solo chi acconsente, solo nome pubblico). La prenotazione è su `/salone/buchen`. Niente foto per ora.

## Task aperte

### A. Risposte del titolare: cosa è stato fatto

| # | Risposta | Stato nell'app |
|---|---|---|
| A-01 | Uomo 30′ con o senza lavaggio; donna 30′ solo taglio, 45′ con shampoo | ✅ fatto (per la donna "con lavaggio" include l'asciugatura: da confermare) |
| A-02 | Waschen & Legen 30′ senza taglio | ✅ |
| A-03 | Strähnen e Dauerwelle anche per uomini, Balayage no | ✅ |
| A-04 | Taglio 30′; Strähnen Oberkopf/Konturen 45′, testa intera 60′ | ✅ ordine ipotizzato: Strähnen → posa 30′ → taglio → styling (da confermare) |
| A-05 / A-06 | 12 h / 48 h; un solo promemoria 24 h prima | ✅ |
| A-07 | 10 anni | ⚠️ **non applicato**: i 10 anni (ora 8 per le ricevute) valgono per la contabilità, non per i dati delle prenotazioni. Restano 12 mesi; con penale aperta 3 anni. Decisione rimandata: intanto restano 12 mesi |
| A-10 | Forma anonima + slot liberi con contorno fine | ✅ |
| A-13 | Assenza: nessuna sovrapposizione, nemmeno con la posa | ✅ (era già così) |
| A-16 | Riconferma sì, ma non sotto 1 ora | ✅ |
| D-020 | Penale = Mindestlohn 4 h + 10–20 % del ricavo perso | ✅ formula: 97 € con prezzo 190 € (15 %) |

Domande ancora aperte per il titolare: A-07 (rimandata), A-01 asciugatura inclusa, A-04 ordine delle fasi, D-020 percentuale 10/15/20 %. Il resto (A-09, A-12, A-14, A-15, A-17…A-20) è in `docs/spec.md` §10.

### B. Verifiche non ancora fatte

1. ✅ **GitHub + CI:** repository creato, CI verde il 7 novembre 2026 (inclusi i test su Safari/WebKit). Il 10 novembre 2026 GitHub è stato riallineato allo zip di riferimento (tolti i file finiti nella radice, aggiunti quelli mancanti): CI di nuovo verde. I confronti visivi dei calendari girano solo in locale (foto di riferimento legate al computer).
2. ✅ **Docker:** `docker compose up --build` verificato il 10 novembre 2026, sia nella sandbox sia sul PC Windows del titolare (Docker Desktop). Corretto il `Dockerfile`: l'app ora parte anche senza internet (prima scaricava `pnpm` a ogni avvio).
3. **Telefoni reali:** un iPhone e un Android, flusso cliente e calendario del personale.
4. **Lettori di schermo:** VoiceOver, TalkBack, NVDA (checklist in `docs/accessibility.md`).
5. **E-mail reali:** scegliere un provider SMTP europeo e provare l'invio.

### C. Parte legale e business (serve un professionista, non codice)

1. Revisione legale di Impressum, informativa privacy e testo della penale (§ 309 Nr. 5 BGB). Il commercialista conferma i tempi di conservazione (A-07).
2. Ogni gennaio aggiornare il Mindestlohn nella formula della penale (14,60 € dal 1° gennaio 2027).
3. **Contratto AVV (Art. 28 DSGVO)** fra voi gestori e ogni salone.
4. Verificare se il **BFSG** si applica a voi come piattaforma.
5. Scegliere hosting UE e provider e-mail, con relativi costi mensili.
6. Dati reali del primo salone: nome, indirizzo, telefono, logo, listino prezzi.

### D. Sviluppo ancora possibile (backlog, in ordine di utilità)

| Priorità | Cosa | Perché | Stima |
|---|---|---|---|
| ✅ 1 | Modulo servizi e durate (D-048) | Fatto il 10 novembre 2026: in "Einstellungen" (titolare) e in /admin (gestore). Mancano ancora: varianti, penale, orari d'inizio fissi | – |
| 2 | Deploy di prova (staging) su hosting UE con HTTPS | Per far provare l'app al titolare con dati veri | 1 giorno + costi hosting |
| 3 | Limite di richieste condiviso (Redis/PostgreSQL) e build compilata | Necessario solo con più server | 0,5–1 giorno |
| 4 | Selettore lingua + traduzioni IT/EN complete | La struttura c'è, i testi sono parziali | 1 giorno |
| 5 | Row-level security in PostgreSQL | Secondo livello di isolamento fra saloni | 1 giorno |
| 6 | WhatsApp Business | Solo se il salone lo vuole: contratto con un provider, costi per conversazione, AVV | da valutare |

## Come procedere (ordine consigliato)

1. **Questa settimana:** chiudere col titolare le 5 domande aperte della sezione A e far vedere il nuovo calcolo della penale.
2. **Subito dopo:** creare il repo GitHub, fare il push e far girare la CI (B1). Poi provare Docker (B2).
3. **In parallelo:** avviare la revisione legale (C1–C3). È la cosa con i tempi più lunghi e non dipende dal codice.
4. **Sviluppo:** modulo admin per servizi e durate (D1), poi deploy di staging (D2) per un test reale con il primo salone.
5. **Prima del lancio:** test su telefoni reali e lettori di schermo (B3–B4), e-mail reali (B5), dati reali del salone (C6).

## Come mettere il progetto su GitHub (B1) e provare Docker (B2)

Versione senza terminale per GitHub: file `salon-booking-per-github.zip` (contiene la cronologia Git).
1. Installare **GitHub Desktop** (desktop.github.com) e accedere con l'account GitHub.
2. Estrarre lo zip in Documenti → cartella `salon-booking`.
3. GitHub Desktop → File → Add local repository → scegliere la cartella → Add repository.
4. Publish repository → spuntare "Keep this code private" → Publish.
5. Su github.com → repository → scheda **Actions**: aspettare la spunta verde (15–20 min).

Docker: installare Docker Desktop, avviarlo, aprire il Terminale nella cartella del progetto (`%USERPROFILE%\Claude GitHub\Bookme`) ed eseguire `docker compose up --build`; poi aprire `http://localhost:3000/salon-beispiel`. Per fermare: Ctrl+C, poi `docker compose down`.

## Come riprendere il lavoro in una nuova sessione

- Il codice completo è in `salon-booking.zip`. Per la cronologia completa usare `git clone salon-booking.bundle salon-booking`.
- Avvio locale: `pnpm install && pnpm seed && pnpm dev`, poi aprire `http://localhost:5173/salon-beispiel`.
- Convenzioni e comandi di test: `CLAUDE.md`. Decisioni: `docs/decisions.md`. Requisito → test: `docs/traceability.md`.
