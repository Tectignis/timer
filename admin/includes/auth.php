<?php
// Included at the top of every admin page (except login).
require_once __DIR__ . '/../../includes/functions.php';

function current_admin()
{
    static $admin = false;
    if ($admin === false) {
        $admin = null;
        if (!empty($_SESSION['admin_id'])) {
            $row = q('SELECT id, name, email FROM admins WHERE id = ?', [$_SESSION['admin_id']])->fetch();
            // sign out after 12 hours without activity (long enough for a whole event day)
            $idle = time() - ($_SESSION['admin_seen'] ?? 0) > 43200;
            if ($row && !$idle) {
                $admin = $row;
                $_SESSION['admin_seen'] = time();
            } else {
                unset($_SESSION['admin_id']);
            }
        }
    }
    return $admin;
}

function log_activity($action, $details = null)
{
    q('INSERT INTO activity_log (admin_id, action, details, created_at) VALUES (?, ?, ?, ?)',
        [current_admin()['id'] ?? null, $action, $details ? mb_substr($details, 0, 255) : null, db_time()]);
}

if (!current_admin()) {
    if (is_ajax()) {
        json_out(['ok' => false, 'error' => 'You were signed out. Please sign in again.', 'signed_out' => true], 401);
    }
    $_SESSION['intended'] = $_SERVER['REQUEST_URI'];
    redirect('admin/login.php');
}
