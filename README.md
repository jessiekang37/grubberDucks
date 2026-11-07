# Pack’em

**Every item. Every order.** A camera-assisted packing station for restaurant orders.

Show one item to the camera, confirm any uncertain matches, and mark the order ready when every unit is checked. Staff can also enter orders and check items manually. Modifiers are visible reminders; the camera cannot verify ingredients inside a wrapper or cup.

## Run

Node.js 20.12 or newer; no dependency installation or build step required.

```sh
npm start
```

Open [localhost:3000](http://localhost:3000). Camera access requires localhost or HTTPS. The app loads its recognition libraries and model from local files.

```sh
npm test
```

The tests cover unknown rejection, ambiguous matches, class imbalance, consecutive scan evidence, duplicate prevention, quantities, repeated ticket lines, saved progress, and backup integrity using real TensorFlow tensors.

## What changed

- **More conservative matching:** each menu item gets equal representation in matching, regardless of how many examples were recorded. Absolute similarity and the gap between competing items must both pass checks. Unfamiliar views are rejected instead of always being assigned to a known item.
- **More forgiving training:** one capture records 24 views, with automatic mild exposure and zoom variations. Very dark, overexposed, and nearly identical-to-background views are skipped. Up to 180 recent examples per item are retained.
- **Stable counts:** three consecutive reliable frames over at least 180 ms are needed. A reliably empty view lasting 400 ms releases the lock for the next item. Changing predictions alone cannot count the same object twice.
- **AI photo checks without training:** explicitly check the current frame against the order, even if that item has never been enrolled. Uncertain results require staff confirmation.
- **Saved progress:** normal and demo queues save separately on this browser. Reloading preserves checked quantities, order selection, notes, and ready orders.
- **A responsive packing station:** order search, progress meters, pause/resume, source labels, keyboard focus states, and mobile/tablet layouts.
- **Editable orders:** enter an order manually or review a ticket photo, editing names, quantities, notes, customer, and platform before adding it.
- **Compatible backups:** existing PackPal training storage and JSON exports still load. Invalid imports are rejected before existing training is replaced; float16 backups also load on browsers without native Float16Array.

These are implementation safeguards, not a measured accuracy claim. Thresholds still need validation with your menu, camera, lighting, and real packing movements.

## Teach the menu

1. Open **Teach menu** and choose **Nothing (empty area)**. Capture the empty packing station, with typical hand movements but no item.
2. Choose or type an item's name. Names match orders without regard to case.
3. Press **Capture item**. After the countdown, keep the item visible while slowly rotating it through different angles. Recording takes roughly five seconds plus device-dependent inference time.
4. Return to the order screen and try a scan. Add another capture if a particular side, distance, or lighting condition is missed.
5. **Export backup** before moving devices or clearing browser data.

Automatic checks require at least six examples for the background and the matching item. The displayed percentage is a **match score**, not a calibrated probability. Similar-looking cups, invisible ingredients, bad labels, and very different backgrounds still need staff judgment.

Keep the item visible during training; automated variations cannot correct a session labeled with the wrong item. Clearing the view briefly between scans prevents double counts. The app favors confirmation over guessing, so very fast swipes may need a short hold.

## Packing workflow

| Action | How |
| --- | --- |
| Scan | Show one item briefly, then remove it; wait for a clear view before the next. |
| Untrained item | Use **Check photo with AI**, or tap its checklist row. |
| Correct a count | Tap ↺ beside the item. |
| Pause | **Pause scanning** stops automatic counts and gestures; manual check-off still works. |
| Complete | **Mark ready**, or hold a thumbs-up. Missing items always block completion. |
| Add an order | **＋ Add order** → photograph/upload a ticket or **Enter order manually**. |
| Find an order | Search by order number, customer, or platform. |
| Demo | Switch **Demo mode**; each mode retains its own queue. |
| Fresh demo/sample orders | **Reset sample queue** replaces only the current mode's progress after confirmation. |

Identically named items with different notes count toward the next unfilled line; the camera does not determine which modifier was prepared. Check those notes by hand.

## Optional AI

Copy `.env.example` to `.env`, set `OPENROUTER_API_KEY`, and choose a vision-capable `OPENROUTER_MODEL`. Restart the server. The key stays on the server and is never returned to the browser. `.env` is ignored by Git.

AI fallback, explicit photo checks, and ticket reading send the selected image to the configured OpenRouter model. Local recognition does not send camera frames to the server. The connection indicator reports whether a key is configured; it does not verify credit or model availability.

An AI response must exactly match a provided item name or becomes `unsure`. AI checks are serialized; stale responses are ignored after switching orders, entering another screen, pausing, undoing, or manually checking an item. The AI never marks an order ready. Unavailable or uncertain AI falls back to a staff confirmation panel.

Known lookalike groups (Coffee / Iced Coffee / Latte and Coke / Diet Coke) require AI or staff confirmation even if only one variant is enrolled. Customize these in `public/js/config.js`.

## Recognition settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `MIN_SIMILARITY` | 0.72 | Minimum cosine similarity; lower matches are unfamiliar. |
| `MIN_CLASS_MARGIN` | 0.045 | Required gap between the two strongest classes. |
| `NEIGHBORS_PER_CLASS` | 3 | Average of each class's best matching examples. |
| `SCAN_CONFIDENCE` | 0.78 | Minimum combined similarity/separation score. |
| `SWIPE_MIN_FRAMES` | 3 | Consecutive reliable frames required. |
| `SCAN_MIN_DURATION_MS` | 180 | Minimum time gathering evidence. |
| `RELEASE_MS` | 400 | Reliable empty-view duration before another scan. |
| `MAX_EXAMPLES_PER_CLASS` | 180 | Recent examples retained per item. |
| `AI_ENABLED` | true | Enables AI item checks. |
| `THUMBS_UP_ENABLED` | true | Enables gesture completion through the same missing-item rule. |

## Files

- `server.js`: static hosting, AI status, item vision, and ticket parsing.
- `public/js/matching.js`: pure embedding comparison and rejection logic.
- `public/js/recognizer.js`: MobileNet, training variations, caching, and compatible backup storage.
- `public/js/scanner.js`: scan evidence, locks, AI fallback, and staff confirmation.
- `public/js/orders.js`: quantities, local persistence, and completion rules.
- `public/js/enroll.js`, `ticket.js`, `app.js`, `ui.js`: workflows and UI.
- `public/js/config.js`: recognition and timing settings.
- `public/vendor/`: locally bundled models and libraries.
- `tests/`: Node test runner regression coverage.

## Practical limits

This verifies that items were shown or confirmed, not that they physically stayed in the bag. It cannot identify concealed contents or verify modifiers. One item should be shown at a time. Local storage is device/browser-specific and can fill up; export backups. Order persistence does not synchronize between tabs or devices. The starter queues are sample data with no delivery-platform integration. AI needs internet access and a configured, working model.
