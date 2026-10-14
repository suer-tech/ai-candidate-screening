#!/usr/bin/python3
"""Forced SSH entry point; accepts only an exact candidate release SHA."""
import os
import re
import sys


def parse_command(command: str) -> str:
    match = re.fullmatch(r"deploy ([0-9a-f]{40})", command)
    if not match:
        raise ValueError("Only an exact approved deployment is allowed")
    return match.group(1)


def main() -> None:
    try:
        sha = parse_command(os.environ.get("SSH_ORIGINAL_COMMAND", ""))
    except ValueError:
        sys.exit("Only an exact approved deployment is allowed")
    os.execv("/usr/bin/sudo", ["sudo", "-n", "/usr/local/sbin/hh-approved-code-deploy", sha])


if __name__ == "__main__":
    main()
