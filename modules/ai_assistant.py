# cstrike/modules/ai_assistant.py

import json
import re
from pathlib import Path

# Live thoughts queue (used by TUI for streaming sidebar)
AI_THOUGHTS = []

# Observer pattern for TUI thought streaming
_thought_observers: list = []

# Load config
try:
    CONFIG = json.loads(Path(".env").read_text())
except (FileNotFoundError, json.JSONDecodeError) as e:
    print(f"[AI] Warning: Could not load .env config: {e}")
    CONFIG = {}

# Initialize AI provider (Ollama or OpenAI based on config)
_provider = None


def _get_provider():
    """Lazy-init the configured AI provider."""
    global _provider
    if _provider is None:
        try:
            from modules.ai_provider import create_provider
            _provider = create_provider(CONFIG)
        except Exception as e:
            print(f"[AI] Failed to create provider: {e}, falling back to OpenAI direct")
            from modules.ai_provider import OpenAIProvider
            _provider = OpenAIProvider(
                api_key=CONFIG.get("openai_api_key", ""),
                model=CONFIG.get("openai_model", "gpt-5.2"),
            )
    return _provider


def register_thought_observer(callback):
    """Register a callback to receive new thoughts in real time.

    Args:
        callback: Callable that receives a single thought string.
    """
    if callback not in _thought_observers:
        _thought_observers.append(callback)


def unregister_thought_observer(callback):
    """Remove a previously registered thought observer."""
    try:
        _thought_observers.remove(callback)
    except ValueError:
        pass


def stream_thought(thought):
    """Send a new thought to the global stream queue and notify observers."""
    if len(AI_THOUGHTS) >= 20:
        AI_THOUGHTS.pop(0)
    formatted = f"🧠 {thought}"
    AI_THOUGHTS.append(formatted)
    for observer in _thought_observers:
        try:
            observer(formatted)
        except Exception:
            pass


SYSTEM_PROMPT = (
    "You are a highly skilled penetration testing AI assistant. "
    "Based on the following recon and loot data, suggest additional commands "
    "to enumerate, exploit, or pivot further. Return only shell commands if possible. "
    "Available tools include vulnapi for API security scanning: "
    "'vulnapi scan curl <URL>' to scan an API endpoint without a spec, "
    "'vulnapi scan openapi <SPEC_URL>' to scan using an OpenAPI/Swagger spec, "
    "'vulnapi discover api <URL>' to discover API endpoints. "
    "When you detect API frameworks, REST endpoints, or JSON responses in the recon data, "
    "suggest vulnapi commands to test for OWASP API Top 10 vulnerabilities."
)


def ask_ai(recon_data, socketio=None, target=None):
    """
    Ask AI for next steps based on recon data.

    Uses the configured AI provider (Ollama or OpenAI).

    Args:
        recon_data: Dictionary of reconnaissance results
        socketio: Optional SocketIO instance for emitting progress
        target: Optional target name for tracking

    Returns:
        AI suggestion string or None on error
    """
    print("[AI ➤ Asking for next step...]")
    provider = _get_provider()
    model_name = provider.get_model_name()
    stream_thought(f"Analyzing recon data via {model_name}...")

    if socketio:
        socketio.emit('ai_thought', {
            'target': target,
            'thoughtType': 'observation',
            'content': f'Preparing AI analysis prompt ({model_name})...',
            'timestamp': None
        })

    try:
        recon_json = json.dumps(recon_data, indent=2)
        data_preview = recon_json[:7000]

        messages = [
            {"role": "user", "content": f"Recon and loot data:\n{data_preview}"}
        ]

        if socketio:
            socketio.emit('ai_thought', {
                'target': target,
                'thoughtType': 'ai_prompt',
                'content': f'Sending prompt to {model_name}...',
                'metadata': {
                    'system_prompt': SYSTEM_PROMPT,
                    'data_preview': data_preview[:500] + '...' if len(data_preview) > 500 else data_preview,
                    'model': model_name,
                },
                'timestamp': None
            })

        response = provider.chat(messages, system_prompt=SYSTEM_PROMPT)
        suggestion = response["content"].strip()
        stream_thought("Commands prepared based on recon.")

        if socketio:
            socketio.emit('ai_thought', {
                'target': target,
                'thoughtType': 'ai_response',
                'content': f'Received AI response ({len(suggestion)} chars)',
                'metadata': {
                    'response': suggestion,
                    'usage': response.get("usage"),
                },
                'timestamp': None
            })

        return suggestion

    except Exception as e:
        error_msg = f"AI request failed: {e}"
        print(f"[AI ➤ ERROR] {error_msg}")
        stream_thought(f"❌ {error_msg}")

        if socketio:
            socketio.emit('ai_thought', {
                'target': target,
                'thoughtType': 'observation',
                'content': f'❌ AI error: {str(e)}',
                'timestamp': None
            })

        return None


