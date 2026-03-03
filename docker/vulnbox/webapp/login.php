<?php
require_once 'config.php';
$message = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $user = $_POST['username'];
    $pass = $_POST['password'];
    $query = "SELECT * FROM users WHERE username='$user' AND password='$pass'";
    $result = $conn->query($query);
    if ($result && $result->num_rows > 0) {
        $row = $result->fetch_assoc();
        $message = "Welcome, " . $row['username'] . "! Role: " . $row['role'];
        setcookie("session_user", $row['username'], time()+3600);
        setcookie("session_role", $row['role'], time()+3600);
    } else {
        $message = "Invalid credentials for user: $user";
    }
}
?>
<html><head><title>VulnBox Login</title></head><body>
<h1>VulnBox Login</h1>
<form method="POST">
  <input name="username" placeholder="Username"><br>
  <input name="password" type="password" placeholder="Password"><br>
  <button type="submit">Login</button>
</form>
<p><?php echo $message; ?></p>
</body></html>
