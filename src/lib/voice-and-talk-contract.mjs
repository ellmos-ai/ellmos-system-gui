// SPDX-License-Identifier: MIT
/**
 * Multimodal Voice-IO, ELLMOS Talk Visualizer & Capability Permissions GUI Contracts
 * Covers BACH #3763-#3768 / Ocean #533-#538.
 */

export const VOICE_MIC_CONTRACT_SCHEMA = "ellmos.gui.voice-mic-widget.v1";
export const TALK_VISUALIZER_CONTRACT_SCHEMA = "ellmos.gui.talk-visualizer.v1";
export const PERMISSIONS_MATRIX_CONTRACT_SCHEMA = "ellmos.gui.permissions-matrix.v1";

export const EMOTION_PALETTES = Object.freeze({
  calm: { primary: "#38bdf8", secondary: "#1e293b", glow: "#0284c7" },
  curious: { primary: "#a855f7", secondary: "#2e1065", glow: "#7e22ce" },
  joyful: { primary: "#facc15", secondary: "#422006", glow: "#eab308" },
  focused: { primary: "#10b981", secondary: "#064e3b", glow: "#059669" },
  empathetic: { primary: "#f472b6", secondary: "#500724", glow: "#db2777" },
  alert: { primary: "#ef4444", secondary: "#450a0a", glow: "#dc2626" },
});

export const VALID_PATTERNS = Object.freeze([
  "orb",
  "wave",
  "rings",
  "constellation",
  "pulse",
]);

export const VALID_PERSONAS = Object.freeze([
  "buddha",
  "gemini",
  "claude",
  "codex",
]);

export const CAPABILITY_PERMISSION_DEFINITIONS = Object.freeze([
  { id: "system_tools", label: "System-Tools (Shell & Skripte)", defaultEnabled: true },
  { id: "browser_control", label: "Browser-Steuerung", defaultEnabled: true },
  { id: "camera", label: "Kamera (ellmos-sensation Präsenz)", defaultEnabled: false },
  { id: "microphone", label: "Mikrofon (Wake-Word & Ambiente)", defaultEnabled: false },
  { id: "screen_capture", label: "Bildschirmaufnahme (Open-Compute)", defaultEnabled: false },
  { id: "voice_tts", label: "Sprachausgabe (Voice TTS / Talk)", defaultEnabled: true },
  { id: "speech_to_text", label: "Spracheingabe (Diktat / STT)", defaultEnabled: true },
  { id: "smarthome_robotics", label: "SmartHome & Robotik-Steuerung", defaultEnabled: false },
  { id: "ollama", label: "Lokale Ollama-Modelle", defaultEnabled: true },
]);

export function buildTalkVisualizerViewModel(directive = {}) {
  const emotion = Object.prototype.hasOwnProperty.call(EMOTION_PALETTES, directive.emotion)
    ? directive.emotion
    : "calm";
  const pattern = VALID_PATTERNS.includes(directive.pattern) ? directive.pattern : "orb";
  const persona = VALID_PERSONAS.includes(directive.persona) ? directive.persona : "buddha";
  const language = directive.language === "en" ? "en" : "de";
  const pulseHz = typeof directive.pulse_hz === "number"
    ? Math.min(Math.max(directive.pulse_hz, 0.2), 5.0)
    : 1.2;

  return {
    schema: TALK_VISUALIZER_CONTRACT_SCHEMA,
    persona,
    language,
    emotion,
    pattern,
    palette: EMOTION_PALETTES[emotion],
    emoji: typeof directive.emoji === "string" && directive.emoji.trim() ? directive.emoji.trim() : "✨",
    pulse_hz: pulseHz,
    wake_word_enabled: Boolean(directive.wake_word_enabled ?? true),
    companion_route: "/talk",
  };
}

export function buildPermissionsMatrixViewModel(overrides = {}) {
  const items = CAPABILITY_PERMISSION_DEFINITIONS.map((def) => ({
    id: def.id,
    label: def.label,
    enabled: Object.prototype.hasOwnProperty.call(overrides, def.id)
      ? Boolean(overrides[def.id])
      : def.defaultEnabled,
  }));
  return {
    schema: PERMISSIONS_MATRIX_CONTRACT_SCHEMA,
    welcome_card: {
      title: "Willkommen bei BACH & Open-Ocean",
      capabilities_summary: [
        "Lass Agenten sicher auf diesem PC helfen (Berechtigungen jederzeit einzeln steuerbar)",
        "Behalte dein lokales Gateway & deine Modelle unter deiner Kontrolle",
        "Sprich live mit deiner KI über ELLMOS Talk & universelle Spracheingabe",
      ],
      safety_notice: {
        headline: "Bevor du startest: Risiken & Sicherheit",
        body: "KI-Agenten sind mächtig. Kamera, Mikrofon, Bildschirmaufnahme sowie SmartHome/Robotik sind standardmäßig deaktiviert (Fail-Closed) und erfordern deine explizite Freigabe.",
        requires_acknowledgement: true,
      },
    },
    items,
  };
}

export const UNIVERSAL_VOICE_MIC_SELECTOR =
  "textarea:not([data-no-voice-mic]), input[data-chat-input], #chat-input, #utteranceInput, #header-talk-quick-input, #tasks-search, .task-create-dialog input[name='title'], #notes-search-input, #note-title-input, #note-tag-input, #prompt-library input[data-part='search'], #prompt-library input[name='name'], .chat-input, .prompt-input";

export function describeVoiceMicBinding(targetSelector = UNIVERSAL_VOICE_MIC_SELECTOR) {
  return {
    schema: VOICE_MIC_CONTRACT_SCHEMA,
    selector: targetSelector,
    stt_endpoint: "/api/voice/stt",
    tts_endpoint: "/api/voice/tts",
    status_endpoint: "/api/voice/status",
    reflex_endpoint: "/api/talk/reflex",
    turn_endpoint: "/api/talk/turn",
    talk_companion_url: "/talk",
  };
}
