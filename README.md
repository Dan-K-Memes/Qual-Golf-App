# Qual Golf

Talk through your round, get real stats. Say what you are doing ("7 iron, 190 in, playing for a flyer"),
and the app turns your spoken notes into structured shots, keeps your gross and net score against the
club scorecard, and works out strokes gained plus patterns in your decisions.

It is a plain static web app (no build step) that you add to your iPhone Home Screen. All data is stored
on your phone. Claude (Anthropic API) does the language understanding.

## What it does

- **Scorecard to course**: photograph the card, or screenshot it from the club's website or a golf app before you head out (pick several screenshots at once for a long page; tall ones are sliced automatically). Claude reads every tee (slope, rating, par, stroke index, yardage). You confirm and save.
- **Scoring**: gross and net stroke play from your index, the tee's slope/rating, and each hole's stroke index (WHS course handicap, with an allowance % setting).
- **Voice notes**: shot notes before shots, a recap after each hole. Hole recap advances the hole.
- **Parsing**: notes become shots with club, lie, distance, intent, result, miss direction, risk, tags and penalties.
- **Review screen**: scorecard, strokes gained by area, a "to fix" list (missing distance/lie, recap score vs shot count), and edit any shot or dictate a correction.
- **Stats**: FIR/GIR/putts/scrambling, strokes gained per area, club table, and decision patterns (e.g. "hook + tree obstacle: 5 shots, -0.9 each") once a pattern has 3+ shots.

Strokes gained uses approximate expected-strokes tables scaled to your handicap. Treat the numbers as directional.

## Setup (no Mac needed)

1. **Host it**: push to GitHub and enable Pages (Settings, Pages, deploy from the branch root). Your URL will look like `https://<you>.github.io/qual-golf-app/`.
2. **Open it in Safari** on your iPhone. You can use it in Safari directly, or Share, Add to Home Screen.
3. **Settings tab**: enter your handicap index and your Claude API key (create one at console.anthropic.com, add $5 to $10 credit, set a monthly limit). Pick the model.
4. **Courses tab**: add your course from a scorecard photo.
5. **Round tab**: start a round and add the Action Button Shortcut from `docs/SHORTCUTS.md`.

## Privacy and the API key

Data and the key stay in this browser's storage and the key is only sent to `api.anthropic.com`.
Because the key lives in the page, do not hand this build to friends. Add a small proxy first.
Use Export in Settings for a backup (the key is not included).

## Develop

```
npm test        # unit tests for scoring, strokes gained, parsing and storage (Node 20+)
python3 -m http.server 8000   # then open http://localhost:8000
```

Code layout: `js/golf.js` (scoring, strokes gained, stats), `js/tables.js` (expected strokes),
`js/ai.js` (Claude prompts and tool schemas), `js/store.js` (local storage), `js/app.js` (UI).
