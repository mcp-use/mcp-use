"""
Example: Fetch a GitHub repo README and summarize it with Ollama LLM.

Requires:
- requests
- langchain_ollama
- ollama running with llama3.2 (or similar) model

You do NOT need Playwright, MCPClient, or browser automation for this.
"""

import requests
from langchain_ollama import ChatOllama


def fetch_github_readme(owner: str, repo: str) -> str:
    """Fetches README.md content from a GitHub repository using the GitHub API."""
    url = f"https://api.github.com/repos/{owner}/{repo}/readme"
    headers = {"Accept": "application/vnd.github.v3.raw"}
    response = requests.get(url, headers=headers)
    if response.status_code == 200:
        return response.text
    else:
        raise Exception(f"Failed to fetch README: {response.status_code}")


def summarize_with_ollama(text: str, model: str = "llama3.2:latest") -> str:
    """Summarize text using Ollama LLM via LangChain."""
    llm = ChatOllama(
        model=model,
        base_url="http://localhost:11434",
        temperature=0.7,
    )
    prompt = (
        "Summarize the following GitHub README in plain language, "
        "focusing on what the project does and why it's useful:\n\n"
        f"{text}\n\nSummary:"
    )
    return llm.invoke(prompt)


if __name__ == "__main__":
    # 1. Fetch the README from GitHub
    owner = "mcp-use"
    repo = "mcp-use"
    readme_text = fetch_github_readme(owner, repo)

    # 2. Summarize it with Ollama
    summary = summarize_with_ollama(readme_text)
    try:
        print(summary.content)
    except AttributeError:
        print(summary)
