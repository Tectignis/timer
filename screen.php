<?php
// Full-screen countdown for the LED screen.
// Open: screen.php?key=YOUR_SCREEN_KEY&face=side&ribbon=video   (the links are in the admin panel; add &name=Pillar to label a screen)
// &ribbon=video moves light along the gold ribbon, &ribbon=static keeps it still. Without it the ribbon moves.
// &face=side or &face=front keeps the shape of that face of the monolith. Without it the screen fills the window.
// The sides (&face=side, static or video) show the words of SCREEN_WORDS in includes/timer.php instead of the
// countdown: no digits and no ribbon. They still check in, so the control room sees them and can reload them.
// What it shows is controlled from the admin control room.
define('NO_SESSION', true); // screens never sign in
require __DIR__ . '/includes/timer.php';

$key = (string) ($_GET['key'] ?? '');
if (setting('screen_key') === '' || !hash_equals(setting('screen_key'), $key)) {
    if (isset($_GET['state'])) json_out(['error' => 'key'], 403);
    http_response_code(403);
    exit('Screen key missing or wrong. Copy the screen link from the admin panel.');
}

// The screen checks in all the time: it reports itself and gets the latest state. With &wait the server holds the
// request until something changes, so every screen follows the control room at once.
if (isset($_GET['state'])) {
    $screen = (string) ($_GET['screen'] ?? '');
    $beat = function () use ($screen) {
        if (!preg_match('/^[a-z0-9]{8,32}$/', $screen)) return;
        try {
            screen_heartbeat($screen, $_GET['name'] ?? '', $_GET['size'] ?? '');
        } catch (PDOException $e) {
            // the database is busy: the next check-in marks it
        }
    };
    // PHP's own test server answers one request at a time, so it must not hold one
    $wait = isset($_GET['wait']) && PHP_SAPI !== 'cli-server' ? SCREEN_WAIT : 0;
    $data = screen_feed($key, (string) ($_GET['etag'] ?? ''), $wait, $beat);
    if ($data === null) json_out(['error' => 'key'], 403);
    json_out($data + timer_clock());
}

$ribbon = ($_GET['ribbon'] ?? '') === 'static' ? 'static' : 'video';
// &face=side or &face=front: the screen keeps that face's shape, in the middle of a window of another shape
$face = (string) ($_GET['face'] ?? '');
[$face_name, $face_w, $face_h] = SCREEN_FACES[$face] ?? ['', 0, 0];
// A face that shows fixed words: they come with the page, so the countdown never shows there, not even for a moment.
// data-face carries the display name ("Sides"); data-face-id carries the face from the link ("side") for scripts.
$words = $face_name ? SCREEN_WORDS[$face] ?? [] : [];
// The faces are equally tall, so the digits are as large on every face as on the narrowest one
$digit_scale = $face_name ? round(min(array_map(fn ($f) => $f[1] / $f[2], SCREEN_FACES)) / ($face_w / $face_h), 4) : 1;
$data = timer_screen_payload() + timer_clock(); // the clock before anything is sent: the page is the first measurement
header('Cache-Control: no-store'); // a stored copy would carry an old clock and state
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Countdown</title>
<link rel="icon" href="<?= asset('img/favicon.svg') ?>" type="image/svg+xml">
<link rel="stylesheet" href="<?= asset('css/screen.css') ?>">
</head>
<body class="screen-page" style="background: <?= e($data['bg']) ?>">
<div class="screen<?= $words ? ' is-words' : '' ?>" data-screen data-ribbon="<?= $ribbon ?>"<?php if ($face_name): ?> data-face="<?= e($face_name) ?>" data-face-id="<?= e($face) ?>" data-digit-scale="<?= $digit_scale ?>"<?php endif; ?><?= $words ? ' data-words' : '' ?> data-reveal="<?= e($words ? '' : reveal_url($face)) ?>" data-feed="<?= e(url('screen.php?key=' . urlencode($key))) ?>" style="--fg: <?= e($data['fg']) ?>; --bg: <?= e($data['bg']) ?><?= $face_name ? '; --ratio: ' . round($face_w / $face_h, 4) : '' ?>"><?php if ($words): ?><div class="words" role="img" aria-label="<?= e(implode(' ', $words)) ?>"><?php foreach ($words as $word): ?><span class="words__w"><?= e($word) ?></span><?php endforeach; ?></div><?php endif; ?></div>
<script type="application/json" id="screen-data"><?= json_encode($data, JSON_HEX_TAG | JSON_HEX_AMP) ?></script>
<script src="<?= asset('js/timer.js') ?>" defer></script>
<script src="<?= asset('js/screen.js') ?>" defer></script>
</body>
</html>
