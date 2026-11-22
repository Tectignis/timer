<?php
// Admin page top. Set $page (for the active menu item) and $title before including; $actions for buttons beside the title.
$admin = current_admin();
$nav = [
    'index'    => ['Control room', 'index.php'],
    'activity' => ['Activity', 'activity.php'],
    'profile'  => ['Account', 'profile.php'],
];
$ok = flash('ok');
$err = flash('error');
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#141414">
<title><?= e($title ?? 'Admin') ?> — Countdown</title>
<link rel="icon" href="<?= asset('img/favicon.svg') ?>" type="image/svg+xml">
<?php if (!empty($with_screen_css)): ?><link rel="stylesheet" href="<?= asset('css/screen.css') ?>"><?php endif; ?>
<link rel="stylesheet" href="<?= asset('css/admin.css') ?>">
</head>
<body>
<header class="appbar">
    <a class="appbar__brand" href="<?= url('admin/index.php') ?>">
        <img src="<?= asset('img/favicon.svg') ?>" alt="" width="28" height="28">
        <span>Countdown</span>
    </a>
    <nav class="appbar__nav" aria-label="Main">
        <?php foreach ($nav as $key => [$label, $href]): ?>
            <a href="<?= url('admin/' . $href) ?>" <?= ($page ?? '') === $key ? 'class="is-active" aria-current="page"' : '' ?>><?= e($label) ?></a>
        <?php endforeach; ?>
    </nav>
    <form class="appbar__out" method="post" action="<?= url('admin/logout.php') ?>">
        <?= csrf_field() ?>
        <button class="btn btn--ghost btn--sm" type="submit">Sign out</button>
    </form>
</header>

<main class="content">
    <div class="page-head">
        <h1><?= e($title ?? 'Admin') ?></h1>
        <?php if (!empty($actions)) echo $actions; ?>
    </div>
    <?php if ($ok): ?><p class="alert alert--ok" role="status"><?= e($ok) ?></p><?php endif; ?>
    <?php if ($err): ?><p class="alert alert--error" role="alert"><?= e($err) ?></p><?php endif; ?>
