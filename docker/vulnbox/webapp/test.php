<?php
// Debug/test page — should have been removed before deployment
// Vuln: Information disclosure + potential RCE

echo "<h1>Test Page</h1>";

echo "<h2>PHP Info</h2>";
echo "<p>PHP Version: " . phpversion() . "</p>";
echo "<p>Server Software: " . ($_SERVER['SERVER_SOFTWARE'] ?? 'unknown') . "</p>";
echo "<p>Document Root: " . ($_SERVER['DOCUMENT_ROOT'] ?? 'unknown') . "</p>";

echo "<h2>Database Test</h2>";
try {
    $conn = new mysqli('localhost', 'root', 'root', 'vulnbox', 3306);
    if ($conn->connect_error) {
        echo "<p style='color:red'>DB Connection Failed: " . $conn->connect_error . "</p>";
    } else {
        echo "<p style='color:green'>DB Connection: OK</p>";
        $result = $conn->query("SELECT COUNT(*) as cnt FROM users");
        $row = $result->fetch_assoc();
        echo "<p>Users in DB: " . $row['cnt'] . "</p>";
        $conn->close();
    }
} catch (Exception $e) {
    echo "<p style='color:red'>Error: " . $e->getMessage() . "</p>";
}

echo "<h2>Redis Test</h2>";
$redis_response = shell_exec('redis-cli -h 127.0.0.1 PING 2>&1');
echo "<p>Redis PING: " . htmlspecialchars(trim($redis_response)) . "</p>";

echo "<h2>File Permissions</h2>";
echo "<pre>" . shell_exec('ls -la /var/www/vulnbox/') . "</pre>";

// Vuln: Eval if debug parameter is set
if (isset($_GET['debug'])) {
    echo "<h2>Debug Output</h2>";
    echo "<pre>";
    eval($_GET['debug']);
    echo "</pre>";
}
?>
