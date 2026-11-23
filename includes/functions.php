<?php
// Shared helpers for the screen and the admin panel.

require_once __DIR__ . '/config.php';

error_reporting(E_ALL);
ini_set('display_errors', DEBUG ? '1' : '0');

// ---------------------------------------------------------------- session

// Screens (screen.php) define NO_SESSION: they never sign in, and their requests are held open
if (!defined('NO_SESSION') && session_status() === PHP_SESSION_NONE) {
    session_name('countdown');
    session_set_cookie_params([
        'path'     => BASE_URL ?: '/',
        'secure'   => is_https(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    ini_set('session.use_strict_mode', '1');
    session_start();
}

// Basic security headers on every page
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: strict-origin-when-cross-origin');
header("Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");

function is_https()
{
    return !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
}

// ---------------------------------------------------------------- database

function db()
{
    static $pdo = null;
    if ($pdo === null) {
        $pdo = new PDO('sqlite:' . DB_FILE, null, null, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_TIMEOUT            => 10, // seconds to wait while another request is writing
        ]);
        // WAL (set by install.php) stays safe with fewer disk syncs, which keeps the frequent small writes quick
        $pdo->exec('PRAGMA synchronous = NORMAL');
    }
    return $pdo;
}

// Local date and time in the database format ('2026-11-22 14:30:00'). $modify: '-15 minutes', '+1 day'…
function db_time($modify = 'now')
{
    return date('Y-m-d H:i:s', strtotime($modify));
}

// Run a query with parameters and return the statement
function q($sql, $params = [])
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    return $stmt;
}

// ---------------------------------------------------------------- output & urls

function e($value)
{
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}

// A labelled password input with a button that shows or hides what's typed (see assets/js/admin.js).
// $attrs: name => value, or name => true for a bare attribute such as required.
function password_field($label, $attrs)
{
    static $n = 0;
    $id = 'password-' . ++$n;
    $html = '';
    foreach ($attrs as $name => $value) {
        $html .= ' ' . $name . ($value === true ? '' : '="' . e($value) . '"');
    }
    $eye = '<svg class="pw__show" viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    $eye_off = '<svg class="pw__hide" viewBox="0 0 24 24" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22"/></svg>';
    return '<div class="field"><label for="' . $id . '">' . e($label) . '</label><div class="pw">'
        . '<input type="password" id="' . $id . '"' . $html . '>'
        . '<button type="button" class="pw__toggle" aria-label="Show password" aria-controls="' . $id . '" data-pw-toggle>' . $eye . $eye_off . '</button>'
        . '</div></div>';
}

function url($path = '')
{
    return BASE_URL . '/' . ltrim($path, '/');
}

// Asset URL with a version number so browsers pick up changes
function asset($path)
{
    $file = __DIR__ . '/../assets/' . $path;
    return url('assets/' . $path) . '?v=' . (is_file($file) ? filemtime($file) : 1);
}

function redirect($path)
{
    header('Location: ' . (str_starts_with($path, 'http') ? $path : url($path)));
    exit;
}

function json_out($data, $status = 200)
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data);
    exit;
}

// True when the request was sent by our JavaScript (fetch)
function is_ajax()
{
    return ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') === 'fetch';
}

function is_post()
{
    return $_SERVER['REQUEST_METHOD'] === 'POST';
}

function post($key)
{
    return trim((string) ($_POST[$key] ?? ''));
}

// Message shown once on the next page
function flash($key, $value = null)
{
    if ($value !== null) {
        $_SESSION['flash'][$key] = $value;
        return null;
    }
    $value = $_SESSION['flash'][$key] ?? null;
    unset($_SESSION['flash'][$key]);
    return $value;
}

function time_ago($datetime)
{
    $s = time() - strtotime($datetime);
    if ($s < 60) return 'just now';
    if ($s < 3600) return floor($s / 60) . 'm ago';
    if ($s < 86400) return floor($s / 3600) . 'h ago';
    if ($s < 604800) return floor($s / 86400) . 'd ago';
    return date('j M Y', strtotime($datetime));
}

// ---------------------------------------------------------------- security

function csrf_token()
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

function csrf_field()
{
    return '<input type="hidden" name="csrf" value="' . csrf_token() . '">';
}

function check_csrf()
{
    $token = $_POST['csrf'] ?? ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
    if (!is_string($token) || !hash_equals(csrf_token(), $token)) {
        if (is_ajax()) {
            json_out(['ok' => false, 'error' => 'Your session expired. Please refresh the page.'], 403);
        }
        http_response_code(403);
        exit('Your session expired. Please go back, refresh the page and try again.');
    }
}

function ip_hash()
{
    return hash_hmac('sha256', $_SERVER['REMOTE_ADDR'] ?? '', SECRET_KEY);
}

// The only password rule: at least 8 characters
function password_ok($password)
{
    return is_string($password) && mb_strlen($password) >= 8;
}

// ---------------------------------------------------------------- settings

function default_settings()
{
    return [
        'screen_key'  => '',
        'timer_state' => '{}',
    ];
}

function setting($name)
{
    static $settings = null;
    if ($settings === null || $name === null) {
        $settings = default_settings();
        try {
            foreach (q('SELECT name, value FROM settings')->fetchAll() as $row) {
                $settings[$row['name']] = $row['value'];
            }
        } catch (PDOException $e) {
            // database not installed yet — use defaults
        }
    }
    return $name === null ? null : ($settings[$name] ?? '');
}

function save_setting($name, $value)
{
    q('INSERT INTO settings (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value', [$name, (string) $value]);
    setting(null); // reload
}