def ask_ai_with_tools(recon_data, tool_executor, socketio=None, target=None, max_iterations=10):
    """
    Ask AI with MCP tool calling — agentic loop.

    The AI analyzes recon data and can call MCP tools directly to gather
    more info, run scans, or execute exploitation steps.

    Args:
        recon_data: Dictionary of reconnaissance results
        tool_executor: Callable(tool_name, arguments) -> str
        socketio: Optional SocketIO instance
        target: Optional target name
        max_iterations: Max tool-calling rounds

    Returns:
        Final AI analysis string or None on error
    """
    provider = _get_provider()
    model_name = provider.get_model_name()
    stream_thought(f"Starting agentic analysis via {model_name} with MCP tools...")

    try:
        from mcp_server.server import get_mcp_tool_definitions
        tool_defs = get_mcp_tool_definitions()
    except ImportError:
        stream_thought("MCP server not available, falling back to text mode.")
        return ask_ai(recon_data, socketio, target)

    recon_json = json.dumps(recon_data, indent=2)
    data_preview = recon_json[:7000]

    agentic_prompt = (
        "You are an autonomous penetration testing AI. You have access to MCP tools "
        "for reconnaissance, exploitation, API scanning, credential management, and more. "
        "Analyze the provided recon data and use the tools to gather additional information, "
        "run scans, and execute your attack plan. When done, provide a summary of findings."
    )

    messages = [
        {"role": "user", "content": f"Analyze and attack this target. Recon data:\n{data_preview}"}
    ]

    if socketio:
        socketio.emit('ai_thought', {
            'target': target,
            'thoughtType': 'ai_prompt',
            'content': f'Starting agentic loop with {len(tool_defs)} MCP tools via {model_name}',
            'timestamp': None
        })

    try:
        result = provider.chat_with_tools_loop(
            messages, tool_defs, tool_executor,
            system_prompt=agentic_prompt,
            max_iterations=max_iterations
        )
        stream_thought(f"Agentic analysis complete via {model_name}.")
        return result
    except Exception as e:
        error_msg = f"Agentic AI loop failed: {e}"
        print(f"[AI ➤ ERROR] {error_msg}")
        stream_thought(f"❌ {error_msg}")
        return None


def parse_ai_commands(ai_response, socketio=None, target=None):
    """
    Extract shell commands from the AI response.

    Args:
        ai_response: AI response text containing commands
        socketio: Optional SocketIO instance for emitting progress
        target: Optional target name for tracking

    Returns:
        List of parsed command arrays
    """
    if not ai_response:
        return []

    if socketio:
        socketio.emit('ai_thought', {
            'target': target,
            'thoughtType': 'decision',
            'content': 'Parsing AI response for executable commands...',
            'timestamp': None
        })

    commands_text = ""
    match = re.search(r"```(?:bash)?\n(.*?)```", ai_response, re.DOTALL)
    if match:
        commands_text = match.group(1).strip()
    else:
        commands_text = "\n".join(
            line.strip()
            for line in ai_response.splitlines()
            if line.strip() and not line.strip().startswith("#")
        )

    commands = []
    for line in commands_text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        commands.append(line.split())

    stream_thought(f"Parsed {len(commands)} commands for execution.")

    if socketio:
        command_strings = [' '.join(cmd) for cmd in commands]
        socketio.emit('ai_thought', {
            'target': target,
            'thoughtType': 'ai_decision',
            'content': f'Parsed {len(commands)} commands from AI response',
            'metadata': {
                'commands': command_strings,
                'raw_response': ai_response
            },
            'timestamp': None
        })

    return commands


def get_thoughts():
    """Return the current list of AI thoughts (for dashboard use)."""
    return AI_THOUGHTS.copy()
