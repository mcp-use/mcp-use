"""
Voice-First AI Personal Assistant with MCP Integration (Improved Version)

This example demonstrates a voice-enabled personal assistant that uses:
- Speech-to-text for voice input (OpenAI Whisper)
- MCPAgent with multiple MCP servers (ElevenLabs, Linear, filesystem)
- Text-to-speech for voice output (ElevenLabs MCP or system TTS)

This version includes better error handling and fallback options.
"""

import asyncio
import os
import sys
import tempfile
from datetime import datetime

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

from mcp_use import MCPAgent, MCPClient

# Optional imports for full audio functionality
try:
    import io
    import wave

    import numpy as np
    import openai
    import pyaudio

    AUDIO_CAPTURE_AVAILABLE = True
except ImportError:
    AUDIO_CAPTURE_AVAILABLE = False

try:
    import pygame

    AUDIO_PLAYBACK_AVAILABLE = True
except ImportError:
    AUDIO_PLAYBACK_AVAILABLE = False

# Try to import system TTS regardless of pygame availability
try:
    import pyttsx3

    TTS_ENGINE = pyttsx3.init()
    SYSTEM_TTS_AVAILABLE = True
except Exception:
    SYSTEM_TTS_AVAILABLE = False


class VoiceAssistant:
    """Improved voice-enabled AI assistant with better error handling."""

    def __init__(self, config_file: str | None = None):
        """Initialize the voice assistant."""
        load_dotenv()

        # Audio configuration
        self.audio_format = pyaudio.paInt16 if AUDIO_CAPTURE_AVAILABLE else None
        self.channels = 1
        self.rate = 16000
        self.chunk = 1024
        self.silence_threshold = 500
        self.silence_duration = 1.5

        # Initialize audio components if available
        self.audio = pyaudio.PyAudio() if AUDIO_CAPTURE_AVAILABLE else None
        if AUDIO_PLAYBACK_AVAILABLE:
            pygame.mixer.init()

        # OpenAI client for speech-to-text
        self.openai_client = openai.OpenAI() if os.getenv("OPENAI_API_KEY") else None

        # MCP configuration
        self.config_file = config_file
        self.mcp_client = None
        self.agent = None

        # Create a proper notes directory
        self.notes_dir = os.path.join(tempfile.gettempdir(), "voice_assistant_notes")
        os.makedirs(self.notes_dir, exist_ok=True)

    async def initialize_mcp(self):
        """Initialize MCP client and agent with proper error handling."""
        print("Initializing MCP servers...")

        # Build configuration dynamically based on available API keys
        config = {
            "mcpServers": {
                "filesystem": {
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-filesystem", self.notes_dir],
                },
                "elevenlabs": {
                    "command": "uvx",
                    "args": ["elevenlabs-mcp"],
                    "env": {"ELEVENLABS_API_KEY": os.getenv("ELEVENLABS_API_KEY")},
                },
                "linear": {"command": "npx", "args": ["-y", "mcp-remote", "https://mcp.linear.app/sse"]},
            }
        }

        try:
            # Create MCP client
            self.mcp_client = MCPClient.from_dict(config)

            # Create LLM
            llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.7)

            # Create agent with memory
            self.agent = MCPAgent(
                llm=llm,
                client=self.mcp_client,
                max_steps=15,
                memory_enabled=True,
                system_prompt=(
                    "You are a helpful voice assistant with access to various tools. "
                    "You can manage tasks in Linear, take notes, and speak responses. "
                    "Be concise in your responses since they will be spoken aloud. "
                    "When taking notes, save them to files in the notes directory. "
                    "When asked to list notes, read the files in the notes directory."
                ),
            )

            print("✓ MCP servers initialized successfully!")
            return True

        except Exception as e:
            print(f"✗ Error initializing MCP: {e}")
            return False

    def detect_silence(self, audio_data: bytes) -> bool:
        """Detect if audio contains silence."""
        if not AUDIO_CAPTURE_AVAILABLE:
            return True
        audio_array = np.frombuffer(audio_data, dtype=np.int16)
        return np.max(np.abs(audio_array)) < self.silence_threshold

    def record_audio(self) -> bytes | None:
        """Record audio from microphone or get text input as fallback."""
        if not AUDIO_CAPTURE_AVAILABLE or not self.audio:
            # Fallback to text input
            text = input("\nEnter your message (or 'exit' to quit): ")
            return text.encode() if text else None

        print("\nListening... (speak now)")

        try:
            stream = self.audio.open(
                format=self.audio_format,
                channels=self.channels,
                rate=self.rate,
                input=True,
                frames_per_buffer=self.chunk,
            )

            frames = []
            silence_frames = 0
            silence_frame_threshold = int(self.rate / self.chunk * self.silence_duration)
            has_speech = False

            while True:
                data = stream.read(self.chunk, exception_on_overflow=False)
                frames.append(data)

                if self.detect_silence(data):
                    silence_frames += 1
                    if has_speech and silence_frames > silence_frame_threshold:
                        break
                else:
                    silence_frames = 0
                    has_speech = True

                if len(frames) > self.rate / self.chunk * 30:
                    break

            stream.stop_stream()
            stream.close()

            if not has_speech:
                print("No speech detected.")
                return None

            print("Processing...")
            return b"".join(frames)

        except Exception as e:
            print(f"Error recording audio: {e}")
            return None

    def audio_to_text(self, audio_data: bytes) -> str | None:
        """Convert audio to text using OpenAI Whisper or return text directly."""
        if not AUDIO_CAPTURE_AVAILABLE or not self.openai_client:
            # If audio_data is actually text (from fallback input)
            try:
                return audio_data.decode()
            except UnicodeDecodeError:
                return None

        try:
            # Create WAV file in memory
            wav_buffer = io.BytesIO()
            with wave.open(wav_buffer, "wb") as wf:
                wf.setnchannels(self.channels)
                wf.setsampwidth(self.audio.get_sample_size(self.audio_format))
                wf.setframerate(self.rate)
                wf.writeframes(audio_data)

            wav_buffer.seek(0)
            wav_buffer.name = "audio.wav"

            # Transcribe using Whisper
            response = self.openai_client.audio.transcriptions.create(model="whisper-1", file=wav_buffer, language="en")

            return response.text.strip()

        except Exception as e:
            print(f"Error transcribing audio: {e}")
            return None

    async def text_to_speech(self, text: str) -> bool:
        """Convert text to speech using available methods."""
        # Try ElevenLabs MCP first
        if os.getenv("ELEVENLABS_API_KEY") and self.agent:
            try:
                # Get list of files before TTS generation
                temp_dir = tempfile.gettempdir()
                files_before = set(os.listdir(temp_dir))

                # Generate TTS with explicit temp directory path
                temp_audio_path = os.path.join(temp_dir, "voice_assistant_tts.mp3")
                tts_prompt = f"Generate speech audio saying: '{text}'. Save the audio file to: {temp_audio_path}"
                await self.agent.run(tts_prompt)

                # First check if the file was saved to our requested location
                if os.path.exists(temp_audio_path):
                    print(f"Playing audio file: {temp_audio_path}")
                    # Check if it's actually a directory (ElevenLabs creates a directory)
                    if os.path.isdir(temp_audio_path):
                        # Find the MP3 file inside the directory
                        mp3_files = [f for f in os.listdir(temp_audio_path) if f.endswith(".mp3")]
                        if mp3_files:
                            actual_audio_file = os.path.join(temp_audio_path, mp3_files[0])
                            print(f"Found MP3 file in directory: {actual_audio_file}")
                            self.play_audio(actual_audio_file)
                            # Clean up the directory and its contents
                            try:
                                import shutil

                                shutil.rmtree(temp_audio_path)
                            except OSError:
                                pass
                            return True
                    else:
                        # It's a regular file
                        self.play_audio(temp_audio_path)
                        try:
                            os.remove(temp_audio_path)
                        except OSError:
                            pass
                        return True

                # Fallback: Find new audio files created in temp directory
                files_after = set(os.listdir(temp_dir))
                new_files = files_after - files_before

                # Look for MP3 files that were just created
                audio_file = None
                for filename in new_files:
                    if filename.endswith(".mp3") and ("tts_" in filename.lower() or "audio" in filename.lower()):
                        audio_file = os.path.join(temp_dir, filename)
                        break

                # If we found an audio file in temp, play it
                if audio_file and os.path.exists(audio_file):
                    print(f"Playing audio file: {audio_file}")
                    self.play_audio(audio_file)
                    try:
                        os.remove(audio_file)
                    except OSError:
                        pass
                    return True

                # Final fallback: Check common locations like Desktop
                common_locations = [os.path.expanduser("~/Desktop"), os.path.expanduser("~/Downloads"), os.getcwd()]

                for location in common_locations:
                    if os.path.exists(location):
                        try:
                            location_files = os.listdir(location)
                            for filename in location_files:
                                if (
                                    filename.endswith(".mp3")
                                    and "tts_" in filename.lower()
                                    and filename not in files_before
                                ):
                                    audio_file = os.path.join(location, filename)
                                    # Check if file was created recently (within last 10 seconds)
                                    if os.path.getmtime(audio_file) > (datetime.now().timestamp() - 10):
                                        print(f"Found and playing audio file: {audio_file}")
                                        self.play_audio(audio_file)
                                        try:
                                            os.remove(audio_file)
                                        except OSError:
                                            pass
                                        return True
                        except OSError:
                            continue

                print("No audio file was generated by ElevenLabs TTS")

            except Exception as e:
                print(f"ElevenLabs TTS failed: {e}")

        # Fallback to system TTS
        if SYSTEM_TTS_AVAILABLE:
            try:
                TTS_ENGINE.say(text)
                TTS_ENGINE.runAndWait()
                return True
            except Exception:
                pass

        # Final fallback: just print
        return False

    def play_audio(self, audio_file: str):
        """Play audio file using pygame."""
        if not AUDIO_PLAYBACK_AVAILABLE:
            return

        try:
            pygame.mixer.music.load(audio_file)
            pygame.mixer.music.play()
            while pygame.mixer.music.get_busy():
                pygame.time.Clock().tick(10)
        except Exception as e:
            print(f"Error playing audio: {e}")

    async def process_command(self, text: str) -> str:
        """Process user command with MCP agent."""
        print(f"\nYou said: {text}")

        # Special commands
        if text.lower() in ["exit", "quit", "goodbye"]:
            return "Goodbye! Have a great day!"

        if text.lower() == "clear":
            if self.agent:
                self.agent.clear_conversation_history()
            return "Conversation history cleared."

        if text.lower() == "help":
            return (
                "I can help you with: "
                "1) Taking notes - say 'take a note' followed by your note, "
                "2) Reading notes - say 'list my notes' or 'read my notes', "
                "3) Managing Linear tasks - say 'create a Linear issue' or 'list my Linear tasks', "
                "4) General questions - just ask!"
            )

        # Process with MCP agent
        if not self.agent:
            return "Sorry, the assistant is not properly initialized."

        try:
            response = await self.agent.run(text)
            return response
        except Exception as e:
            return f"Sorry, I encountered an error: {str(e)}"

    async def run(self):
        """Main loop for the voice assistant."""
        print("\n===== Voice-First AI Assistant (Improved) =====")
        print("Audio capture: " + ("✓" if AUDIO_CAPTURE_AVAILABLE else "✗ (using text input)"))
        print("Audio playback: " + ("✓" if AUDIO_PLAYBACK_AVAILABLE else "✗"))
        print("System TTS: " + ("✓" if SYSTEM_TTS_AVAILABLE else "✗"))
        print("\nCommands: 'help', 'clear', 'exit'")
        print("===============================================\n")

        # Initialize MCP
        if not await self.initialize_mcp():
            print("Failed to initialize MCP. Exiting.")
            return

        try:
            while True:
                # Record audio or get text input
                audio_data = self.record_audio()
                if not audio_data:
                    continue

                # Convert to text
                text = self.audio_to_text(audio_data)
                if not text:
                    continue

                # Process command
                response = await self.process_command(text)
                print(f"\nAssistant: {response}")

                # Check for exit
                if text.lower() in ["exit", "quit", "goodbye"]:
                    break

                # Try to speak the response
                await self.text_to_speech(response)

        except KeyboardInterrupt:
            print("\n\nInterrupted by user.")
        finally:
            # Cleanup
            if self.audio:
                self.audio.terminate()
            if AUDIO_PLAYBACK_AVAILABLE:
                pygame.mixer.quit()
            if self.mcp_client and self.mcp_client.sessions:
                await self.mcp_client.close_all_sessions()


async def main():
    """Run the improved voice assistant."""
    # Check for at least one required API key
    if not os.getenv("OPENAI_API_KEY"):
        print("Error: OPENAI_API_KEY environment variable not set")
        print("This is required for the language model.")
        sys.exit(1)

    assistant = VoiceAssistant()
    await assistant.run()


if __name__ == "__main__":
    asyncio.run(main())
