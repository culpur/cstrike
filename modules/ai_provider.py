# cstrike/modules/ai_provider.py
# Abstract AI provider with OpenAI, Ollama, Anthropic, and Grok implementations

import json
import logging
from abc import ABC, abstractmethod

log = logging.getLogger("cstrike.ai_provider")


class AIProvider(ABC):
    """Abstract base for AI providers."""

    @abstractmethod
    def chat(self, messages, tools=None, system_prompt=None):
        """Single-turn chat completion with optional tool definitions.

        Returns: {"content": str, "tool_calls": list|None, "usage": dict|None}
        """
        ...

    @abstractmethod
    def chat_with_tools_loop(self, messages, tools, tool_executor,
                             system_prompt=None, max_iterations=10):
        """Agentic loop: chat -> tool_calls -> execute -> feed back -> repeat.

        Args:
            messages: Conversation history
            tools: Tool definitions (OpenAI/Ollama format)
            tool_executor: Callable(tool_name, arguments) -> str
            system_prompt: System message prepended to messages
            max_iterations: Max tool-calling rounds

        Returns: Final assistant response content string
        """
        ...

    @abstractmethod
    def get_model_name(self):
        """Return the model identifier."""
        ...

    @abstractmethod
    def is_available(self):
        """Check if this provider is reachable."""
        ...


class OpenAIProvider(AIProvider):
    """Wraps the OpenAI chat completions API."""

    def __init__(self, api_key, model="gpt-5.2",
                 max_tokens=800, temperature=0.3,
                 base_url=None):
        from openai import OpenAI
        kwargs = {"api_key": api_key}
        if base_url:
            kwargs["base_url"] = base_url
        self.client = OpenAI(**kwargs)
        self.model = model
        self.max_tokens = max_tokens
        self.temperature = temperature

    def get_model_name(self):
        return self.model

    def is_available(self):
        return bool(self.client.api_key)

    def chat(self, messages, tools=None, system_prompt=None):
        full_messages = list(messages)
        if system_prompt:
            full_messages.insert(0, {"role": "system", "content": system_prompt})

        kwargs = {
            "model": self.model,
            "messages": full_messages,
            "max_tokens": self.max_tokens,
            "temperature": self.temperature,
        }
        if tools:
            kwargs["tools"] = tools

        response = self.client.chat.completions.create(**kwargs)
        msg = response.choices[0].message

        tool_calls = None
        if hasattr(msg, "tool_calls") and msg.tool_calls:
            tool_calls = [
                {
                    "id": tc.id,
                    "function": {
                        "name": tc.function.name,
                        "arguments": json.loads(tc.function.arguments)
                    }
                }
                for tc in msg.tool_calls
            ]

        return {
            "content": msg.content or "",
            "tool_calls": tool_calls,
            "usage": {
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
                "total_tokens": response.usage.total_tokens,
            } if response.usage else None
        }

    def chat_with_tools_loop(self, messages, tools, tool_executor,
                             system_prompt=None, max_iterations=10):
        full_messages = list(messages)
        if system_prompt:
            full_messages.insert(0, {"role": "system", "content": system_prompt})

        for i in range(max_iterations):
            log.info(f"[OpenAI/{self.model}] Iteration {i+1}/{max_iterations}")
            response = self.chat(full_messages, tools=tools)

            if not response["tool_calls"]:
                return response["content"]

            # Append assistant message with tool calls
            full_messages.append({
                "role": "assistant",
                "content": response["content"],
                "tool_calls": [
                    {
                        "id": tc["id"],
                        "type": "function",
                        "function": {
                            "name": tc["function"]["name"],
                            "arguments": json.dumps(tc["function"]["arguments"])
                        }
                    }
                    for tc in response["tool_calls"]
                ]
            })

            # Execute each tool call and append results
            for tc in response["tool_calls"]:
                name = tc["function"]["name"]
                args = tc["function"]["arguments"]
                log.info(f"[OpenAI] Tool call: {name}({json.dumps(args)[:200]})")

                try:
                    result = tool_executor(name, args)
                except Exception as e:
                    result = json.dumps({"error": str(e)})

                full_messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": str(result)
                })

        # Final attempt without tools to get a text response
        log.warning(f"[OpenAI/{self.model}] Max iterations ({max_iterations}) reached, requesting final response")
        final = self.chat(full_messages)
        return final.get("content", "Max iterations reached.")


