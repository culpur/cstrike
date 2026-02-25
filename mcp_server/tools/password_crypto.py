# cstrike/mcp_server/tools/password_crypto.py — Password cracking & hash tools

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from modules.utils import run_command_with_log, save_result, get_target_dir


def register(mcp, guardrails):

    @mcp.tool()
    async def hashcat_crack(hash_file: str, wordlist: str,
                            hash_type: int = 0, rules: str = "") -> str:
        """Crack password hashes using hashcat (GPU-accelerated). hash_type:
        0=MD5, 100=SHA1, 1000=NTLM, 1800=sha512crypt, 3200=bcrypt, etc.
        rules: path to rules file for word mangling."""
        guardrails.enforce("hashcat", hash_file)

        target_safe = os.path.basename(hash_file).replace(".", "_")
        pot_file = f"/tmp/hashcat_{target_safe}.pot"
        cmd = ["hashcat", "-a", "0", "-m", str(hash_type),
               hash_file, wordlist, "--potfile-path", pot_file,
               "--force"]
        if rules:
            cmd.extend(["-r", rules])

        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())

        # Read potfile for cracked results
        cracked = ""
        if os.path.exists(pot_file):
            with open(pot_file) as f:
                cracked = f.read()

        save_result(hash_file, "hashcat", cmd, output)
        return json.dumps({"tool": "hashcat", "hash_file": hash_file,
                           "hash_type": hash_type, "cracked": cracked,
                           "output": output})

    @mcp.tool()
    async def john_crack(hash_file: str, wordlist: str = "",
                         format: str = "") -> str:
        """Crack password hashes using John the Ripper. Auto-detects hash
        format if not specified. wordlist: path to wordlist file."""
        guardrails.enforce("john", hash_file)

        cmd = ["john"]
        if wordlist:
            cmd.append(f"--wordlist={wordlist}")
        if format:
            cmd.append(f"--format={format}")
        cmd.append(hash_file)

        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())
        save_result(hash_file, "john", cmd, output)
        return json.dumps({"tool": "john", "hash_file": hash_file,
                           "output": output})

    @mcp.tool()
    async def john_show(hash_file: str, format: str = "") -> str:
        """Show previously cracked passwords from John the Ripper's potfile."""
        guardrails.enforce("john", hash_file)

        cmd = ["john", "--show"]
        if format:
            cmd.append(f"--format={format}")
        cmd.append(hash_file)

        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())
        return json.dumps({"tool": "john_show", "hash_file": hash_file,
                           "output": output})

    @mcp.tool()
    async def cewl_generate(target: str, url: str, depth: int = 2,
                            min_length: int = 5) -> str:
        """Generate a custom wordlist by spidering a website using CeWL.
        Extracts words from web content for targeted password attacks."""
        guardrails.enforce("cewl", target)

        target_safe = target.replace(".", "_").replace("/", "_")
        out_file = f"/tmp/cewl_{target_safe}.txt"
        cmd = ["cewl", url, "-d", str(depth), "-m", str(min_length),
               "-w", out_file]

        output = await asyncio.to_thread(
            run_command_with_log, cmd, guardrails.get_timeout())

        word_count = 0
        if os.path.exists(out_file):
            with open(out_file) as f:
                word_count = sum(1 for _ in f)

        save_result(target, "cewl", cmd, output)
        return json.dumps({"tool": "cewl", "target": target, "url": url,
                           "wordlist": out_file, "word_count": word_count,
                           "output": output})

    @mcp.tool()
    async def hashid_identify(hash_value: str) -> str:
        """Identify the hash type of a given hash string. Returns possible
        hash algorithms with hashcat (-m) and john (--format) mode identifiers."""
        guardrails.enforce("hashid", hash_value)

        cmd = ["hashid", "-mj", hash_value]

        output = await asyncio.to_thread(
            run_command_with_log, cmd, 30)
        return json.dumps({"tool": "hashid", "hash": hash_value,
                           "output": output})
