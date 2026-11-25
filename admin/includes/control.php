<?php
// Control room pieces that are drawn on the page and redrawn by assets/js/control.js.

function cr_icon($name)
{
    $paths = [
        'play'   => 'M8 5v14l11-7z',
        'pause'  => 'M6 5h4v14H6zm8 0h4v14h-4z',
        'reset'  => 'M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8',
        'reload' => 'M17.6 6.4A8 8 0 1 0 19.7 14h-2.1A6 6 0 1 1 12 6c1.7 0 3.1.7 4.2 1.8L13 11h7V4z',
    ];
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' . $paths[$name] . '"/></svg>';
}

function cr_screens_html($list)
{
    if (!$list) {
        return '<p class="empty">No screen has opened the link yet.</p>';
    }
    $html = '<ul class="screens">';
    foreach ($list as $s) {
        $html .= '<li class="' . ($s['online'] ? 'is-online' : '') . '">'
            . '<span class="dot" aria-hidden="true"></span>'
            . '<span class="screens__name">' . e($s['name'] ?: 'Unnamed screen') . '</span>'
            . '<span class="muted">' . e($s['size'] ? str_replace('x', ' × ', $s['size']) : '') . '</span>'
            . '<span class="screens__seen">' . ($s['online'] ? 'Online' : 'Last seen ' . e(date('g:i a', strtotime($s['last_seen'])))) . '</span>'
            . '</li>';
    }
    return $html . '</ul>';
}

function cr_recent_html($state)
{
    $html = '';
    foreach ($state['recent'] as $i => $text) {
        $html .= '<button class="chip" form="cr" name="do" value="message:' . $i . '" title="Show this message again">'
            . e(mb_strlen($text) > 40 ? mb_substr($text, 0, 39) . '…' : $text) . '</button>';
    }
    return $html;
}

// One reveal video for its card in After the timer ($slot: a key of REVEAL_VIDEOS): its address, the name it was added
// with, its size, when it was saved, and its shape and length as read when it was added (0 when unknown, e.g. a file
// copied in by hand; the control room reads them from the video itself too). null when there is none.
function cr_video($state, $slot)
{
    $url = reveal_url($slot);
    if ($url === '') return null;
    $file = reveal_file($slot);
    $size = filesize($file);
    $meta = $state['videos'][$slot] ?? [];
    if (($meta['size'] ?? -1) !== $size) $meta = []; // the file was changed by hand: what was stored is about another
    return [
        'url'     => $url,
        'name'    => $meta['name'] ?? REVEAL_VIDEOS[$slot]['file'],
        'size'    => $size,
        'at'      => $meta['at'] ?? (float) filemtime($file),
        'width'   => $meta['width'] ?? 0,
        'height'  => $meta['height'] ?? 0,
        'seconds' => $meta['seconds'] ?? 0,
    ];
}

// Every reveal video, keyed like REVEAL_VIDEOS
function cr_videos($state)
{
    $videos = [];
    foreach (array_keys(REVEAL_VIDEOS) as $slot) $videos[$slot] = cr_video($state, $slot);
    return $videos;
}

// A video's details as the After the timer card shows them (assets/js/control.js writes the same)
function cr_mb($bytes)
{
    return number_format($bytes / 1048576, 1) . ' MB';
}

function cr_seconds($seconds)
{
    if ($seconds <= 0) return '';
    if ($seconds < 60) return number_format($seconds, 1) . ' s';
    return intdiv((int) $seconds, 60) . ' min ' . ((int) $seconds % 60) . ' s';
}

// Everything the control room shows. The etag lets the page skip redraws when nothing changed.
function cr_payload()
{
    $state = timer_state();
    $list = screens();
    $online = array_values(array_filter($list, fn ($s) => $s['online']));
    $data = [
        'state'  => $state,
        'videos' => cr_videos($state),
        'online' => count($online),
        'size'   => $online[0]['size'] ?? ($list[0]['size'] ?? ''), // aspect ratio for the preview
        'html'   => ['screens' => cr_screens_html($list), 'recent' => cr_recent_html($state)],
    ];
    return ['etag' => md5(json_encode($data))] + $data;
}
