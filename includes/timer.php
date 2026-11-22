<?php
// Timer state, shared by the screens (screen.php) and the control room (admin/index.php).
//
// Screens never count on their own. While the timer runs the state says when it reaches zero (`ends_at`);
// while it is set or paused it says how many seconds are left (`left`). Every screen and the control room
// work out the same time from that and the server clock, so they all show the same second.
// The same maths lives in Countdown.left() in assets/js/timer.js — keep the two in sync.

require_once __DIR__ . '/functions.php';

const TIMER_MAX = 999 * 3600 + 59 * 60 + 59; // 999:59:59
const TIMER_LAYOUTS = ['auto', 'line', 'stacked'];
const SCREEN_WAIT = 15; // seconds a screen's check-in is held open waiting for a change

function timer_now()
{
    return round(microtime(true), 3);
}

// When the server got this request and when it answers. With the times the browser sent the request and got
// the answer, that pins down the server clock to within half the network delay, the way NTP does it
// (see Countdown.Clock in assets/js/timer.js). Take it just before sending the answer.
function timer_clock()
{
    return [
        'received' => round($_SERVER['REQUEST_TIME_FLOAT'] ?? microtime(true), 4),
        'now'      => round(microtime(true), 4),
    ];
}

// Fills in and cleans up a stored state
function timer_defaults($state)
{
    $state = array_merge([
        'status'   => 'ready',   // ready (set, not started) | running | paused
        'duration' => 600,       // what the timer was set to; reset goes back to this
        'left'     => 600.0,     // seconds left while ready or paused
        'ends_at'  => 0.0,       // unix time it reaches zero while running
        'view'     => 'timer',   // what the screen shows: timer | standby | message
        'message'  => '',
        'recent'   => [],        // last few messages, for one-tap reuse
        'end_text' => '',        // shown at zero instead of 00:00:00 ('' = hold 00:00:00)
        'fg'       => '#ffffff',
        'bg'       => '#000000',
        'faces'    => 1,         // the timer repeated side by side, e.g. once per side of a pillar
        'layout'   => 'auto',    // auto | line (10:00:00) | stacked (hours, minutes, seconds on top of each other)
        'reload'   => 0,         // raised to make every screen reload itself
        'changed'  => 0.0,       // server time of the last change
    ], is_array($state) ? $state : []);

    if (!in_array($state['status'], ['ready', 'running', 'paused'], true)) $state['status'] = 'ready';
    if (!in_array($state['view'], ['timer', 'standby', 'message'], true)) $state['view'] = 'timer';
    if (!in_array($state['layout'], TIMER_LAYOUTS, true)) $state['layout'] = 'auto';
    $state['duration'] = min(TIMER_MAX, max(0, (int) $state['duration']));
    $state['left'] = round(min(TIMER_MAX, max(0, (float) $state['left'])), 3); // to the millisecond
    $state['ends_at'] = round((float) $state['ends_at'], 3);
    $state['faces'] = min(4, max(1, (int) $state['faces']));
    $state['fg'] = timer_color($state['fg'], '#ffffff');
    $state['bg'] = timer_color($state['bg'], '#000000');
    $state['recent'] = array_slice(array_values(array_filter((array) $state['recent'], 'is_string')), 0, 5);
    $state['reload'] = (int) $state['reload'];
    $state['changed'] = (float) $state['changed'];
    return $state;
}

function timer_color($value, $fallback)
{
    return is_string($value) && preg_match('/^#[0-9a-f]{6}$/i', $value) ? strtolower($value) : $fallback;
}

function timer_state()
{
    return timer_defaults(json_decode(setting('timer_state'), true));
}

// Seconds left at $now
function timer_left($state, $now)
{
    if ($state['status'] === 'running') return max(0, $state['ends_at'] - $now);
    return $state['left'];
}

// 600 → '00:10:00'. Rounds up, so the screen shows 00:00:01 until the very end.
function timer_format($seconds)
{
    $t = (int) ceil(round($seconds, 3));
    return sprintf('%02d:%02d:%02d', intdiv($t, 3600), intdiv($t % 3600, 60), $t % 60);
}

// 5400 → '1 h 30 min'
function timer_words($seconds)
{
    $t = (int) round($seconds);
    $parts = [];
    if ($t >= 3600) $parts[] = intdiv($t, 3600) . ' h';
    if ($t % 3600 >= 60) $parts[] = intdiv($t % 3600, 60) . ' min';
    if ($t % 60 || !$parts) $parts[] = $t % 60 . ' s';
    return implode(' ', $parts);
}

