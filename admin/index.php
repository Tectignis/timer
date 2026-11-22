<?php
require __DIR__ . '/includes/auth.php';
require __DIR__ . '/../includes/timer.php';
require __DIR__ . '/includes/control.php';

// ---- the page checks for changes every 2 seconds
if (isset($_GET['poll'])) {
    session_write_close(); // don't block other admin requests while polling
    $data = cr_payload();
    json_out((($_GET['etag'] ?? '') === $data['etag'] ? ['same' => true] : $data) + timer_clock());
}

// ---- control buttons. Each sends do=verb or do=verb:arg (with JavaScript they are sent in the background)
if (is_post()) {
    check_csrf();
    [$verb, $arg] = explode(':', (string) ($_POST['do'] ?? ''), 2) + ['', ''];
    $error = $toast = null;

    if ($verb === 'new_key') {
        save_setting('screen_key', bin2hex(random_bytes(12)));
        log_activity('screen_key', 'Made a new screen link');
        $toast = 'New link made. Open it on your screens: the old link stopped working.';
    } else {
        // `at`: when the button was pressed, on the server clock (see timer_change())
        $toast = timer_change(function (&$s, $now) use ($verb, $arg, &$error) {
            $left = timer_left($s, $now);
            if ($verb === 'toggle') {
                $verb = $s['status'] === 'running' && $left > 0 ? 'pause' : 'start';
            }

            switch ($verb) {
                case 'start':
                    if ($s['status'] === 'running') {
                        return $left > 0 ? null : $error = 'Time is up. Reset or set a new time first.';
                    }
                    if ($s['left'] <= 0) return $error = 'Set a time first.';
                    $s['ends_at'] = $now + $s['left'];
                    $s['status'] = 'running';
                    log_activity('start', ($s['left'] < $s['duration'] ? 'Resumed with ' : 'Started with ') . timer_format($s['left']));
                    return 'Timer running.';

                case 'pause':
                    if ($s['status'] !== 'running') return null;
                    $s['left'] = $left;
                    $s['status'] = 'paused';
                    log_activity('pause', 'Paused at ' . timer_format($left));
                    return 'Timer paused at ' . timer_format($left) . '.';

                case 'reset':
                    $s['status'] = 'ready';
                    $s['left'] = $s['duration'];
                    log_activity('reset', 'Reset to ' . timer_format($s['duration']));
                    return 'Timer reset to ' . timer_format($s['duration']) . '.';

                case 'add': // seconds to add (or take off when negative)
                    $n = (int) $arg;
                    if (!$n || abs($n) > 36000) return $error = 'Unknown action.';
                    if ($s['status'] === 'running') {
                        $s['ends_at'] = min($now + TIMER_MAX, max($now, max($s['ends_at'], $now) + $n));
                    } else {
                        $s['left'] = min(TIMER_MAX, max(0, $s['left'] + $n));
                        if ($s['status'] === 'ready') $s['duration'] = (int) round($s['left']);
                    }
                    $words = ($n > 0 ? 'Added ' : 'Took off ') . timer_words(abs($n));
                    log_activity('adjust', $words);
                    return $words . '.';

                case 'set': // a duration from the hours / minutes / seconds fields; set:start also starts it
                    $total = max(0, (int) post('h')) * 3600 + max(0, (int) post('m')) * 60 + max(0, (int) post('s'));
                    if ($total < 1 || $total > TIMER_MAX) return $error = 'Enter a time between 1 second and 999 hours.';
                    $s['duration'] = $total;
                    $s['left'] = $total;
                    $s['status'] = 'ready';
                    if ($arg === 'start') {
                        $s['status'] = 'running';
                        $s['ends_at'] = $now + $total;
                    }
                    log_activity('set', 'Set to ' . timer_format($total) . ($arg === 'start' ? ' and started' : ''));
                    return 'Timer set to ' . timer_format($total) . ($arg === 'start' ? ' and running.' : '. Press Start when you are ready.');

                case 'until': // count down to a date and time
                    $ts = (float) ($_POST['until_ts'] ?? 0); // worked out in the browser, in the admin's own time zone
                    if ($ts <= 0) $ts = (float) (strtotime(post('until')) ?: 0);
                    $secs = $ts - $now;
                    if ($secs < 1) return $error = 'Pick a time in the future.';
                    if ($secs > TIMER_MAX) return $error = 'Pick a time within 999 hours from now.';
                    $s['duration'] = (int) ceil($secs);
                    $s['left'] = $secs;
                    $s['ends_at'] = $ts;
                    $s['status'] = 'running';
                    log_activity('until', 'Counting down to ' . date('j M, g:i a', (int) $ts));
                    return 'Countdown started: ' . timer_words($secs) . ' to go.';

                case 'view':
                    if (!in_array($arg, ['timer', 'standby'], true)) return $error = 'Unknown action.';
                    $s['view'] = $arg;
                    log_activity('view', $arg === 'timer' ? 'Screen shows the timer' : 'Screen on standby');
                    return $arg === 'timer' ? 'The screen shows the timer.' : 'The screen is on standby (blank).';

                case 'message': // message:2 shows a recent message again
                    if ($arg !== '') {
                        $text = $s['recent'][(int) $arg] ?? null;
                        if ($text === null) return $error = 'That message is gone.';
                    } else {
                        $text = mb_substr(trim(preg_replace('/\s+/u', ' ', post('message'))), 0, 120);
                    }
                    if ($text === '') return $error = 'Type a message first.';
                    $s['view'] = 'message';
                    $s['message'] = $text;
                    $s['recent'] = array_slice(array_values(array_unique(array_merge([$text], $s['recent']))), 0, 5);
                    log_activity('message', 'Showed a message: ' . $text);
                    return 'Your message is on screen.';

                case 'display':
                    $s['end_text'] = mb_substr(trim(preg_replace('/\s+/u', ' ', post('end_text'))), 0, 120);
                    $s['fg'] = timer_color(post('fg'), $s['fg']);
                    $s['bg'] = timer_color(post('bg'), $s['bg']);
                    if (in_array(post('layout'), TIMER_LAYOUTS, true)) $s['layout'] = post('layout');
                    if ((int) post('faces') >= 1) $s['faces'] = (int) post('faces');
                    log_activity('display', 'Changed the display settings');
                    return 'Display saved.';

                case 'reload':
                    $s['reload']++;
                    log_activity('reload', 'Reloaded the screens');
                    return 'Screens are reloading.';
            }
            return $error = 'Unknown action.';
        }, (float) ($_POST['at'] ?? 0));
    }

    if (is_ajax()) {
        json_out(['ok' => !$error, 'toast' => $error ?? $toast] + cr_payload() + timer_clock());
    }
    if ($error || $toast) flash($error ? 'error' : 'ok', $error ?? $toast);
    redirect('admin/index.php');
}

