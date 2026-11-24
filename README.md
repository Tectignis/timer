# Countdown

Countdown timer for an LED screen, run from an admin control room. The screen shows only the timer (big HH:MM:SS digits). The admin sets, starts, pauses and adjusts it, and every screen follows at once.

Plain PHP + SQLite. No framework, no Composer, no build step.

## Run it locally (XAMPP)

1. Put this folder at `xampp/htdocs/countdown` and start **Apache** (MySQL is not needed).
2. Copy `includes/config.sample.php` to `includes/config.php` and set `SECRET_KEY` to a long random string.
3. Open <http://localhost/countdown/install.php>. It creates the database file (`database/countdown.sqlite`) and asks you to make the first admin.
4. Admin: <http://localhost/countdown/admin/>

On the command line you can do step 3 with: `php install.php "Your Name" you@example.com "a-strong-password"`

## Put it online

1. Upload everything except your local `database/countdown.sqlite*` files.
2. Copy `includes/config.sample.php` to `includes/config.php` and set:
   - `DB_FILE`: where the SQLite database lives. PHP must be able to write to that folder. The default `database/` folder is blocked from the web by `.htaccess`. On a server that ignores `.htaccess` (e.g. nginx), put it outside the web root.
   - `BASE_URL`: `''` if the site sits at the domain root, otherwise the folder name, e.g. `'/countdown'`
   - `SITE_URL`: the full public address, used in the screen link
   - `SECRET_KEY`: a new long random string
   - `DEBUG`: `false`
3. Copy the brand files into `assets/brand/` (see Fonts). They are not in the repo.
4. Open `/install.php` once, then delete it.
5. Use HTTPS.

## Setting up the screen

1. In the control room, copy a screen link (Screens). The monolith has two face shapes, each with its own links: **Sides** (1500 × 3000 mm) and **Front and back** (2000 × 3000 mm). Each comes as a **video link**, which moves light along the gold ribbon, and a **static link**, which keeps the ribbon still. All of them follow the same timer.
2. Open it in Chrome on the computer or media box that feeds that face. Press F11 or double-click for full screen. A face keeps its shape: in a window of another shape it sits in the middle with the background around it.
3. A screen shows up in the control room as "Sides" or "Front and back". Add `&name=Left` to the end of the link to give it its own name.

For a screen that runs all day, start Chrome in kiosk mode (`chrome --kiosk "<screen link>"`) and turn off sleep and the screensaver on that computer. The page also asks the browser to keep the display awake.

## Where things are

| File / folder | What it does |
|---|---|
| `screen.php?key=…&face=side&ribbon=video` | Full-screen countdown for one face of the monolith (`face=side` or `face=front`, left out it fills the window). It keeps a check-in open, so changes arrive at once. `&ribbon=static` keeps the gold ribbon still. |
| `admin/index.php` | Control room: start, pause, reset, adjust, set a duration or an end time, message, standby, display settings, connected screens |
| `admin/activity.php` | Who did what, and when |
| `admin/profile.php` | Change your name, email or password |
| `includes/timer.php` | Timer state shared by the screens and the control room |
| `includes/functions.php` | Shared helpers: database, security, settings |
| `assets/js/timer.js` | Countdown maths and drawing, used by the screen and the control room preview |
| `database/schema.sql` | Database tables |

## How it works

- **One source of truth:** while the timer runs, the server stores the moment it reaches zero. While it is set or paused, the server stores the time left. Each screen works out the time from that and the server clock, so all screens show the same second. If the network drops, the screen keeps counting.
- **Clock:** every answer from the server says when the request arrived and when the answer left. With the browser's own record of when the request left and the answer came back, each screen pins the server clock to a range (the way NTP works). Every recent measurement must be right, so the screen runs on the middle of where they all overlap, which narrows with each check-in. It counts with the browser's steady clock, so changing the computer's time does nothing, and it measures again after the computer sleeps. Each new second is drawn the moment it is due, and redrawn on time whenever the clock is corrected.
- **Instant changes:** a screen's check-in is held open on the server for up to 15 seconds and answered the moment the timer changes. Start, pause and adjust use the moment the button was pressed, so the timer stops on the second the admin saw.
- **Look:** *Gold ribbon* (the default) draws the brand digits in gold on one line with the ribbon under them, placed as on the 3000 × 7000 artwork. Light moves along the ribbon on a 15 second loop, except on the static link. On a screen of another shape it stays as wide as the screen and moves up or down to fit. Messages sit above the ribbon. *Plain* draws the digits in the Digits colour with the layout below.
- **Layout (Plain):** the digits fill whatever resolution the screen has. *Auto* puts hours, minutes and seconds on top of each other on tall screens (like one side of a pillar) and on one line on wide ones. *Repeat side by side* (either look) draws the timer 2 to 4 times across the screen, one per side of a pillar fed from a single wide output.
- **At zero:** set in Display → "At zero, show". *Reveal video* (the default) plays the reveal video in a loop. Every screen plays it in step with the clock, so all faces show the same frame, and a screen opened later joins at the right moment. Screens download it whole from half an hour before zero, so it starts on the second even on a slow network. Until it has arrived, or without the file, the screen holds 00:00:00. *00:00:00* blinks it a few times and holds it. *Text* shows the text typed there.
- **Screen shows:** *Timer*, *Message* (big text) or *Standby* (blank). The timer keeps counting behind a message or standby.
- **Keyboard (control room):** Space to start or pause, R to reset.
- **Screen links:** "Make new links" stops the old video and static links working. Screens on them go blank.

## Fonts

In the Plain look the timer digits use **Roboto Bold**, and admin headings use **Archivo**. Both are open-source fonts and are served from `assets/fonts/`.

The Gold ribbon look needs three brand files that are licensed to the client and kept out of the repo. Copy them to each server by hand:

- `assets/brand/digits.woff2`: the brand serif (Regular), converted to WOFF2
- `assets/brand/ribbon.webp`: the ribbon cut from the artwork, 3000 px wide with a transparent background
- `assets/brand/ribbon.webm`: the moving ribbon ("Pre-reveal ribbon.mov"), cut to the ribbon and kept transparent:
  `ffmpeg -i "Pre-reveal ribbon.mov" -an -vf crop=1500:356:0:774 -c:v libvpx-vp9 -pix_fmt yuva420p -crf 20 -b:v 0 -auto-alt-ref 0 -row-mt 1 ribbon.webm`
- `assets/brand/reveal.mp4`: the reveal video played at zero ("Monolitth_5.mp4", 1500 × 3500), without its silent sound track:
  `ffmpeg -i Monolitth_5.mp4 -map 0:v:0 -c copy -movflags +faststart reveal.mp4`
  It is shown whole on every face, with the background at its sides. When artwork made for a face arrives, save it as `reveal-side.mp4` or `reveal-front.mp4` (H.264 MP4) and that face plays it instead.

Without the font the gold look falls back to Georgia. Without the ribbon video it shows the still ribbon, and with neither ribbon file it draws no ribbon. Without a reveal video the screen holds 00:00:00 at zero.
