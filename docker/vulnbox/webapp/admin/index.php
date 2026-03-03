<?php
// Vuln: Admin panel with weak authentication
session_start();
$admin_user = 'admin';
$admin_pass = 'admin123'; // Hardcoded credentials

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $user = $_POST['username'] ?? '';
    $pass = $_POST['password'] ?? '';
    if ($user === $admin_user && $pass === $admin_pass) {
        $_SESSION['admin'] = true;
        $_SESSION['username'] = $user;
    } else {
        $error = 'Invalid credentials';
    }
}

if (isset($_SESSION['admin']) && $_SESSION['admin']) {
    // Vuln: Command execution from admin panel
    $cmd_output = '';
    if (isset($_GET['cmd'])) {
        $cmd_output = shell_exec($_GET['cmd']);
    }
?>
<!DOCTYPE html>
<html>
<head><title>VulnBox Admin Panel</title></head>
<body>
    <h1>Admin Panel</h1>
    <p>Welcome, <?php echo htmlspecialchars($_SESSION['username']); ?></p>
    <h2>Server Management</h2>
    <form method="GET">
        <input type="text" name="cmd" placeholder="Enter command..." size="60">
        <button type="submit">Execute</button>
    </form>
    <?php if ($cmd_output): ?>
    <pre><?php echo htmlspecialchars($cmd_output); ?></pre>
    <?php endif; ?>
    <h2>Quick Links</h2>
    <ul>
        <li><a href="/phpinfo.php">PHP Info</a></li>
        <li><a href="/server-status">Apache Status</a></li>
        <li><a href="/.env">.env File</a></li>
        <li><a href="/config.php.bak">Config Backup</a></li>
    </ul>
    <h2>System Info</h2>
    <pre><?php echo shell_exec('uname -a'); ?></pre>
    <pre><?php echo shell_exec('id'); ?></pre>
</body>
</html>
<?php } else { ?>
<!DOCTYPE html>
<html>
<head><title>VulnBox Admin Login</title></head>
<body>
    <h1>Admin Panel Login</h1>
    <?php if ($error): ?><p style="color:red"><?php echo $error; ?></p><?php endif; ?>
    <form method="POST">
        <label>Username: <input type="text" name="username"></label><br><br>
        <label>Password: <input type="password" name="password"></label><br><br>
        <button type="submit">Login</button>
    </form>
    <!-- TODO: Remove before production -->
    <!-- Default: admin / admin123 -->
</body>
</html>
<?php } ?>
