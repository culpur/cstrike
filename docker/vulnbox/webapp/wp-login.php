<?php
// Fake WordPress login — honeypot for credential brute-force tools
// Vuln: Accepts any credentials and logs them, responds like real WP
$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $user = $_POST['log'] ?? '';
    $pass = $_POST['pwd'] ?? '';
    // Log attempt (vuln: credential harvesting)
    file_put_contents('/tmp/wp-login-attempts.log',
        date('Y-m-d H:i:s') . " | $user:$pass\n", FILE_APPEND);
    $error = '<strong>Error:</strong> The username or password you entered is incorrect.';
}
?>
<!DOCTYPE html>
<html>
<head>
    <title>Log In &lsaquo; VulnBox &mdash; WordPress</title>
    <style>
        body { background: #f1f1f1; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        .login { width: 320px; margin: 100px auto; }
        .login h1 { text-align: center; }
        .login form { background: #fff; padding: 26px 24px; border: 1px solid #c3c4c7; border-radius: 4px; }
        .login input[type=text], .login input[type=password] { width: 100%; padding: 8px; margin: 4px 0 16px; box-sizing: border-box; }
        .login input[type=submit] { background: #2271b1; color: #fff; border: none; padding: 8px 16px; cursor: pointer; border-radius: 3px; }
        .login-error { background: #d63638; color: #fff; padding: 12px; margin-bottom: 16px; border-radius: 4px; }
    </style>
</head>
<body>
<div class="login">
    <h1>WordPress</h1>
    <?php if ($error): ?><div class="login-error"><?php echo $error; ?></div><?php endif; ?>
    <form method="POST" action="">
        <label>Username or Email Address<br>
            <input type="text" name="log" value="">
        </label>
        <label>Password<br>
            <input type="password" name="pwd" value="">
        </label>
        <p><label><input type="checkbox" name="rememberme" value="forever"> Remember Me</label></p>
        <input type="submit" value="Log In">
        <input type="hidden" name="redirect_to" value="/wp-admin/">
    </form>
    <p><a href="/wp-login.php?action=lostpassword">Lost your password?</a></p>
</div>
<!-- Generator: WordPress 6.4.2 -->
</body>
</html>
