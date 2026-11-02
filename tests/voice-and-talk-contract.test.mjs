import test from "node:test";
import assert from "node:assert/strict";
import {
  VOICE_MIC_CONTRACT_SCHEMA,
  TALK_VISUALIZER_CONTRACT_SCHEMA,
  PERMISSIONS_MATRIX_CONTRACT_SCHEMA,
  buildTalkVisualizerViewModel,
  buildPermissionsMatrixViewModel,
  describeVoiceMicBinding,
} from "../src/lib/voice-and-talk-contract.mjs";

test("buildTalkVisualizerViewModel maps emotions, patterns and personas deterministically", () => {
  const vm = buildTalkVisualizerViewModel({
    emotion: "curious",
    pattern: "constellation",
    persona: "gemini",
    language: "en",
    emoji: "🔮",
    pulse_hz: 2.4,
  });
  assert.equal(vm.schema, TALK_VISUALIZER_CONTRACT_SCHEMA);
  assert.equal(vm.persona, "gemini");
  assert.equal(vm.language, "en");
  assert.equal(vm.pattern, "constellation");
  assert.equal(vm.palette.primary, "#a855f7");
  assert.equal(vm.emoji, "🔮");
  assert.equal(vm.companion_route, "/talk");

  const fallback = buildTalkVisualizerViewModel({ emotion: "unknown", pattern: "invalid" });
  assert.equal(fallback.emotion, "calm");
  assert.equal(fallback.pattern, "orb");
});

test("buildPermissionsMatrixViewModel enforces fail-closed defaults for camera, mic, screen and robotics", () => {
  const matrix = buildPermissionsMatrixViewModel();
  assert.equal(matrix.schema, PERMISSIONS_MATRIX_CONTRACT_SCHEMA);
  assert.equal(matrix.welcome_card.safety_notice.requires_acknowledgement, true);
  const byId = Object.fromEntries(matrix.items.map((i) => [i.id, i.enabled]));
  assert.equal(byId.camera, false);
  assert.equal(byId.microphone, false);
  assert.equal(byId.screen_capture, false);
  assert.equal(byId.smarthome_robotics, false);
  assert.equal(byId.speech_to_text, true);
  assert.equal(byId.voice_tts, true);
});

test("describeVoiceMicBinding exposes canonical endpoints for universal chat transcription", () => {
  const binding = describeVoiceMicBinding();
  assert.equal(binding.schema, VOICE_MIC_CONTRACT_SCHEMA);
  assert.equal(binding.stt_endpoint, "/api/voice/stt");
  assert.equal(binding.tts_endpoint, "/api/voice/tts");
  assert.equal(binding.talk_companion_url, "/talk");
});
