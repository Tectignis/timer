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

1. In the control room, copy a screen link (Screens). The monolith has two face shapes, each with its own links: **Sides** (1500 × 3000 mm) and **Front and back** (2000 × 3000 mm). Each comes as a **video link**, which moves light along the gold ribbon, and a **static link**, which keeps the ribbon still. The front and back links show the countdown and follow the timer. The sides links (both of them) show only the words *zero zero zero*, stacked in gold on the background: no digits and no ribbon, until their own reveal video (the side video) plays after zero. They still check in, go blank on standby and reload with the rest. The words are set in `SCREEN_WORDS` in `includes/timer.php`.
2. Open it in Chrome on the computer or media box that feeds that face. Press F11, so the browser bars and the taskbar don't show on the LED. The face is laid out in its own shape and then stretched to fill the whole screen. The LED squeezes the computer's picture onto the face, which brings it back into shape. On a 16:9 laptop it looks stretched sideways, and on the face it looks right. The digits are the same size and at the same height on every face, so the time lines up round the corners. The ribbon fills each face's width.
3. A screen shows up in the control room as "Sides" or "Front and back". Add `&name=Left` to the end of the link to give it its own name.

For a screen that runs all day, start Chrome in kiosk mode (`chrome --kiosk "<screen link>"`) and turn off sleep and the screensaver on that computer. The page also asks the browser to keep the display awake, and hides the mouse pointer until it moves.

## Where things are

| File / folder | What it does |
|---|---|
| `screen.php?key=…&face=side&ribbon=video` | Full-screen countdown for one face of the monolith (`face=side` or `face=front`), stretched to fill the screen. `face=side` shows the words of `SCREEN_WORDS` instead of the countdown, until the reveal video. Left out, it is laid out for the window's own shape. It keeps a check-in open, so changes arrive at once. `&ribbon=static` keeps the gold ribbon still. |
| `admin/index.php` | Control room: start, pause, reset, adjust, set a duration or an end time, message, standby, display settings, after the timer (reveal video and its simulation), connected screens |
| `admin/video.php` | Takes a new front and back video or side video from the control room, sent in pieces |
| `videos/` | The reveal videos: `front_back.mp4` (front and back) and `side.mp4` (sides). Changed from the control room, not in the repo |
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
- **After the timer:** set in the After the timer card. *Reveal video* (the default) holds 00:00:00 for the seconds set under "Video starts" (3 by default), then plays the reveal videos in a loop: the **front and back video** on the front and back links (and on a link without a face), the **side video** on the sides links. Every screen plays its video in step with the clock, so all faces show the same moment, and a screen opened later joins at the right moment. Screens download their video whole from half an hour before zero, so it plays smoothly even on a slow network. It never waits for that: a screen without the download plays it straight from the server the moment it is due, and the control room always does. Without its video, the front and back hold 00:00:00 and the sides keep their words. *00:00:00* blinks it a few times and holds it.
- **Video on each face:** a video made in its face's shape (2000 × 3000 for the front and back, 1500 × 3000 for the sides) shows whole, neither cut nor stretched, whatever is chosen here. This only matters for a video of another shape. *Full width* (the default) fills the whole face. It widens the picture by up to a tenth, too little to notice, so less is cut off, and cuts the rest off the top, so the logos and small print at the bottom stay (a video wider than the face loses it at both sides). *Soft sides* shows the whole video and fills the rest of the face with its own light and colour, blurred. *Plain sides* shows the whole video on the background. *Stretch* stretches the whole video to the face. While it plays, the face is drawn straight onto the window rather than stretched to it, so the video lands right from its first frame.
- **Changing the videos:** After the timer → Video management has a card for each video: **Front & Back Screen Video** (recommended 2000 × 3000 px, width × height) and **Side Screen Video** (recommended 1500 × 3000 px). Each card plays its video and shows its file name, size, duration, resolution (marked when it isn't its screens' shape) and when it was saved. Change video takes an MP4 (H.264) of up to 300 MB: the browser checks that it plays and shows it in the card, and Save video sends it in 8 MB pieces, so no upload limit gets in the way. The two are saved separately, into `videos/` as `front_back.mp4` and `side.mp4`, and the screens of that shape pick up the new video at once.
- **Simulation:** After the timer → Play simulation starts at once and counts down 5, 4, 3, 2, 1 on a model of the sides and the front, then goes on as the screens would, each face with its own video, with the settings in the card (saved or not). It leaves the real timer and the screens alone.
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

Without the font the gold look falls back to Georgia. Without the ribbon video it shows the still ribbon, and with neither ribbon file it draws no ribbon.

## Reveal videos

The videos played after zero are kept in `videos/` and are not in the repo. Add them from the control room (After the timer → Video management), which saves them there:

- `videos/front_back.mp4`: the front and back video, 2000 × 3000 (e.g. "Monolitth_3000x2000.mp4")
- `videos/side.mp4`: the side video, 1500 × 3000 (e.g. "Monolitth 3000x1500.mp4")

To copy one in by hand instead, drop its silent sound track first, then press Reload screens:
`ffmpeg -i "Monolitth 3000x1500.mp4" -map 0:v:0 -c copy -movflags +faststart videos/side.mp4`

Without the front and back video those screens hold 00:00:00 at zero; without the side video the sides keep their words. The single `assets/brand/reveal.mp4` of earlier versions is no longer used and can be deleted.
