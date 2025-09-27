def estimate_tokens(text: str) -> int:
    """Rough estimate of token count (approximately 4 characters per token)."""
    return max(1, len(str(text)) // 4)
