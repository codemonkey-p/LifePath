(function (global) {
  const SILENCE_THRESHOLD = 0.02;
  const SILENCE_DURATION_MS = 1300;
  const MAX_RECORD_MS = 20000;

  function base64ToBlob(base64, mimeType) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
  }

  function playAudioBase64(base64, mimeType, onEnded) {
    const audio = new Audio(URL.createObjectURL(base64ToBlob(base64, mimeType || 'audio/mpeg')));
    audio.onended = () => onEnded && onEnded();
    audio.play();
    return audio;
  }

  async function recordUntilSilence({ onListeningStart, onError } = {}) {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
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
      return null;
    }

    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);

    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    return new Promise((resolve) => {
      let hasSpoken = false;
      let silenceStart = null;
      const startTime = Date.now();

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        audioContext.close();
        resolve(new Blob(chunks, { type: 'audio/webm' }));
      };

      recorder.start();
      onListeningStart && onListeningStart();

      function tick() {
        analyser.getByteTimeDomainData(data);
        let sumSquares = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sumSquares += v * v;
        }
        const rms = Math.sqrt(sumSquares / data.length);

        if (rms > SILENCE_THRESHOLD) {
          hasSpoken = true;
          silenceStart = null;
        } else if (hasSpoken) {
          if (!silenceStart) silenceStart = Date.now();
          if (Date.now() - silenceStart > SILENCE_DURATION_MS) {
            recorder.stop();
            return;
          }
        }

        if (Date.now() - startTime > MAX_RECORD_MS) {
          recorder.stop();
          return;
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  global.VoiceClient = { recordUntilSilence, playAudioBase64 };
})(window);
