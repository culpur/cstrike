# cstrike/mcp_server/__main__.py
# Allows: python -m mcp_server

import sys
from mcp_server.server import run_server

transport = "stdio"
if "--sse" in sys.argv:
    transport = "sse"

run_server(transport=transport)
