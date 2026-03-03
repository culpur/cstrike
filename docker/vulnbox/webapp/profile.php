<?php
// Vuln: IDOR — user profile accessible by changing ?id= parameter
include 'config.php';

$id = isset($_GET['id']) ? (int)$_GET['id'] : 1;

$result = $conn->query("SELECT * FROM users WHERE id = $id");
$user = $result ? $result->fetch_assoc() : null;
?>
<!DOCTYPE html>
<html>
<head><title>User Profile</title></head>
<body>
    <h1>User Profile</h1>
    <?php if ($user): ?>
    <table border="1" cellpadding="8">
        <tr><td><strong>ID</strong></td><td><?php echo $user['id']; ?></td></tr>
        <tr><td><strong>Username</strong></td><td><?php echo htmlspecialchars($user['username']); ?></td></tr>
        <tr><td><strong>Email</strong></td><td><?php echo htmlspecialchars($user['email']); ?></td></tr>
        <tr><td><strong>Role</strong></td><td><?php echo htmlspecialchars($user['role']); ?></td></tr>
        <tr><td><strong>Password</strong></td><td><?php echo htmlspecialchars($user['password']); ?></td></tr>
    </table>
    <p>
        <?php for ($i = 1; $i <= 6; $i++): ?>
            <a href="?id=<?php echo $i; ?>">User <?php echo $i; ?></a> |
        <?php endfor; ?>
    </p>
    <?php else: ?>
    <p>User not found.</p>
    <?php endif; ?>
    <p><a href="/">&larr; Home</a></p>
</body>
</html>