$data = cr_payload() + timer_clock(); // the clock before anything is sent: the page is the first measurement
$state = $data['state'];
$now = $data['now'];
$left = timer_left($state, $now);
$running = $state['status'] === 'running' && $left > 0;
$link = SITE_URL . '/screen.php?key=' . setting('screen_key');
$d = (int) $state['duration'];

$page = 'index';
$title = 'Control room';
$with_screen_css = true;
$extra_scripts = ['js/timer.js', 'js/control.js'];
$actions = '<a class="btn btn--ghost btn--sm" href="' . e($link) . '" target="_blank" rel="noopener">Open screen ↗</a>';
include __DIR__ . '/includes/header.php';
?>
<div class="cr" data-control data-status="<?= e($state['status']) ?>" data-poll="<?= e(url('admin/index.php?poll=1')) ?>">
    <script type="application/json" id="cr-data"><?= json_encode($data, JSON_HEX_TAG | JSON_HEX_AMP) ?></script>
    <form id="cr" method="post" data-cr-form><?= csrf_field() ?></form>

    <!-- What's on screen + the main controls -->
    <section class="panel stage" aria-label="Timer controls">
        <div class="stage__preview">
            <div class="preview" data-cr-preview>
                <div class="screen" data-cr-screen></div>
            </div>
        </div>

        <div class="stage__side">
            <div class="status">
                <span class="pill" data-cr-pill><?= e(ucfirst($state['status'])) ?></span>
                <span class="muted" data-cr-meta></span>
            </div>
            <output class="readout" data-cr-readout><?= e(timer_format($left)) ?></output>

            <div class="transport">
                <button class="btn btn--primary btn--lg transport__main" form="cr" name="do" value="toggle" data-key=" " data-cr-toggle>
                    <span class="transport__start"><?= cr_icon('play') ?><span data-cr-start-label>Start</span></span>
                    <span class="transport__pause"><?= cr_icon('pause') ?>Pause</span>
                    <kbd>Space</kbd>
                </button>
                <button class="btn btn--ghost btn--lg" form="cr" name="do" value="reset" data-key="r" data-cr-reset>
                    <?= cr_icon('reset') ?>Reset<kbd>R</kbd>
                </button>
            </div>

            <div class="field-row">
                <span class="label">Adjust</span>
                <div class="adjust" role="group" aria-label="Adjust the time">
                    <button class="btn btn--soft btn--sm" form="cr" name="do" value="add:-300">−5 min</button>
                    <button class="btn btn--soft btn--sm" form="cr" name="do" value="add:-60">−1 min</button>
                    <button class="btn btn--soft btn--sm" form="cr" name="do" value="add:60">+1 min</button>
                    <button class="btn btn--soft btn--sm" form="cr" name="do" value="add:300">+5 min</button>
                    <button class="btn btn--soft btn--sm" form="cr" name="do" value="add:600">+10 min</button>
                </div>
            </div>

            <div class="field-row">
                <span class="label">Screen shows</span>
                <div class="seg" role="group" aria-label="Screen shows">
                    <button form="cr" name="do" value="view:timer" data-cr-view="timer" aria-pressed="<?= $state['view'] === 'timer' ? 'true' : 'false' ?>">Timer</button>
                    <button type="button" data-cr-view="message" data-cr-goto-message aria-pressed="<?= $state['view'] === 'message' ? 'true' : 'false' ?>">Message</button>
                    <button form="cr" name="do" value="view:standby" data-cr-view="standby" aria-pressed="<?= $state['view'] === 'standby' ? 'true' : 'false' ?>">Standby</button>
                </div>
            </div>
            <p class="view-note" data-cr-view-note></p>

            <a class="online <?= $data['online'] ? 'is-online' : '' ?>" href="#screens" data-cr-online>
                <span class="dot" aria-hidden="true"></span>
                <span data-cr-online-text><?= $data['online'] ? $data['online'] . ' screen' . ($data['online'] === 1 ? '' : 's') . ' connected' : 'No screen connected' ?></span>
            </a>
            <p class="offline-note" role="status">Connection lost. Retrying…</p>
        </div>
    </section>

    <div class="grid-2">
        <section class="panel">
            <h2>Set the timer</h2>
            <form method="post" class="stack" data-cr-form data-cr-set>
                <?= csrf_field() ?>
                <div class="hms">
                    <label class="field"><span>Hours</span><input type="number" name="h" min="0" max="999" inputmode="numeric" value="<?= intdiv($d, 3600) ?>"></label>
                    <label class="field"><span>Minutes</span><input type="number" name="m" min="0" max="59" inputmode="numeric" value="<?= intdiv($d % 3600, 60) ?>"></label>
                    <label class="field"><span>Seconds</span><input type="number" name="s" min="0" max="59" inputmode="numeric" value="<?= $d % 60 ?>"></label>
                </div>
                <div class="chips" aria-label="Quick times">
                    <?php foreach ([300 => '5 min', 600 => '10 min', 900 => '15 min', 1800 => '30 min', 3600 => '1 hour', 36000 => '10 hours'] as $secs => $label): ?>
                        <button type="button" class="chip" data-cr-preset="<?= $secs ?>"><?= $label ?></button>
                    <?php endforeach; ?>
                </div>
                <div class="row-actions">
                    <button class="btn btn--primary" name="do" value="set:start">Set and start</button>
                    <button class="btn btn--ghost" name="do" value="set">Set</button>
                </div>
            </form>
        </section>

        <section class="panel">
            <h2>Count down to a time</h2>
            <form method="post" class="stack" data-cr-form data-cr-until>
                <?= csrf_field() ?>
                <input type="hidden" name="until_ts" value="">
                <label class="field"><span>Ends at</span>
                    <input type="datetime-local" name="until" required value="<?= e(date('Y-m-d\TH:i', (int) ceil((time() + 3600) / 900) * 900)) ?>">
                </label>
                <div class="row-actions">
                    <button class="btn btn--primary" name="do" value="until">Start countdown</button>
                </div>
            </form>
        </section>

        <section class="panel" id="message">
            <h2>Message on screen</h2>
            <form method="post" class="stack" data-cr-form>
                <?= csrf_field() ?>
                <label class="field"><span>Message <small class="muted" data-cr-count>0/120</small></span>
                    <textarea name="message" rows="2" maxlength="120" placeholder="e.g. Launch starts soon" data-cr-message required></textarea>
                </label>
                <div class="row-actions">
                    <button class="btn btn--primary" name="do" value="message">Show on screen</button>
                    <button class="btn btn--ghost" form="cr" name="do" value="view:timer">Back to timer</button>
                </div>
            </form>
            <div class="chips mt-sm" data-cr-region="recent" aria-label="Recent messages"><?= $data['html']['recent'] ?></div>
        </section>

        <section class="panel">
            <h2>Display</h2>
            <form method="post" class="stack" data-cr-form data-cr-display>
                <?= csrf_field() ?>
                <label class="field"><span>At zero, show</span>
                    <input name="end_text" maxlength="120" placeholder="00:00:00" value="<?= e($state['end_text']) ?>">
                </label>
                <div class="colors">
                    <label class="field field--color"><span>Digits</span><input type="color" name="fg" value="<?= e($state['fg']) ?>"></label>
                    <label class="field field--color"><span>Background</span><input type="color" name="bg" value="<?= e($state['bg']) ?>"></label>
                </div>
                <div class="field">
                    <span>Layout</span>
                    <div class="seg seg--radio">
                        <?php foreach (['auto' => 'Auto', 'line' => 'One line', 'stacked' => 'Stacked'] as $value => $label): ?>
                            <label><input type="radio" name="layout" value="<?= $value ?>" <?= $state['layout'] === $value ? 'checked' : '' ?>><span><?= $label ?></span></label>
                        <?php endforeach; ?>
                    </div>
                </div>
                <div class="field">
                    <span>Repeat side by side</span>
                    <div class="seg seg--radio">
                        <?php for ($i = 1; $i <= 4; $i++): ?>
                            <label><input type="radio" name="faces" value="<?= $i ?>" <?= $state['faces'] === $i ? 'checked' : '' ?>><span><?= $i ?>×</span></label>
                        <?php endfor; ?>
                    </div>
                </div>
                <div class="row-actions">
                    <button class="btn btn--primary" name="do" value="display">Save display</button>
                </div>
            </form>
        </section>
    </div>

    <section class="panel" id="screens">
        <div class="panel__head">
            <h2>Screens</h2>
            <button class="btn btn--ghost btn--sm" form="cr" name="do" value="reload"><?= cr_icon('reload') ?>Reload screens</button>
        </div>
        <div data-cr-region="screens"><?= $data['html']['screens'] ?></div>

        <h3 class="label mt">Screen link</h3>
        <div class="copy-row">
            <input class="mono" readonly value="<?= e($link) ?>" aria-label="Screen link" data-copy-source>
            <button class="btn btn--primary btn--sm" type="button" data-copy>Copy</button>
            <a class="btn btn--ghost btn--sm" href="<?= e($link) ?>" target="_blank" rel="noopener">Open ↗</a>
        </div>
        <p class="muted small mt-sm">Open it in Chrome on the computer that feeds the LED screen, then press F11 or double-click for full screen. Add <code>&amp;name=Pillar</code> to the end of the link to name a screen.</p>
        <form method="post" class="mt-sm" data-confirm="Make a new link? Screens on the old link go blank until you open the new one." data-confirm-ok="Make new link">
            <?= csrf_field() ?>
            <button class="btn btn--ghost btn--sm" name="do" value="new_key">Make a new link</button>
        </form>
    </section>
</div>
<?php include __DIR__ . '/includes/footer.php'; ?>
