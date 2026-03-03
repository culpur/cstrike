<?php
$page = isset($_GET['page']) ? $_GET['page'] : 'welcome';
?>
<html><head><title>Documentation</title></head><body>
<h1>Documentation Portal</h1>
<nav>
  <a href="?page=welcome">Welcome</a> |
  <a href="?page=about">About</a> |
  <a href="?page=contact">Contact</a>
</nav>
<hr>
<?php
@include($page . ".php");
?>
</body></html>
