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

function timer_now()
{
    return round(microtime(true), 3);
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
    ], is_array($state) ? $state : []);

    if (!in_array($state['status'], ['ready', 'running', 'paused'], true)) $state['status'] = 'ready';
    if (!in_array($state['view'], ['timer', 'standby', 'message'], true)) $state['view'] = 'timer';
    if (!in_array($state['layout'], TIMER_LAYOUTS, true)) $state['layout'] = 'auto';
    $state['duration'] = min(TIMER_MAX, max(0, (int) $state['duration']));
    $state['left'] = min(TIMER_MAX, max(0, (float) $state['left']));
    $state['ends_at'] = (float) $state['ends_at'];
    $state['faces'] = min(4, max(1, (int) $state['faces']));
    $state['fg'] = timer_color($state['fg'], '#ffffff');
    $state['bg'] = timer_color($state['bg'], '#000000');
    $state['recent'] = array_slice(array_values(array_filter((array) $state['recent'], 'is_string')), 0, 5);
    $state['reload'] = (int) $state['reload'];
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
function timer_change(callable $change)
{
    $pdo = db();
    $pdo->beginTransaction();
    try {
        // Writing first takes SQLite's write lock, so other changes wait until this one is committed
        q("INSERT OR IGNORE INTO settings (name, value) VALUES ('timer_state', '{}')");
        $state = timer_defaults(json_decode(q("SELECT value FROM settings WHERE name = 'timer_state'")->fetchColumn(), true));
        $result = $change($state, timer_now());
        q("UPDATE settings SET value = ? WHERE name = 'timer_state'", [json_encode(timer_defaults($state))]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    setting(null); // reload
    return $result;
}

// What a screen needs. The etag lets screens skip downloads when nothing changed.
function timer_screen_payload()
{
    $state = timer_state();
    $data = array_intersect_key($state, array_flip([
        'status', 'left', 'ends_at', 'view', 'message', 'end_text', 'fg', 'bg', 'faces', 'layout', 'reload',
    ]));
    return ['etag' => md5(json_encode($data))] + $data + ['now' => timer_now()];
}

// ---------------------------------------------------------------- connected screens

// A screen checking in
function screen_heartbeat($id, $name, $size)
{
    q('INSERT INTO screens (id, name, size, user_agent, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, size = excluded.size,
       user_agent = excluded.user_agent, last_seen = excluded.last_seen', [
        $id,
        mb_substr(trim(preg_replace('/[^\p{L}\p{N} ._-]/u', '', (string) $name)), 0, 40) ?: null,
        preg_match('/^\d{2,5}x\d{2,5}$/', (string) $size) ? $size : null,
        mb_substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255),
        db_time(),
        db_time(),
    ]);
}

// Screens seen in the last day, online first. A screen is online if it checked in during the last 15 seconds.
function screens()
{
    q('DELETE FROM screens WHERE last_seen < ?', [db_time('-1 day')]);
    return q('SELECT *, last_seen > ? AS online FROM screens ORDER BY online DESC, last_seen DESC', [db_time('-15 seconds')])->fetchAll();
}
