<?php
require __DIR__ . '/includes/auth.php';

const ACTIONS = [
    'login'      => 'Signed in',
    'logout'     => 'Signed out',
    'start'      => 'Started',
    'pause'      => 'Paused',
    'reset'      => 'Reset',
    'adjust'     => 'Adjusted',
    'set'        => 'Set the timer',
    'until'      => 'Counting to a time',
    'view'       => 'Screen view',
    'message'    => 'Message',
    'display'    => 'Display',
    'end'        => 'After the timer',
    'video'      => 'Reveal video',
    'reload'     => 'Reloaded screens',
    'screen_key' => 'New screen link',
    'profile'    => 'Account',
];

$rows = q('SELECT l.*, a.name AS admin_name FROM activity_log l LEFT JOIN admins a ON a.id = l.admin_id
           ORDER BY l.id DESC LIMIT 200')->fetchAll();

$page = 'activity';
$title = 'Activity';
include __DIR__ . '/includes/header.php';
?>
<section class="panel">
    <?php if (!$rows): ?>
        <p class="empty">Nothing has happened yet.</p>
    <?php else: ?>
        <div class="table-wrap">
            <table class="table">
                <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
                <tbody>
                <?php foreach ($rows as $r): ?>
                    <tr>
                        <td class="nowrap" title="<?= e(date('j M Y, g:i:s a', strtotime($r['created_at']))) ?>"><?= e(date('j M, g:i a', strtotime($r['created_at']))) ?></td>
                        <td class="nowrap"><?= e($r['admin_name'] ?? '—') ?></td>
                        <td class="nowrap"><?= e(ACTIONS[$r['action']] ?? $r['action']) ?></td>
                        <td><?= e($r['details'] ?? '') ?></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    <?php endif; ?>
</section>
<?php include __DIR__ . '/includes/footer.php'; ?>
