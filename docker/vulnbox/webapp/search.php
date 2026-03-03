<?php
require_once 'config.php';
$q = isset($_GET['q']) ? $_GET['q'] : '';
$results = [];
if ($q) {
    $sql = "SELECT id, username, email, role FROM users WHERE username LIKE '%$q%' OR email LIKE '%$q%'";
    $result = $conn->query($sql);
    if ($result) { while ($row = $result->fetch_assoc()) { $results[] = $row; } }
}
?>
<html><head><title>User Search</title></head><body>
<h1>User Directory Search</h1>
<form method="GET">
  <input name="q" value="<?php echo $q; ?>" placeholder="Search users...">
  <button type="submit">Search</button>
</form>
<?php if ($q): ?>
  <p>Results for: <?php echo $q; ?></p>
  <table border="1"><tr><th>ID</th><th>Username</th><th>Email</th><th>Role</th></tr>
  <?php foreach ($results as $r): ?>
    <tr><td><?=$r['id']?></td><td><?=$r['username']?></td><td><?=$r['email']?></td><td><?=$r['role']?></td></tr>
  <?php endforeach; ?>
  </table>
<?php endif; ?>
</body></html>
