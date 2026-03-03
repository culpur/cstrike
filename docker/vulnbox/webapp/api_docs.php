<html><head><title>API Documentation</title></head><body>
<h1>VulnBox Internal API</h1>
<p>REST API running on port 9090</p>
<h2>Endpoints</h2>
<table border="1">
<tr><th>Method</th><th>Path</th><th>Auth</th><th>Description</th></tr>
<tr><td>POST</td><td>/api/v1/login</td><td>No</td><td>Login with username/password</td></tr>
<tr><td>GET</td><td>/api/v1/users</td><td>No</td><td>List all users</td></tr>
<tr><td>GET</td><td>/api/v1/users/{id}</td><td>No</td><td>Get user details</td></tr>
<tr><td>GET</td><td>/api/v1/notes</td><td>API Key</td><td>List all notes</td></tr>
<tr><td>GET</td><td>/api/v1/search?q=</td><td>No</td><td>Search users</td></tr>
<tr><td>POST</td><td>/api/v1/exec</td><td>API Key</td><td>Execute system command</td></tr>
<tr><td>GET</td><td>/api/v1/config</td><td>No</td><td>View configuration</td></tr>
<tr><td>GET</td><td>/api/v1/debug</td><td>No</td><td>Debug information</td></tr>
</table>
<h2>Authentication</h2>
<p>Send <code>X-API-Key</code> header or <code>api_key</code> query parameter.</p>
<p>OpenAPI spec available at <a href="http://localhost:9090/openapi.json">/openapi.json</a></p>
</body></html>
