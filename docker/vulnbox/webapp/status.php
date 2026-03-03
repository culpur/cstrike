<?php
// Vuln: Server status / info disclosure
header('Content-Type: text/html');
?>
<!DOCTYPE html>
<html>
<head><title>Server Status</title></head>
<body>
    <h1>Server Status</h1>
    <h2>System Information</h2>
    <pre><?php echo shell_exec('uname -a'); ?></pre>
    <h2>Network Interfaces</h2>
    <pre><?php echo shell_exec('ip addr 2>/dev/null || ifconfig 2>/dev/null'); ?></pre>
    <h2>Disk Usage</h2>
    <pre><?php echo shell_exec('df -h'); ?></pre>
    <h2>Running Processes</h2>
    <pre><?php echo shell_exec('ps aux'); ?></pre>
    <h2>Open Ports</h2>
    <pre><?php echo shell_exec('ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null'); ?></pre>
    <h2>Environment Variables</h2>
    <pre><?php echo shell_exec('env | sort'); ?></pre>
    <h2>Current User</h2>
    <pre><?php echo shell_exec('id && whoami'); ?></pre>
    <p><a href="/">&larr; Home</a></p>
</body>
</html>
