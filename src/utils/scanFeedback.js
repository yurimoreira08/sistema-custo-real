// Feedback tátil + sonoro para leitura de código de barras. Best-effort:
// qualquer erro de áudio/haptics é engolido para não travar o scan.
import * as Haptics from 'expo-haptics';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

let successPlayer = null;
let errorPlayer = null;
let audioModeSet = false;

async function ensureAudioMode() {
  if (audioModeSet) return;
  audioModeSet = true;
  try {
    await setAudioModeAsync({ playsInSilentMode: true });
  } catch (e) {}
}

function getSuccessPlayer() {
  if (!successPlayer) {
    successPlayer = createAudioPlayer(require('../../assets/sounds/beep-success.wav'));
  }
  return successPlayer;
}

function getErrorPlayer() {
  if (!errorPlayer) {
    errorPlayer = createAudioPlayer(require('../../assets/sounds/beep-error.wav'));
  }
  return errorPlayer;
}

async function playBeep(getPlayer) {
  try {
    await ensureAudioMode();
    const player = getPlayer();
    await player.seekTo(0);
    player.play();
  } catch (e) {}
}

export async function feedbackRead() {
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch (e) {}
}

export async function feedbackFound() {
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch (e) {}
  await playBeep(getSuccessPlayer);
}

export async function feedbackNotFound() {
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  } catch (e) {}
  await playBeep(getErrorPlayer);
}
