#!/usr/bin/env python3
"""
Mints a one-time invite code for a counsellor or doctor to self-register
with (see src/auth.py's INVITE_REQUIRED_ROLES / create_invite_code).

Run this on the server (or anywhere pointed at the same database via
JANAMDATRI_DATA_DIR) whenever you're bringing on an actual staff member -
hand them the printed code out-of-band (in person, a private message),
not over the same channel a patient could see it on. The code is
single-use: it's consumed the moment someone registers with it.

Usage:
    python -m scripts.create_invite_code counsellor
    python -m scripts.create_invite_code doctor
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src import auth


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in auth.INVITE_REQUIRED_ROLES:
        roles = "|".join(auth.INVITE_REQUIRED_ROLES)
        print(f"Usage: python -m scripts.create_invite_code <{roles}>", file=sys.stderr)
        sys.exit(1)

    auth.init_db()
    role = sys.argv[1]
    code = auth.create_invite_code(role)
    print(f"New {role} invite code: {code}")
    print("Single-use - give it to one person, who enters it when they sign up.")


if __name__ == "__main__":
    main()
