# Board data (DATA.md)

Each room has an "at a glance" board. Boards show **real data only**:

- **Computed in the browser** (Australia/Brisbane, UTC+10, no daylight saving): today's date,
  whether it's a work day (Mon to Fri, 5:00am start), payday countdown to the next Thursday
  (Randstad), and the 9:00 to 9:30pm bedtime target (shown Sun to Thu only).
- **Everything else** comes from the optional file `public/status.json` (published as
  `https://timesnapx.github.io/agent-world/status.json`). Missing sections or fields show
  "No data yet". An empty list shows "None recorded" (or similar). Nothing is ever made up.

`status.json` is fetched fresh (never cached by the service worker) on load and every 5 minutes.
If it can't be loaded, boards say so and show empty states. Edit it, run `npm run build`, and
publish to update the live boards; no code change is needed.

## Schema

Every field is optional. Dates are `YYYY-MM-DD` (Brisbane) or full ISO timestamps; money is a
plain number in AUD; hours are decimal numbers.

```jsonc
{
  "updated": "2026-10-04T18:00:00+10:00",           // shown as "Data as of ..."

  "nextDue": { "title": "RACQ payment", "due": "2026-10-06" },   // Command Centre

  "treasury": {                                        // Treasury (Plutus)
    "lastPay": { "date": "2026-10-01", "net": 0, "gross": 0 },
    "weekHours": 0,
    "expectedNextPay": { "date": "2026-10-08", "net": 0 },
    "due": [ { "name": "RACQ", "amount": 0, "due": "2026-10-10", "status": "scheduled" } ]
                                                       // sorted: RACQ first, Superloop second, then by due date
  },

  "hearth": {                                          // Hearth (Hestia)
    "upcoming": [ { "name": "Rego", "amount": 0, "due": "2026-10-20" } ],
    "failedPayments": [ { "name": "Superloop", "amount": 0, "date": "2026-10-02" } ]
  },

  "depot": {                                           // Depot (Atlas)
    "shifts": [ { "date": "2026-10-01", "gateIn": "05:00", "gateOut": "13:36", "paidHours": 8.1 } ]
                                                       // gate-to-gate is computed; paid vs 7.6h ordinary day is computed
  },

  "career": { "current": "HR", "notes": "..." },       // Map Room (Hermes). Path is HR -> HC -> MC; default current = HR

  "dojo": {                                            // Dojo (Hygieia)
    "sleepTargetHours": 8,
    "sleep": [ { "date": "2026-10-03", "hours": 7.5 } ], // last 7 shown vs target
    "taekwondo": [ { "date": "2026-10-02", "note": "Sparring" } ],
    "streaks": [ { "name": "Bed by 9:30", "days": 3 } ]
  },

  "trading": {                                         // Trading Floor (Fortuna, Hades, Argus)
    "redFlags": [ "text", { "text": "..." } ],
    "notes": [ { "title": "...", "body": "...", "date": "2026-10-04" } ],
    "watchlist": [ { "symbol": "SOL", "note": "..." } ]
                                                       // research + watchlist ONLY. Never put balances, positions or
                                                       // wallet keys here: the app has no field for them and won't show them.
  },

  "library": { "lastQuestion": { "text": "...", "date": "2026-10-04" } },   // Library (Athena)

  "gallery": { "recent": [ { "title": "...", "url": "https://..." } ] },    // Gallery (Apollo)

  "post": { "unreadImportant": 0, "draftsAwaitingReview": 0 },             // Post Office (Iris)

  "pool": {                                            // Pool Hall (Artemis)
    "nextComp": { "date": "2026-10-09", "time": "7:00pm", "venue": "Sporties" },
    "bracket": [ { "round": "R1", "match": "TimeSnap v ...", "result": "" } ]
  }
}
```

`status.json` is public once published (GitHub Pages), so only put in it what you're happy to be
public. The Library "quick ask" box has no backend: it only shows a note to ask Athena in Grok Bot.
