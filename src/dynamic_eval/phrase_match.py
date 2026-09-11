"""Shared word-boundary phrase matching used across the dynamic-evaluation
modules (text_analyzer, risk_formulation, danger_ladder)."""

import re

_APOSTROPHES = re.compile(r"['’‘]")


def normalize(text: str) -> str:
    return _APOSTROPHES.sub("", (text or "").lower())


def contains_phrase(text: str, phrase: str) -> bool:
    clean_phrase = _APOSTROPHES.sub("", phrase)
    pattern = r"(?<![\w])" + re.escape(clean_phrase) + r"(?![\w])"
    return re.search(pattern, text, flags=re.UNICODE) is not None
