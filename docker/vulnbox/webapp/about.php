<?php
// Vuln: Information disclosure — server details, software versions
?>
<!DOCTYPE html>
<html>
<head><title>About VulnBox</title></head>
<body>
    <h1>About VulnBox</h1>
    <h2>Application Details</h2>
    <table border="1" cellpadding="8">
        <tr><td>Application</td><td>VulnBox Web Application</td></tr>
        <tr><td>Version</td><td>2.0.0-dev</td></tr>
        <tr><td>Framework</td><td>PHP <?php echo phpversion(); ?></td></tr>
        <tr><td>Web Server</td><td><?php echo $_SERVER['SERVER_SOFTWARE'] ?? 'Unknown'; ?></td></tr>
        <tr><td>Server OS</td><td><?php echo php_uname(); ?></td></tr>
        <tr><td>Document Root</td><td><?php echo $_SERVER['DOCUMENT_ROOT'] ?? ''; ?></td></tr>
        <tr><td>Server IP</td><td><?php echo $_SERVER['SERVER_ADDR'] ?? ''; ?></td></tr>
        <tr><td>Database</td><td>MariaDB (localhost:3306)</td></tr>
        <tr><td>Cache</td><td>Redis (localhost:6379)</td></tr>
        <tr><td>API Server</td><td>Flask (localhost:9090)</td></tr>
        <tr><td>DNS</td><td>BIND9 (localhost:53)</td></tr>
        <tr><td>LDAP</td><td>OpenLDAP (localhost:389)</td></tr>
        <tr><td>SMTP</td><td>Postfix (localhost:25)</td></tr>
    </table>
    <h2>Build Info</h2>
    <p>Built: <?php echo date('Y-m-d'); ?></p>
    <p>Debug Mode: <strong>ENABLED</strong></p>
    <p>PHP Extensions: <?php echo implode(', ', get_loaded_extensions()); ?></p>
    <p><a href="/">&larr; Home</a></p>
</body>
</html>
