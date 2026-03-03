<?php
// Vuln: Stored XSS — guestbook entries are not sanitized
session_start();
if (!isset($_SESSION['guestbook'])) {
    $_SESSION['guestbook'] = [
        ['name' => 'Admin', 'message' => 'Welcome to the guestbook!', 'time' => '2024-01-10 10:00'],
        ['name' => 'John', 'message' => 'Great website, check out our internal wiki at http://wiki.vulnbox.local', 'time' => '2024-01-11 14:30'],
    ];
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $name = $_POST['name'] ?? 'Anonymous';
    $message = $_POST['message'] ?? '';
    if ($message) {
        // Vuln: No sanitization — stored XSS
        $_SESSION['guestbook'][] = [
            'name' => $name,
            'message' => $message,
            'time' => date('Y-m-d H:i'),
        ];
    }
}
?>
<!DOCTYPE html>
<html>
<head><title>VulnBox Guestbook</title></head>
<body>
    <h1>Guestbook</h1>
    <h2>Leave a Message</h2>
    <form method="POST">
        <label>Name: <input type="text" name="name" size="30"></label><br><br>
        <label>Message:<br><textarea name="message" rows="4" cols="50"></textarea></label><br><br>
        <button type="submit">Post</button>
    </form>
    <h2>Messages</h2>
    <?php foreach (array_reverse($_SESSION['guestbook']) as $entry): ?>
    <div style="border:1px solid #ccc; padding:10px; margin:5px 0;">
        <strong><?php echo $entry['name']; ?></strong>
        <small>(<?php echo $entry['time']; ?>)</small><br>
        <?php echo $entry['message']; ?>
    </div>
    <?php endforeach; ?>
    <p><a href="/">&larr; Home</a></p>
</body>
</html>
