# Voice-First AI Personal Assistant

A voice-enabled AI assistant that demonstrates the power of `mcp-use` by integrating multiple MCP servers for natural voice interactions.

## Features

- **Voice Input**: Real-time speech-to-text using OpenAI Whisper
- **Multi-Tool Integration**:
  - ElevenLabs for text-to-speech
  - Linear for task management
  - Filesystem for note-taking
- **Conversational Memory**: Maintains context across interactions
- **Natural Language Processing**: Powered by GPT-4

## Architecture

```
User Voice → Speech-to-Text → LLM (MCPAgent) → MCP Tools → Text-to-Speech → Audio Output
```

## Prerequisites

1. **API Keys**:
   - `OPENAI_API_KEY`: For Whisper speech-to-text and GPT-4
   - `ELEVENLABS_API_KEY`: For text-to-speech generation

2. **Python Dependencies**:
   ```bash
   pip install pyaudio openai pygame numpy
   ```

3. **System Dependencies**:
   - On macOS: `brew install portaudio`
   - On Ubuntu/Debian: `sudo apt-get install portaudio19-dev`
   - On Windows: PyAudio wheel includes PortAudio

4. **MCP Servers**: Will be automatically installed via npx

## Setup

1. **Configure Environment Variables**:
   ```bash
   export OPENAI_API_KEY="your-openai-api-key"
   export ELEVENLABS_API_KEY="your-elevenlabs-api-key"
   ```

2. **Create Notes Directory**:
   ```bash
   mkdir -p /tmp/voice_assistant_notes
   ```

3. **Linear Setup**:
   - The Linear MCP server will prompt for authentication on first use
   - Follow the browser authentication flow

## Usage

Run the voice assistant:

```bash
python examples/voice_assistant.py
```

### Voice Commands

- **Task Management**:
  - "Create a Linear issue about fixing the login bug"
  - "What tasks are assigned to me in Linear?"
  - "Update the status of issue LIN-123 to in progress"

- **Note Taking**:
  - "Take a note about the meeting tomorrow at 3 PM"
  - "Read my notes from today"
  - "Create a shopping list with milk, eggs, and bread"

- **System Commands**:
  - "Clear" - Clear conversation history
  - "Exit" or "Goodbye" - Quit the assistant

### Example Interaction

```
You: "Create a Linear issue about updating the documentation"
Assistant: "I've created a new Linear issue titled 'Update documentation' with ID LIN-456"

You: "Take a note that I need to review pull requests today"
Assistant: "I've saved your note about reviewing pull requests today"

You: "What notes do I have?"
Assistant: "You have 3 notes: 1) Meeting tomorrow at 3 PM, 2) Review pull requests today, 3) Shopping list with milk, eggs, and bread"
```

## Configuration

The `voice_assistant_mcp.json` file configures three MCP servers:

1. **ElevenLabs**: High-quality text-to-speech
2. **Linear**: Project and task management
3. **Filesystem**: Local note storage

You can modify this file to add more MCP servers or change the configuration.

## Customization

### Adding New MCP Servers

Edit `voice_assistant_mcp.json`:

```json
{
  "mcpServers": {
    "your_server": {
      "command": "npx",
      "args": ["-y", "@your-org/mcp-server"],
      "env": {
        "YOUR_API_KEY": "${YOUR_API_KEY}"
      }
    }
  }
}
```

### Changing Voice Settings

Modify the assistant's system prompt in `voice_assistant.py`:

```python
system_prompt=(
    "You are a [personality] voice assistant..."
)
```

### Adjusting Audio Settings

- `silence_threshold`: Sensitivity for voice detection (lower = more sensitive)
- `silence_duration`: How long to wait after speech stops
- `rate`: Audio sample rate (16000 Hz recommended for Whisper)

## Troubleshooting

### No Audio Input Detected
- Check microphone permissions
- Verify PyAudio installation: `python -c "import pyaudio; print(pyaudio.PyAudio().get_device_count())"`
- Lower the `silence_threshold` value

### ElevenLabs TTS Not Working
- Verify `ELEVENLABS_API_KEY` is set correctly
- Check ElevenLabs API quota
- The MCP server will provide detailed error messages

### Linear Authentication Issues
- Delete cached credentials and re-authenticate
- Ensure you have access to the Linear workspace
- Check browser popup blockers

### High Latency
- Use a faster LLM model (e.g., `gpt-3.5-turbo`)
- Reduce `max_steps` in MCPAgent configuration
- Consider using streaming responses

## Advanced Features

### Wake Word Detection
To add wake word detection, integrate libraries like:
- Porcupine for offline wake word detection
- Snowboy for custom wake words

### Multi-Language Support
- Set Whisper language parameter: `language="es"` for Spanish
- Use ElevenLabs multilingual voices
- Adjust system prompt for language-specific responses

### Web Interface
Create a web UI using:
- FastAPI for backend API
- WebRTC for browser-based audio
- Socket.IO for real-time communication

## Contributing

Feel free to extend this example with:
- Additional MCP server integrations
- Improved voice activity detection
- Visual feedback UI
- Voice personality customization
- Integration with more productivity tools
