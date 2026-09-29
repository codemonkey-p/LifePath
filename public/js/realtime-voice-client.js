(function (global) {
  const SAMPLE_RATE = 24000;

  function floatTo16BitPCM(float32Array) {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
  }

  function bufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function base64ToInt16Array(base64) {
    const binary = atob(base64);
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Int16Array(buffer);
  }

  function connectRealtimeVoice({ path, onStatus, onAssistantTextDelta, onProfileUpdated, onConversationEnded, onError }) {
    const state = {
      ws: null,
      audioContext: null,
      micStream: null,
      processor: null,
      source: null,
      playbackQueueTime: 0,
      activeSources: [],
      paused: false,
      closed: false
    };

    function emit(status) {
      if (!onStatus) return;
      if (state.paused && status !== 'paused' && status !== 'disconnected') return;
      onStatus(status);
    }

    async function start() {
      try {
        state.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
        state.playbackQueueTime = state.audioContext.currentTime;
        state.micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
      } catch (err) {
        console.log(`[voice] getUserMedia failed: ${err.name} - ${err.message}`);
        const reasons = {
          NotAllowedError: 'Microphone access was blocked. Please allow the microphone for this app.',
          NotFoundError: "No microphone was found. Please plug one in or check your computer's sound settings.",
          NotReadableError: 'The microphone is being used by another app. Please close it and try again.'
        };
        onError && onError(reasons[err.name] || `Microphone problem (${err.name}). Please check your settings.`);
        return;
      }

      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      state.ws = new WebSocket(`${protocol}//${location.host}${path}`);

      state.ws.onopen = () => {
        emit('connected');
        state.source = state.audioContext.createMediaStreamSource(state.micStream);
        state.processor = state.audioContext.createScriptProcessor(2048, 1, 1);
        state.processor.onaudioprocess = (event) => {
          if (state.closed || state.paused || state.ws.readyState !== WebSocket.OPEN) return;
          const input = event.inputBuffer.getChannelData(0);
          const pcm = floatTo16BitPCM(input);
          state.ws.send(JSON.stringify({ type: 'audio_in', audio: bufferToBase64(pcm) }));
        };
        state.source.connect(state.processor);
        state.processor.connect(state.audioContext.destination);
        emit('listening');
      };

      state.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'audio_out') {
          if (state.paused) return;
          playChunk(msg.audio);
          emit('speaking');
        } else if (msg.type === 'assistant_transcript_delta') {
          onAssistantTextDelta && onAssistantTextDelta(msg.text);
        } else if (msg.type === 'profile_updated') {
          onProfileUpdated && onProfileUpdated(msg);
        } else if (msg.type === 'interrupt') {
          interruptPlayback();
          emit('listening');
        } else if (msg.type === 'thinking') {
          emit('thinking');
        } else if (msg.type === 'conversation_ended') {
          // The goodbye is still playing from the audio queue - let it finish before closing.
          const remainingMs = Math.max(0, (state.playbackQueueTime - state.audioContext.currentTime) * 1000);
          setTimeout(() => {
            if (!state.closed && onConversationEnded) onConversationEnded();
          }, remainingMs + 700);
        } else if (msg.type === 'error') {
          onError && onError(msg.message);
        }
      };

      state.ws.onerror = () => onError && onError('Connection to the voice service failed.');
      state.ws.onclose = () => emit('disconnected');
    }

    function sendControl(type) {
      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({ type }));
      }
    }

    function pause() {
      if (state.paused || state.closed) return;
      state.paused = true;
      if (state.micStream) state.micStream.getAudioTracks().forEach((t) => { t.enabled = false; });
      interruptPlayback();
      sendControl('pause');
      emit('paused');
    }

    function resume() {
      if (!state.paused || state.closed) return;
      state.paused = false;
      if (state.micStream) state.micStream.getAudioTracks().forEach((t) => { t.enabled = true; });
      sendControl('resume');
      emit('listening');
    }

    function playChunk(base64Audio) {
      const int16 = base64ToInt16Array(base64Audio);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 0x8000;

      const audioBuffer = state.audioContext.createBuffer(1, float32.length, SAMPLE_RATE);
      audioBuffer.copyToChannel(float32, 0);

      const source = state.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(state.audioContext.destination);

      const now = state.audioContext.currentTime;
      const startAt = Math.max(now, state.playbackQueueTime);
      source.start(startAt);
      state.playbackQueueTime = startAt + audioBuffer.duration;
      state.activeSources.push(source);
      source.onended = () => {
        state.activeSources = state.activeSources.filter((s) => s !== source);
        if (state.playbackQueueTime <= state.audioContext.currentTime + 0.05) {
          emit('listening');
        }
      };
    }

    function interruptPlayback() {
      state.activeSources.forEach((source) => {
        try { source.onended = null; source.stop(0); } catch (err) {}
      });
      state.activeSources = [];
      state.playbackQueueTime = state.audioContext ? state.audioContext.currentTime : 0;
    }

    function stop() {
      state.closed = true;
      if (state.processor) state.processor.disconnect();
      if (state.source) state.source.disconnect();
      if (state.micStream) state.micStream.getTracks().forEach((t) => t.stop());
      if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.close();
      if (state.audioContext) state.audioContext.close();
    }

    start();
    return { stop, pause, resume, isPaused: () => state.paused };
  }

  global.RealtimeVoice = { connect: connectRealtimeVoice };
})(window);
