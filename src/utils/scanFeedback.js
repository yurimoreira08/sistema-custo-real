import * as Haptics from 'expo-haptics';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

let successPlayer = null;
let errorPlayer = null;
let audioModeSet = false;

// Garante que o modo de áudio do dispositivo permite tocar sons mesmo se estiver silenciado
async function ensureAudioMode() {
  if (audioModeSet) return;
  audioModeSet = true;
  try {
    await setAudioModeAsync({ playsInSilentMode: true });
  } catch (e) {}
}

// Inicializa ou retorna o tocador de áudio para bip de sucesso
function getSuccessPlayer() {
  if (!successPlayer) {
    successPlayer = createAudioPlayer(require('../../assets/sounds/beep-success.wav'));
  }
  return successPlayer;
}

// Inicializa ou retorna o tocador de áudio para bip de erro
function getErrorPlayer() {
  if (!errorPlayer) {
    errorPlayer = createAudioPlayer(require('../../assets/sounds/beep-error.wav'));
  }
  return errorPlayer;
}

// Executa o play do som de bip correspondente do início
async function playBeep(getPlayer) {
  try {
    await ensureAudioMode();
    const player = getPlayer();
    await player.seekTo(0);
    player.play();
  } catch (e) {}
}

// Aciona uma vibração leve de feedback de leitura realizada
export async function feedbackRead() {
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch (e) {}
}

// Aciona uma vibração de sucesso e toca o áudio de bip de sucesso
export async function feedbackFound() {
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch (e) {}
  await playBeep(getSuccessPlayer);
}

// Aciona uma vibração de erro e toca o áudio de bip de erro
export async function feedbackNotFound() {
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  } catch (e) {}
  await playBeep(getErrorPlayer);
}
