<?php
// Full-screen countdown for the LED screen.
// Open: screen.php?key=YOUR_SCREEN_KEY   (the link is in the admin panel; add &name=Pillar to label a screen)
// What it shows is controlled from the admin control room.
require __DIR__ . '/includes/timer.php';

$key = (string) ($_GET['key'] ?? '');
if (setting('screen_key') === '' || !hash_equals(setting('screen_key'), $key)) {
    if (isset($_GET['state'])) json_out(['error' => 'key'], 403);
    http_response_code(403);
    exit('Screen key missing or wrong. Copy the screen link from the admin panel.');
}
session_write_close(); // screens don't need the session; don't hold it while polling

// The screen checks in every 2 seconds: it reports itself and gets the latest state
if (isset($_GET['state'])) {
    $screen = (string) ($_GET['screen'] ?? '');
    if (preg_match('/^[a-z0-9]{8,32}$/', $screen)) {
        screen_heartbeat($screen, $_GET['name'] ?? '', $_GET['size'] ?? '');
    }
    $data = timer_screen_payload();
    if (($_GET['etag'] ?? '') === $data['etag']) {
        json_out(['same' => true, 'now' => $data['now']]);
    }
    json_out($data);
}

$data = timer_screen_payload();
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
<div class="screen" data-screen data-feed="<?= e(url('screen.php?key=' . urlencode($key))) ?>" style="--fg: <?= e($data['fg']) ?>; --bg: <?= e($data['bg']) ?>"></div>
<script type="application/json" id="screen-data"><?= json_encode($data, JSON_HEX_TAG | JSON_HEX_AMP) ?></script>
<script src="<?= asset('js/timer.js') ?>" defer></script>
<script src="<?= asset('js/screen.js') ?>" defer></script>
</body>
</html>
