<?php
// Copy this file to config.php and fill in your values.

// SQLite database file (created by install.php). The folder must be writable by PHP.
// On a live server you can move it outside the web root, e.g. __DIR__ . '/../../countdown-data/countdown.sqlite'
define('DB_FILE', __DIR__ . '/../database/countdown.sqlite');

// Folder the site lives in ('' when it is at the domain root, '/countdown' on local XAMPP)
define('BASE_URL', '/countdown');

// Full public address of the site (used for the screen link)
define('SITE_URL', 'http://localhost/countdown');

// Long random string, used to hash IP addresses
define('SECRET_KEY', 'change-me-to-a-long-random-string');

// Show PHP errors on screen (turn off on the live server)
define('DEBUG', true);

date_default_timezone_set('Asia/Kolkata');
