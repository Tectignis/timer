<?php
require __DIR__ . '/includes/auth.php';

$me = current_admin();
$error = '';

if (is_post()) {
    check_csrf();
    $name = post('name');
    $email = strtolower(post('email'));
    $new = $_POST['new_password'] ?? '';
    $hash = q('SELECT password_hash FROM admins WHERE id = ?', [$me['id']])->fetchColumn();

    if (!password_verify($_POST['current_password'] ?? '', $hash)) {
        $error = 'Your current password is wrong.';
    } elseif ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $error = 'Enter your name and a valid email.';
    } elseif ($new !== '' && !password_ok($new)) {
        $error = 'The new password needs at least 8 characters.';
    } elseif (q('SELECT COUNT(*) FROM admins WHERE email = ? AND id <> ?', [$email, $me['id']])->fetchColumn()) {
        $error = 'Another admin already uses that email.';
    } else {
        q('UPDATE admins SET name = ?, email = ? WHERE id = ?', [$name, $email, $me['id']]);
        if ($new !== '') {
            q('UPDATE admins SET password_hash = ? WHERE id = ?', [password_hash($new, PASSWORD_DEFAULT), $me['id']]);
            session_regenerate_id(true);
        }
        log_activity('profile', $new !== '' ? 'Changed details and password' : 'Changed details');
        flash('ok', 'Your account is saved.');
        redirect('admin/profile.php');
    }
    $me = ['name' => $name, 'email' => $email] + $me;
}

$page = 'profile';
$title = 'Account';
include __DIR__ . '/includes/header.php';
?>
<?php if ($error): ?><p class="alert alert--error" role="alert"><?= e($error) ?></p><?php endif; ?>
<section class="panel account">
    <form method="post" class="stack">
        <?= csrf_field() ?>
        <label class="field"><span>Name</span><input name="name" required autocomplete="name" value="<?= e($me['name']) ?>"></label>
        <label class="field"><span>Email</span><input type="email" name="email" required autocomplete="username" value="<?= e($me['email']) ?>"></label>
        <label class="field"><span>New password (leave empty to keep it)</span><input type="password" name="new_password" minlength="8" autocomplete="new-password"></label>
        <label class="field"><span>Current password</span><input type="password" name="current_password" required autocomplete="current-password"></label>
        <div class="row-actions"><button class="btn btn--primary">Save</button></div>
    </form>
</section>
<?php include __DIR__ . '/includes/footer.php'; ?>
