# Bookkeeping Tools MCP Server

An MCP server exposing two tools for SaaS startup 
bookkeeping — transaction categorization with confidence 
scoring and human-review flagging.

Works without any API key for common vendors (AWS, 
Figma, Google Ads). Flags ambiguous cases with specific 
clarifying questions rather than guessing.

## What it demonstrates
- Building an MCPServer with two tools
- Rule-based categorization with confidence scoring
- Uncertainty handling — flags review cases explicitly
- Using MCPAgent to interact with the server

## Setup
1. pip install -r requirements.txt
2. cp .env.example .env and add GEMINI_API_KEY
3. python server.py

## Run
python server.py    # start the MCP server
python client.py   # run the agent demo

## Background
Motivated by reliability research on AI bookkeeping:
https://github.com/Wali05/bookkeeping-ai-eval
