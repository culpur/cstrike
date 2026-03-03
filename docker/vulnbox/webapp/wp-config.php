<?php
// Fake WordPress config — leaked credentials
// Vuln: Sensitive config file exposed in webroot

define('DB_NAME', 'wordpress');
define('DB_USER', 'wp_admin');
define('DB_PASSWORD', 'WpAdm1n_2024!');
define('DB_HOST', 'localhost');
define('DB_CHARSET', 'utf8');
define('DB_COLLATE', '');

define('AUTH_KEY',         'fake-auth-key-do-not-use-in-production');
define('SECURE_AUTH_KEY',  'fake-secure-auth-key');
define('LOGGED_IN_KEY',    'fake-logged-in-key');
define('NONCE_KEY',        'fake-nonce-key');
define('AUTH_SALT',        'fake-auth-salt');
define('SECURE_AUTH_SALT', 'fake-secure-auth-salt');
define('LOGGED_IN_SALT',   'fake-logged-in-salt');
define('NONCE_SALT',       'fake-nonce-salt');

$table_prefix = 'wp_';

define('WP_DEBUG', true);
define('WP_DEBUG_LOG', true);
define('WP_DEBUG_DISPLAY', true);

if (!defined('ABSPATH'))
    define('ABSPATH', dirname(__FILE__) . '/');
