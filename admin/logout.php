<?php
require __DIR__ . '/includes/auth.php';

if (is_post()) {
    check_csrf();
    log_activity('logout');
    unset($_SESSION['admin_id'], $_SESSION['admin_seen']);
    session_regenerate_id(true);
}
redirect('admin/login.php');
