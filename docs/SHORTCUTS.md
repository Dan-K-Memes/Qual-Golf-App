# Action Button setup

Two ways to send a spoken note to the app. Both start from the iPhone Action Button
(Settings, Action Button, Shortcut, choose your shortcut).

Replace `YOUR-URL` with where you host the app, e.g. `https://you.github.io/qual-golf-app/`.

## Option A: opens the app and saves instantly (simple)

Create a Shortcut called **Golf note** with these actions:

1. **Dictate Text** (Stop Listening: After Pause, language: English)
2. **URL Encode** the Dictated Text (Encode)
3. **Open URLs** with `YOUR-URL#note=` followed by the encoded text

The app shows "Note saved" and returns to the round. Create a second Shortcut **Golf recap**
the same way with `YOUR-URL#kind=recap&note=` followed by the encoded text, and put it on a
Lock Screen or Control Center button (or use Action Button for shots and a double tap for recap).

Notes saved this way get the current hole from the app, and a recap moves to the next hole.
Open the page in Safari (not the Home Screen app) for this option, because iOS opens Shortcut
links in Safari and the two keep separate storage.

## Option B: silent, works with no signal (best on the course)

Notes are appended to a text file and imported after the round.

1. **Dictate Text**
2. **Text**: `Current Date` (format: custom `yyyy-MM-dd HH:mm`), then `|`, then Dictated Text
3. **Append to File** `Shortcuts/golf-notes.txt` (iCloud Drive, create if it does not exist)
4. Optional: **Vibrate Device** so you know it saved

Say "hole 1" or "recap" in the note so the app can tell where holes start and end. At the end of
the round open the Round tab, Import notes, choose `golf-notes.txt`, then Parse.

## Tips

- Say the hole and the distance: "Hole 4, 7 iron, 175 in, into the wind, playing a draw."
- After a hole: "Recap. Bogey 5. Drive missed fairway right, 7 iron from 185 missed green short, 20 feet, two putts."
- Dictation mishears clubs sometimes ("sevn iron"). The review screen is where you fix those.
