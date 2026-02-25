#!/usr/bin/env python3

import os
import json
from openai import OpenAI

# Load JSON-style .env
with open(".env", "r") as f:
    config = json.load(f)

api_key = config.get("openai_api_key")
if not api_key:
    print("[-] openai_api_key is missing in .env JSON.")
    exit(1)

client = OpenAI(api_key=api_key)

try:
    response = client.chat.completions.create(
        model="gpt-4",
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "Say hello!"}
        ]
    )
    print("[+] API Test Successful:")
    print(response.choices[0].message.content)
except Exception as e:
    print("[-] API Test Failed:")
    print(e)