// Changes the state safely (one change at a time). $change gets (&$state, $now); whatever it returns is passed back.
// $at is the server time the admin pressed the button, worked out in their browser. If it is within the last
// 2 seconds it is used as $now, so the timer starts or stops on the moment of the press, not when the request
// arrived. Never before the last change, so presses still apply in order.
function timer_change(callable $change, $at = 0)
{
    $pdo = db();
    $pdo->beginTransaction();
    try {
        // Writing first takes SQLite's write lock, so other changes wait until this one is committed
        q("INSERT OR IGNORE INTO settings (name, value) VALUES ('timer_state', '{}')");
        $state = timer_defaults(json_decode(q("SELECT value FROM settings WHERE name = 'timer_state'")->fetchColumn(), true));
        $before = $state;
        $now = timer_now();
        if ($at > $now - 2 && $at < $now) $now = max(round($at, 3), $state['changed']);
        $result = $change($state, $now);
        if ($state !== $before) { // a refused or repeated press changes nothing, so it isn't written
            $state['changed'] = $now;
            q("UPDATE settings SET value = ? WHERE name = 'timer_state'", [json_encode(timer_defaults($state))]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    setting(null); // reload
    return $result;
}

// What a screen needs. The etag lets screens skip downloads when nothing changed.
function timer_screen_payload($state = null)
{
    $data = array_intersect_key($state ?? timer_state(), array_flip([
        'status', 'left', 'ends_at', 'view', 'message', 'end_text', 'fg', 'bg', 'faces', 'layout', 'reload',
    ]));
    return ['etag' => md5(json_encode($data))] + $data;
}

// ---------------------------------------------------------------- connected screens

// What a screen gets when it checks in: the payload, ['same' => true] when its $etag is still current, or null
// when $key is no longer the screen key. With $wait the request is held open until the timer changes (checked
// 20 times a second) or $wait seconds pass, so a change reaches every screen at once instead of at its next
// check-in. $beat runs every 5 seconds meanwhile, to keep the screen marked online.
function screen_feed($key, $etag, $wait, callable $beat)
{
    $until = microtime(true) + $wait;
    $next_beat = 0;
    $seen = null;
    while (true) {
        if (microtime(true) >= $next_beat) {
            $beat();
            $next_beat = microtime(true) + 5;
        }
        $rows = q("SELECT name, value FROM settings WHERE name IN ('screen_key', 'timer_state')")->fetchAll(PDO::FETCH_KEY_PAIR);
        $raw = ($rows['screen_key'] ?? '') . "
" . ($rows['timer_state'] ?? '');
        if ($raw !== $seen) {
            $seen = $raw;
            if (($rows['screen_key'] ?? '') === '' || !hash_equals($rows['screen_key'], $key)) return null;
            $data = timer_screen_payload(timer_defaults(json_decode($rows['timer_state'] ?? '', true)));
            if ($data['etag'] !== $etag) return $data;
        }
        if (microtime(true) >= $until) return ['same' => true];
        usleep(50000);
    }
}

// A screen checking in. It is written only when its name or size changed or every few seconds,
// so many check-ins don't queue up for the database's one writer.
function screen_heartbeat($id, $name, $size)
{
    $name = mb_substr(trim(preg_replace('/[^\p{L}\p{N} ._-]/u', '', (string) $name)), 0, 40) ?: null;
    $size = preg_match('/^\d{2,5}x\d{2,5}$/', (string) $size) ? $size : null;
    $seen = q('SELECT name, size, last_seen FROM screens WHERE id = ?', [$id])->fetch();
    if ($seen && $seen['name'] === $name && $seen['size'] === $size && $seen['last_seen'] > db_time('-4 seconds')) {
        return;
    }
    q('INSERT INTO screens (id, name, size, user_agent, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, size = excluded.size,
       user_agent = excluded.user_agent, last_seen = excluded.last_seen', [
        $id,
        $name,
        $size,
        mb_substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255),
        db_time(),
        db_time(),
    ]);
}

// Screens seen in the last day, online first. A screen is online if it checked in during the last 15 seconds.
function screens()
{
    $old = db_time('-1 day');
    if (q('SELECT 1 FROM screens WHERE last_seen < ? LIMIT 1', [$old])->fetchColumn()) { // reading doesn't block screens
        q('DELETE FROM screens WHERE last_seen < ?', [$old]);
    }
    return q('SELECT *, last_seen > ? AS online FROM screens ORDER BY online DESC, last_seen DESC', [db_time('-15 seconds')])->fetchAll();
}