class OllamaProvider(AIProvider):
    """Local Ollama LLM with native tool calling."""

    def __init__(self, model="qwen3", host="http://localhost:11434"):
        self.model = model
        self.host = host
        self._client = None

    def _get_client(self):
        if self._client is None:
            import ollama
            self._client = ollama.Client(host=self.host)
        return self._client

    def get_model_name(self):
        return self.model

    def is_available(self):
        try:
            self._get_client().list()
            return True
        except Exception:
            return False

    def chat(self, messages, tools=None, system_prompt=None):
        client = self._get_client()
        full_messages = list(messages)
        if system_prompt:
            full_messages.insert(0, {"role": "system", "content": system_prompt})

        kwargs = {
            "model": self.model,
            "messages": full_messages,
        }
        if tools:
            kwargs["tools"] = tools

        response = client.chat(**kwargs)
        msg = response.message

        tool_calls = None
        if hasattr(msg, "tool_calls") and msg.tool_calls:
            tool_calls = [
                {
                    "id": f"call_{i}",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments
                            if isinstance(tc.function.arguments, dict)
                            else json.loads(tc.function.arguments)
                    }
                }
                for i, tc in enumerate(msg.tool_calls)
            ]

        return {
            "content": msg.content or "",
            "tool_calls": tool_calls,
            "usage": None
        }

    def chat_with_tools_loop(self, messages, tools, tool_executor,
                             system_prompt=None, max_iterations=10):
        full_messages = list(messages)
        if system_prompt:
            full_messages.insert(0, {"role": "system", "content": system_prompt})

        for i in range(max_iterations):
            log.info(f"[Ollama/{self.model}] Iteration {i+1}/{max_iterations}")
            response = self.chat(full_messages, tools=tools)

            if not response["tool_calls"]:
                return response["content"]

            # Append assistant message with tool calls
            assistant_msg = {
                "role": "assistant",
                "content": response["content"],
                "tool_calls": [
                    {
                        "id": tc["id"],
                        "type": "function",
                        "function": {
                            "name": tc["function"]["name"],
                            "arguments": json.dumps(tc["function"]["arguments"])
                                if isinstance(tc["function"]["arguments"], dict)
                                else tc["function"]["arguments"]
                        }
                    }
                    for tc in response["tool_calls"]
                ]
            }
            full_messages.append(assistant_msg)

            # Execute each tool call and append results
            for tc in response["tool_calls"]:
                name = tc["function"]["name"]
                args = tc["function"]["arguments"]
                log.info(f"[Ollama] Tool call: {name}({json.dumps(args)[:200]})")

                try:
                    result = tool_executor(name, args)
                except Exception as e:
                    result = json.dumps({"error": str(e)})

                full_messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": str(result)
                })

        # Final attempt without tools to get a text response
        log.warning(f"[Ollama/{self.model}] Max iterations ({max_iterations}) reached, requesting final response")
        final = self.chat(full_messages)
        return final.get("content", "Max iterations reached.")


