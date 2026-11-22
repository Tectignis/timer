<?php
require __DIR__ . '/../includes/functions.php';

if (!empty($_SESSION['admin_id'])) {
    redirect('admin/index.php');
}

$error = '';
$email = '';
$attempts = q('SELECT COUNT(*) FROM login_attempts WHERE ip_hash = ? AND created_at > ?', [ip_hash(), db_time('-15 minutes')])->fetchColumn();

if (is_post()) {
    check_csrf();
    $email = strtolower(post('email'));
    $password = $_POST['password'] ?? '';

    if ($attempts >= 5) {
        $error = 'Too many attempts. Please wait 15 minutes and try again.';
    } else {
        $admin = q('SELECT * FROM admins WHERE email = ?', [$email])->fetch();
        if ($admin && password_verify($password, $admin['password_hash'])) {
            session_regenerate_id(true);
            $_SESSION['admin_id'] = $admin['id'];
            $_SESSION['admin_seen'] = time();
            q('UPDATE admins SET last_login_at = ? WHERE id = ?', [db_time(), $admin['id']]);
            q('DELETE FROM login_attempts WHERE ip_hash = ?', [ip_hash()]);
            q('INSERT INTO activity_log (admin_id, action, created_at) VALUES (?, ?, ?)', [$admin['id'], 'login', db_time()]);

            $to = $_SESSION['intended'] ?? '';
            unset($_SESSION['intended']);
            if ($to && str_starts_with($to, BASE_URL . '/admin/')) {
                header('Location: ' . $to);
                exit;
            }
            redirect('admin/index.php');
        }
        q('INSERT INTO login_attempts (ip_hash, created_at) VALUES (?, ?)', [ip_hash(), db_time()]);
        $error = 'Wrong email or password.';
    }
}
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#141414">
<title>Sign in — Countdown</title>
<link rel="icon" href="<?= asset('img/favicon.svg') ?>" type="image/svg+xml">
<link rel="stylesheet" href="<?= asset('css/admin.css') ?>">
</head>
<body class="auth-page">
<main class="auth-card">
    <img class="auth-logo" src="<?= asset('img/favicon.svg') ?>" alt="" width="48" height="48">
    <h1>Countdown admin</h1>
    <?php if ($error): ?><p class="alert alert--error" role="alert"><?= e($error) ?></p><?php endif; ?>
    <form method="post" class="stack">
        <?= csrf_field() ?>
        <label class="field"><span>Email</span>
            <input type="email" name="email" autocomplete="username" required autofocus value="<?= e($email) ?>">
        </label>
        <label class="field"><span>Password</span>
            <input type="password" name="password" autocomplete="current-password" required>
        </label>
        <button class="btn btn--primary btn--block" type="submit">Sign in</button>
    </form>
</main>
</body>
</html>
