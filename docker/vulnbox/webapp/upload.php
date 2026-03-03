<?php
$message = '';
$upload_dir = '/var/www/vulnbox/uploads/';
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_FILES['file'])) {
    $filename = $_FILES['file']['name'];
    $target = $upload_dir . basename($filename);
    if (move_uploaded_file($_FILES['file']['tmp_name'], $target)) {
        $message = "File uploaded: <a href='/uploads/$filename'>$filename</a>";
    } else {
        $message = "Upload failed";
    }
}
$files = array_diff(scandir($upload_dir), ['.', '..', '.gitkeep']);
?>
<html><head><title>File Manager</title></head><body>
<h1>File Upload</h1>
<form method="POST" enctype="multipart/form-data">
  <input type="file" name="file">
  <button type="submit">Upload</button>
</form>
<p><?php echo $message; ?></p>
<h2>Uploaded Files</h2>
<ul>
<?php foreach ($files as $f): ?>
  <li><a href="/uploads/<?php echo htmlspecialchars($f); ?>"><?php echo htmlspecialchars($f); ?></a></li>
<?php endforeach; ?>
</ul>
</body></html>