class AnthropicProvider(AIProvider):
    """Anthropic Claude API with tool calling support."""

    def __init__(self, api_key, model="claude-sonnet-4-6",
                 max_tokens=8096, temperature=0.3):
        self._api_key = api_key
        self.model = model
        self.max_tokens = max_tokens
        self.temperature = temperature
        self._client = None

    def _get_client(self):
        if self._client is None:
            import anthropic
            self._client = anthropic.Anthropic(api_key=self._api_key)
        return self._client

    def _convert_tools(self, tools):
        """Convert OpenAI tool format to Anthropic format.

        OpenAI: [{"type":"function","function":{"name":...,"parameters":...}}]
        Anthropic: [{"name":...,"description":...,"input_schema":...}]
        """
        if not tools:
            return None
        anthropic_tools = []
        for t in tools:
            fn = t.get("function", t)
            anthropic_tools.append({
                "name": fn["name"],
                "description": fn.get("description", ""),
                "input_schema": fn.get("parameters",
                                       {"type": "object", "properties": {}})
            })
        return anthropic_tools

    def get_model_name(self):
        return self.model

    def is_available(self):
        return bool(self._api_key)

    def chat(self, messages, tools=None, system_prompt=None):
        client = self._get_client()

        # Filter out system messages (Anthropic uses top-level system param)
        filtered = [m for m in messages if m.get("role") != "system"]

        kwargs = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "temperature": self.temperature,
            "messages": filtered,
        }
        if system_prompt:
            kwargs["system"] = system_prompt
        if tools:
            kwargs["tools"] = self._convert_tools(tools)

        response = client.messages.create(**kwargs)

        content_text = ""
        tool_calls = None
        for block in response.content:
            if block.type == "text":
                content_text += block.text
            elif block.type == "tool_use":
                if tool_calls is None:
                    tool_calls = []
                tool_calls.append({
                    "id": block.id,
                    "function": {
                        "name": block.name,
                        "arguments": block.input
                    }
                })

        usage = None
        if response.usage:
            usage = {
                "prompt_tokens": response.usage.input_tokens,
                "completion_tokens": response.usage.output_tokens,
                "total_tokens": response.usage.input_tokens + response.usage.output_tokens,
            }

        return {
            "content": content_text,
            "tool_calls": tool_calls,
            "usage": usage
        }

    def chat_with_tools_loop(self, messages, tools, tool_executor,
                             system_prompt=None, max_iterations=10):
        client = self._get_client()
        anthropic_tools = self._convert_tools(tools)

        # Build Anthropic-native message list (no system role)
        full_messages = [m for m in messages if m.get("role") != "system"]

        for i in range(max_iterations):
            log.info(f"[Anthropic/{self.model}] Iteration {i+1}/{max_iterations}")

            kwargs = {
                "model": self.model,
                "max_tokens": self.max_tokens,
                "temperature": self.temperature,
                "messages": full_messages,
            }
            if system_prompt:
                kwargs["system"] = system_prompt
            if anthropic_tools:
                kwargs["tools"] = anthropic_tools

            response = client.messages.create(**kwargs)

            if response.stop_reason != "tool_use":
                return "".join(
                    b.text for b in response.content if b.type == "text"
                )

            # Serialize SDK content blocks to dicts for message history
            serialized_content = []
            for block in response.content:
                if block.type == "text":
                    serialized_content.append({"type": "text", "text": block.text})
                elif block.type == "tool_use":
                    serialized_content.append({
                        "type": "tool_use",
                        "id": block.id,
                        "name": block.name,
                        "input": block.input,
                    })

            full_messages.append({
                "role": "assistant",
                "content": serialized_content,
            })

            # Execute tool calls and build tool_result user message
            tool_results = []
            for block in response.content:
                if block.type != "tool_use":
                    continue
                log.info(f"[Anthropic] Tool call: {block.name}({str(block.input)[:200]})")
                try:
                    result = tool_executor(block.name, block.input)
                except Exception as e:
                    result = json.dumps({"error": str(e)})
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": str(result)
                })

            full_messages.append({"role": "user", "content": tool_results})

        return "Max iterations reached."


class GrokProvider(OpenAIProvider):
    """xAI Grok API — OpenAI-compatible, subclass of OpenAIProvider."""

    def __init__(self, api_key, model="grok-3",
                 max_tokens=800, temperature=0.3):
        super().__init__(
            api_key=api_key,
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            base_url="https://api.x.ai/v1",
        )


def create_provider(config):
    """Factory: create the configured AI provider.

    Args:
        config: Dict from .env JSON

    Returns:
        AIProvider instance

    Raises:
        ValueError: If a required API key is missing for the selected provider
    """
    provider_name = config.get("ai_provider", "openai")

    if provider_name == "ollama":
        return OllamaProvider(
            model=config.get("ollama_model", "qwen3"),
            host=config.get("ollama_host", "http://localhost:11434"),
        )
    elif provider_name == "anthropic":
        api_key = config.get("anthropic_api_key", "")
        if not api_key:
            raise ValueError("anthropic_api_key is required for Anthropic provider")
        return AnthropicProvider(
            api_key=api_key,
            model=config.get("anthropic_model", "claude-sonnet-4-6"),
            max_tokens=config.get("ai_max_tokens", 8096),
            temperature=config.get("ai_temperature", 0.3),
        )
    elif provider_name == "grok":
        api_key = config.get("grok_api_key", "")
        if not api_key:
            raise ValueError("grok_api_key is required for Grok provider")
        return GrokProvider(
            api_key=api_key,
            model=config.get("grok_model", "grok-3"),
            max_tokens=config.get("ai_max_tokens", 800),
            temperature=config.get("ai_temperature", 0.3),
        )
    else:
        api_key = config.get("openai_api_key", "")
        if not api_key:
            raise ValueError("openai_api_key is required for OpenAI provider")
        return OpenAIProvider(
            api_key=api_key,
            model=config.get("openai_model", "gpt-5.2"),
            max_tokens=config.get("ai_max_tokens", 800),
            temperature=config.get("ai_temperature", 0.3),
        )
