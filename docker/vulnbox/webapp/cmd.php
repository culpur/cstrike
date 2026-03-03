<?php
$output = '';
if (isset($_GET['host'])) {
    $host = $_GET['host'];
    $output = shell_exec("ping -c 3 " . $host);
}
?>
<html><head><title>Network Diagnostic</title></head><body>
<h1>Network Diagnostic Tool</h1>
<form method="GET">
  <input name="host" placeholder="Hostname or IP" value="<?php echo htmlspecialchars($_GET['host'] ?? ''); ?>">
  <button type="submit">Ping</button>
</form>
<pre><?php echo htmlspecialchars($output ?? ''); ?></pre>
</body></html>
