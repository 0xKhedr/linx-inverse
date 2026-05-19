from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any


DEFAULT_LANGUAGE = "en"
TRANSLATIONS_PATH = Path(__file__).with_name("translations.json")


@lru_cache(maxsize=1)
def get_translations() -> dict[str, dict[str, Any]]:
    with TRANSLATIONS_PATH.open(encoding="utf-8") as translations_file:
        translations = json.load(translations_file)

    if DEFAULT_LANGUAGE not in translations:
        raise RuntimeError(f"Missing default language '{DEFAULT_LANGUAGE}' in translations.")

    return translations


def resolve_language(language: str | None) -> str:
    translations = get_translations()
    if language in translations:
        return language
    return DEFAULT_LANGUAGE


def get_ui_copy(language: str | None) -> dict[str, Any]:
    return get_translations()[resolve_language(language)]
