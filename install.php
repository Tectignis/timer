<?php
// One-time installer: creates the SQLite database file, the tables and the first admin.
// It locks itself once an admin exists. You can delete this file after installing.
//
// Browser: open /install.php
// Command line: php install.php "Your Name" you@example.com YourPassword

require __DIR__ . '/includes/functions.php';

function install_tables()
{
    db()->exec('PRAGMA journal_mode = WAL'); // lets screens read while an admin is writing
    db()->exec(file_get_contents(__DIR__ . '/database/schema.sql'));
    if (setting('screen_key') === '') {
        save_setting('screen_key', bin2hex(random_bytes(12)));
    }
}

function create_admin($name, $email, $password)
{
    if (q('SELECT COUNT(*) FROM admins')->fetchColumn() > 0) {
        return 'Already installed: an admin account exists.';
    }
    if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || !password_ok($password)) {
        return 'Enter a name, a valid email and a password of at least 8 characters.';
    }
    q('INSERT INTO admins (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
        [$name, strtolower($email), password_hash($password, PASSWORD_DEFAULT), db_time()]);
    return '';
}

// ---- command line
if (PHP_SAPI === 'cli') {
    install_tables();
    echo "Tables ready.\n";
    if ($argc >= 4) {
        $error = create_admin($argv[1], $argv[2], $argv[3]);
        echo $error ?: "Admin created: {$argv[2]}\n";
    }
    exit;
}

// ---- browser
$error = '';
$done = false;
try {
    install_tables();
    $locked = q('SELECT COUNT(*) FROM admins')->fetchColumn() > 0;
} catch (PDOException $e) {
    $error = 'Could not create the database. Check DB_FILE in includes/config.php and that its folder is writable. (' . $e->getMessage() . ')';
    $locked = false;
}

if (!$error && !$locked && is_post()) {
    check_csrf();
    $error = create_admin(post('name'), post('email'), $_POST['password'] ?? '');
    $done = $error === '';
}
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Install — Countdown</title>
<link rel="icon" href="<?= asset('img/favicon.svg') ?>" type="image/svg+xml">
<link rel="stylesheet" href="<?= asset('css/admin.css') ?>">
</head>
<body class="auth-page">
<main class="auth-card">
    <h1>Install</h1>
    <?php if ($error): ?>
        <p class="alert alert--error"><?= e($error) ?></p>
    <?php endif; ?>

    <?php if ($done): ?>
        <p class="alert alert--ok">All set. Your admin account is ready.</p>
        <a class="btn btn--primary btn--block" href="<?= url('admin/login.php') ?>">Go to admin login</a>
    <?php elseif ($locked): ?>
        <p class="alert alert--ok">Already installed. For safety you can delete <code>install.php</code>.</p>
        <a class="btn btn--primary btn--block" href="<?= url('admin/login.php') ?>">Go to admin login</a>
    <?php elseif (!$error || is_post()): ?>
        <form method="post" class="stack">
            <?= csrf_field() ?>
            <label class="field"><span>Your name</span><input name="name" required value="<?= e(post('name')) ?>"></label>
            <label class="field"><span>Email</span><input type="email" name="email" required value="<?= e(post('email')) ?>"></label>
            <?= password_field('Password (8+ characters)', ['name' => 'password', 'minlength' => 8, 'autocomplete' => 'new-password', 'required' => true]) ?>
            <button class="btn btn--primary btn--block">Create admin</button>
        </form>
    <?php endif; ?>
</main>
<script src="<?= asset('js/admin.js') ?>" defer></script>
</body>
</html>
