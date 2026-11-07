# PackPal

**Catch missing items before a delivery order leaves the store.**

PackPal is a tablet web app for restaurant packing stations. Staff hold each item up to the camera before bagging it. PackPal recognizes the item, checks it off the order, and **won't let the order be marked ready until every item has been scanned**. If something's missing, it says exactly what.

Built in 4 hours for the DoorDash track.

---

## Quick start

You need [Node.js](https://nodejs.org) (version 20.12 or newer) and Google Chrome. There's nothing to install: no `npm install`, no build step.

```bash
npm start
```

Open **http://localhost:3000** in Chrome and click **Allow** when it asks for the camera.

> The camera only works on `http://localhost` or `https://` pages. Run the app on the same laptop whose camera you're using.

### Turn on the AI features (optional)

The AI is only used for unsure scans and for reading ticket photos. Everything else works without it.

```bash
cp .env.example .env
open -e .env        # paste your key from https://openrouter.ai/keys
```

```
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=anthropic/claude-haiku-5.5
```

Restart the server after editing `.env`. Any vision-capable model on OpenRouter works; change `OPENROUTER_MODEL` to swap it. `.env` is in `.gitignore`, so the key never gets committed and never reaches the browser.

---

## First-time setup: teach it your menu

1. Click **Enroll items** (top bar).
2. Tap **Nothing (empty area)**. Point the camera at your empty packing area, with hands moving in view but no item, and press **Capture**. *Do this first.* It stops PackPal from "seeing" items that aren't there.
3. For each menu item: tap or type its name, hold it up, and press **Capture**. During the ~3 seconds, slowly turn it and move it closer and farther.
4. Click **Export backup** to save what it learned to a file.

Item names must match the names on orders (upper/lower case doesn't matter). Enrollment is saved in the browser and survives a reload.

---

## Using it

| Action | How |
|---|---|
| Scan an item | Hold it up until the green bar fills (~0.3 s). Beep = counted. |
| Scan 2 of the same item | Scan one, move it fully out of view, scan the next. |
| Camera can't scan something | Tap the item in the checklist. ↺ undoes one. |
| Finish an order | Tap **Mark ready**, or hold a 👍 to the camera. |
| Add an order from a printed ticket | **＋ Scan ticket**, then take or upload a photo, review, and **Add order**. |
| Pitch demo orders | Turn on **Demo mode** (top right). Switching resets all orders. |

### Demo script (the forgotten drink)

1. Turn on **Demo mode**. Order **#2001** is a Muffin + Coffee.
2. Scan the Muffin only.
3. Tap **Mark ready** (or 👍). PackPal blocks it: **"Missing: 1× Coffee"**.
4. Scan the Coffee. Chime, and the button turns green. Mark ready, and it moves to **Ready for pickup**.

---

## How it works

```
Camera frame
   │
   ├─► MediaPipe gesture recognizer ── 👍 held 0.5 s ──► presses "Mark ready"
   │
   └─► MobileNet ──► 1,280-number "fingerprint" of the image
                         │
                         ▼
                 KNN classifier (compares to your enrolled frames)
                         │
         ┌───────────────┼──────────────────────────┐
     ≥ 85% sure      50–85% sure, or a           < 50%
     not lookalike   lookalike (Coke/Diet Coke)  ignored
         │               │
         │               ▼
         │       Vision AI via /api/vision (runs in background)
         │       "Which of THESE order items is it, or 'unsure'?"
         │               │
         │       ┌───────┴────────┐
         │    named an item    unsure / error / >5 s
         │       │                │
         ▼       ▼                ▼
      Check off ONE unit     Staff tap-to-confirm panel
                │
                ▼
   "Mark ready" → markOrderReady(): every unit of every item scanned?
                   yes → Ready for pickup      no → red "Missing: …"
```

**Recognition runs entirely in the browser.** MobileNet is a model Google already trained on millions of photos; we use it to describe what a frame looks like. The KNN classifier then finds the 10 most similar frames you enrolled and lets them vote. Confidence is the share of votes the winner got. There's no training step and no server, so a restaurant can teach it a new item in about a minute.

**The completion rule is plain, predictable code.** The camera, the AI, and staff taps can each only check off *one unit of one item*. Only `markOrderReady()` in `public/js/orders.js` can complete an order, and it always requires everything to be scanned. The thumbs-up just presses the same button. **The AI can never mark an order complete.**

**The AI is boxed in.** Prompts are written on the server, not in the browser. For item checks, the server only accepts an exact item name from the current order; anything else becomes "unsure". For tickets, the server cleans the result (drops prices and invalid quantities, merges duplicates, matches names to your menu), and staff review it before it's added.

**Double counting is prevented** by a hold time, a cooldown, and a "lock": after an item is scanned, it can't count again until it has left the camera's view.

**Works offline.** TensorFlow.js, MobileNet, and MediaPipe are stored in `public/vendor/`. Only the AI fallback and ticket reading need internet.

---

## Project structure

```
server.js            Serves the app; /api/vision and /api/ticket (holds the API key)
.env.example         Template for your .env (API key + model name)
public/
  index.html         Page layout: orders screen, enroll screen, ticket pop-up
  styles.css         Tablet layout (~1180×820), big touch targets, high contrast
  vendor/            Local copies of TensorFlow.js, MobileNet, MediaPipe
  js/
    config.js        ALL tunable numbers: thresholds, timings, lookalike groups
    orders.js        Mock + demo orders, check-off, and the completion rule
    ui.js            Draws the screen
    camera.js        Webcam on/off, resolution
    recognizer.js    MobileNet + KNN: learn, recognize, save/load
    enroll.js        "Enroll items" screen
    scanner.js       When a recognition counts as a scan; AI fallback; tap-confirm
    ai.js            Talks to /api/vision and /api/ticket
    gesture.js       MediaPipe thumbs-up detection
    ticket.js        "Scan ticket" pop-up
    sounds.js        Beeps (generated, no sound files)
    app.js           Wires it all together; camera loop
```

### Tuning (`public/js/config.js`)

| Setting | Default | Change it if… |
|---|---|---|
| `SCAN_CONFIDENCE` | 0.85 | Scans rarely trigger → lower to 0.75 (or enroll more frames) |
| `HOLD_MS` | 300 | Items scan by accident → raise to 500–700 |
| `AI_ENABLED` | true | Venue Wi-Fi is bad → `false` (unsure scans go to tap-confirm) |
| `AI_LOW_CONFIDENCE` | 0.5 | Too many / too few AI checks |
| `LOOKALIKE_GROUPS` | Coke/Diet Coke, Coffee/Iced Coffee/Latte | Add your own similar-looking items |
| `THUMBS_UP_ENABLED` | true | Gestures cause trouble → `false` |

Lookalike groups only trigger an AI check when **two items from the same group are both enrolled**. If only "Coffee" is enrolled, Coffee scans stay instant and offline.

---

## Known limitations

- **Lookalike packaging.** Coke vs. Diet Coke, or two cups with different drinks inside, can look almost identical to the camera. The AI fallback helps, but if the difference isn't visible (same cup, different contents), neither the camera nor the AI can tell. Staff must tap-confirm.
- **Item modifications aren't visible.** PackPal can't see "no pickles", "oat milk", or "extra sauce" inside a wrapper or cup. Notes read from a ticket are shown as reminders, but they aren't verified.
- **Lighting and background.** Recognition depends on conditions matching enrollment. Glare, dim light, or a changed background reduce accuracy. Re-enroll if the station's lighting changes; it takes about a minute per item.
- **Network dependence for AI.** The AI fallback and ticket reading need internet and an OpenRouter key with credit. When they're slow (>5 s) or offline, PackPal falls back to tap-to-confirm. Core scanning stays offline.
- **It verifies scans, not true bag contents.** PackPal confirms each item was *shown to the camera*, not that it went into the bag. An item scanned and then left on the counter would still count. It's a checklist enforcer, not a bag inspector.
- **One item at a time.** Two identical items held up together count as one. Items must leave the frame between scans.
- **Confidence comes in 10% steps.** KNN confidence is "votes out of 10", so a threshold of 0.85 effectively means 90%.
- **Storage.** Enrolled items live in this browser's local storage (roughly 25 items × 25 frames). Clearing site data erases them, so use **Export backup**. They don't sync between devices.
- **Camera access needs localhost or HTTPS.** A tablet connecting to the laptop over Wi-Fi can't use its camera without an HTTPS setup.
- **Ticket photos from a webcam** are often too low-resolution for small print. Uploading a phone photo works better.
- **Orders are mock data.** There's no real DoorDash/Grubhub/Uber Eats integration, and orders reset on reload.
