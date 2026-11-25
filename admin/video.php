<?php
// Changes the reveal video. The control room sends it in pieces (assets/js/control.js), so no upload limit of the
// server or of the network in between gets in the way. The pieces are put together next to the database, out of
// the web's reach, and the finished video takes the place of the old one (REVEAL_FILE).
require __DIR__ . '/includes/auth.php';
require __DIR__ . '/../includes/timer.php';
require __DIR__ . '/includes/control.php';

if (!is_post()) redirect('admin/index.php');
check_csrf();
session_write_close(); // the control room keeps checking for changes meanwhile

function video_fail($message, $status = 400)
{
    json_out(['ok' => false, 'toast' => $message], $status);
}

$id = (string) ($_POST['id'] ?? '');
$offset = (int) ($_POST['offset'] ?? -1); // where this piece goes in the video
$size = (int) ($_POST['size'] ?? 0);      // the whole video
$name = mb_substr(trim(preg_replace('/[\x00-\x1f\x7f]+/u', '', basename((string) ($_POST['name'] ?? '')))), 0, 120) ?: 'reveal.mp4';
$piece = $_FILES['piece'] ?? null;

if (!preg_match('/^[a-f0-9]{16,32}$/', $id) || $offset < 0 || $size < 1) video_fail('Unknown action.');
if ($size > REVEAL_MAX) video_fail('That video is larger than ' . REVEAL_MAX / 1048576 . ' MB.');
if (!$piece || ($piece['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($piece['tmp_name'])) {
    video_fail('Part of the video did not arrive. Try again.');
}

$dir = dirname(DB_FILE);
$part = $dir . '/reveal-' . $id . '.part';
$length = filesize($piece['tmp_name']);
if ($offset === 0) {
    foreach (glob($dir . '/reveal-*.part') ?: [] as $old) { // uploads given up on
        if (filemtime($old) < time() - 86400) @unlink($old);
    }
    @unlink($part);
}
clearstatcache(true, $part);
$have = is_file($part) ? filesize($part) : 0;
if ($have === $offset + $length && $offset > 0) {
    // this piece arrived before, but its answer was lost on the way: nothing to add
} elseif ($have !== $offset || $offset + $length > $size) {
    @unlink($part);
    video_fail('The upload got out of step. Choose the video again.', 409);
} elseif (file_put_contents($part, file_get_contents($piece['tmp_name']), FILE_APPEND | LOCK_EX) !== $length) {
    @unlink($part);
    video_fail('The video could not be saved on the server.', 500);
}

if ($offset + $length < $size) json_out(['ok' => true]); // more to come

// The whole video is here. An MP4 starts with an ftyp box: anything else is not one.
$head = (string) file_get_contents($part, false, null, 0, 12);
if (substr($head, 4, 4) !== 'ftyp') {
    @unlink($part);
    video_fail('That file is not an MP4 video.');
}
if (!is_dir(dirname(REVEAL_FILE))) mkdir(dirname(REVEAL_FILE), 0755, true);
if (!@rename($part, REVEAL_FILE)) {
    $copied = @copy($part, REVEAL_FILE);
    @unlink($part);
    if (!$copied) video_fail('The video could not be saved on the server.', 500);
}

timer_change(function (&$s, $now) use ($name, $size) {
    $s['video'] = ['name' => $name, 'size' => $size, 'at' => $now];
});
log_activity('video', 'Changed the reveal video to ' . $name);
json_out(['ok' => true, 'toast' => 'Video changed. Screens download it before zero.'] + cr_payload() + timer_clock());
