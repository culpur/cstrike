# /opt/ai_driver/modules/ai_assistant.py

import os
import json
import re
from pathlib import Path
from openai import OpenAI

# Live thoughts queue (used by TUI for streaming sidebar)
AI_THOUGHTS = []

# Load config
CONFIG = json.loads(Path(".env").read_text())
OPENAI_API_KEY = CONFIG.get("openai_api_key")

client = OpenAI(api_key=OPENAI_API_KEY)

def stream_thought(thought):
    """Send a new thought to the global stream queue."""
    if len(AI_THOUGHTS) >= 20:
        AI_THOUGHTS.pop(0)
    AI_THOUGHTS.append(f"🧠 {thought}")


def ask_ai(recon_data, socketio=None, target=None):
    """
    Ask AI for next steps based on recon data

    Args:
        recon_data: Dictionary of reconnaissance results
        socketio: Optional SocketIO instance for emitting progress
        target: Optional target name for tracking

    Returns:
        AI suggestion string or None on error
    """
    print("[AI ➤ Asking for next step...]")
    stream_thought("Analyzing recon data for actionable next steps...")

    # Emit prompt preparation event
    if socketio:
        socketio.emit('ai_thought', {
            'target': target,
            'thoughtType': 'observation',
            'content': 'Preparing AI analysis prompt with reconnaissance data...',
            'timestamp': None
        })

    try:
        system_prompt = (
            "You are a highly skilled penetration testing AI assistant. "
            "Based on the following recon and loot data, suggest additional commands "
            "to enumerate, exploit, or pivot further. Return only shell commands if possible."
        )

        # Truncate data to 7000 chars
        recon_json = json.dumps(recon_data, indent=2)
        data_preview = recon_json[:7000]

        messages = [
            {
                "role": "system",
                "content": system_prompt
            },
            {
                "role": "user",
                "content": f"Recon and loot data:\n{data_preview}"
            },
        ]

        # Emit prompt being sent
        if socketio:
            socketio.emit('ai_thought', {
                'target': target,
                'thoughtType': 'ai_prompt',
                'content': f'Sending prompt to OpenAI (gpt-4o)...',
                'metadata': {
                    'system_prompt': system_prompt,
                    'data_preview': data_preview[:500] + '...' if len(data_preview) > 500 else data_preview,
                    'model': 'gpt-4o',
                    'max_tokens': 800,
                    'temperature': 0.3
                },
                'timestamp': None
            })

        # Call OpenAI API
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            max_tokens=800,
            temperature=0.3
        )

        suggestion = response.choices[0].message.content.strip()
        stream_thought("Commands prepared based on recon.")

        # Emit AI response received
        if socketio:
            socketio.emit('ai_thought', {
                'target': target,
                'thoughtType': 'ai_response',
                'content': f'Received AI response ({len(suggestion)} chars)',
                'metadata': {
                    'response': suggestion,
                    'usage': {
                        'prompt_tokens': response.usage.prompt_tokens if hasattr(response, 'usage') else None,
                        'completion_tokens': response.usage.completion_tokens if hasattr(response, 'usage') else None,
                        'total_tokens': response.usage.total_tokens if hasattr(response, 'usage') else None
                    }
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
                'content': f'❌ AI API error: {str(e)}',
                'timestamp': None
            })

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

    # Emit parsing start
    if socketio:
        socketio.emit('ai_thought', {
            'target': target,
            'thoughtType': 'decision',
            'content': 'Parsing AI response for executable commands...',
            'timestamp': None
        })

    commands_text = ""
    # Extract code block if present
    match = re.search(r"```(?:bash)?\n(.*?)```", ai_response, re.DOTALL)
    if match:
        commands_text = match.group(1).strip()
    else:
        # Try to extract lines that look like commands
        commands_text = "\n".join(
            line.strip()
            for line in ai_response.splitlines()
            if line.strip() and not line.strip().startswith("#")
        )

    # Parse into individual commands
    commands = []
    for line in commands_text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        commands.append(line.split())

    stream_thought(f"Parsed {len(commands)} commands for execution.")

    # Emit parsed commands
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
