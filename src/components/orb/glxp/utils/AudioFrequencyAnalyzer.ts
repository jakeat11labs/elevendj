/**
 * AudioFrequencyAnalyzer - Analyzes audio frequency data into low/mid/high/all bands
 * Works with audio elements, AnalyserNode directly, or raw frequency data
 */

interface AudioContextWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

interface GuiData {
  lowAvg: number;
  midAvg: number;
  highAvg: number;
}

export interface RawDataConfig {
  sampleRate: number;
  fftSize: number;
}

class AudioFrequencyAnalyzer {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private bufferLength: number;
  private dataArray: Uint8Array;
  private track: MediaElementAudioSourceNode | null = null;
  private sampleRate: number;

  // Frequency range definitions (in Hz)
  private lowFreqEnd: number = 200;
  private midFreqStart: number = 200;
  private midFreqEnd: number = 2000;
  private highFreqStart: number = 2000;
  private highFreqEnd: number = 20000;

  // Public frequency averages
  public lowAvg: number = 0;
  public midAvg: number = 0;
  public highAvg: number = 0;
  public allAvg: number = 0;

  public guiData: GuiData = {
    lowAvg: 0,
    midAvg: 0,
    highAvg: 0,
  };

  /**
   * Create an AudioFrequencyAnalyzer
   * @param audioElementOrConfig - HTMLAudioElement for audio element mode, or RawDataConfig for raw data mode
   * @param audioAnalyzer - Optional AnalyserNode (only used in audio element mode)
   */
  constructor(
    audioElementOrConfig: HTMLAudioElement | RawDataConfig | null,
    audioAnalyzer: AnalyserNode | null = null,
  ) {
    // Check if we're in raw data mode
    if (audioElementOrConfig && "sampleRate" in audioElementOrConfig && "fftSize" in audioElementOrConfig) {
      this.sampleRate = audioElementOrConfig.sampleRate;
      this.bufferLength = audioElementOrConfig.fftSize / 2;
      this.dataArray = new Uint8Array(this.bufferLength);
      return;
    }

    const audioElement = audioElementOrConfig as HTMLAudioElement | null;
    const win = window as AudioContextWindow;

    if (audioAnalyzer) {
      this.audioCtx = audioAnalyzer.context as AudioContext;
      this.analyser = audioAnalyzer;
    } else {
      const AudioContextClass = window.AudioContext || win.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error("AudioContext is not supported in this browser");
      }
      this.audioCtx = new AudioContextClass();
      this.analyser = this.audioCtx.createAnalyser();
    }

    this.analyser.fftSize = 256;
    this.sampleRate = this.audioCtx.sampleRate;

    // Create an analyser node
    this.bufferLength = this.analyser.frequencyBinCount;
    this.dataArray = new Uint8Array(this.bufferLength);

    // Connect the audio element to the audio context
    // Use a split architecture: audio goes directly to destination for quality,
    // while a separate branch feeds the analyser (doesn't affect output)
    if (audioAnalyzer === null && audioElement) {
      this.track = this.audioCtx.createMediaElementSource(audioElement);

      // Direct connection to destination (preserves audio quality)
      this.track.connect(this.audioCtx.destination);

      // Separate branch for analysis only (doesn't affect output)
      this.track.connect(this.analyser);
    }

    // Start analyzing when the audio plays
    if (audioElement) {
      audioElement.onplay = () => {
        this.audioCtx?.resume().then(() => {
          this.update();
        });
      };
    }
  }

  /**
   * Get frequency range start and end indices
   */
  private getFrequencyRange(startFreq: number, endFreq: number): [number, number] {
    const startIndex = Math.round((startFreq / (this.sampleRate / 2)) * this.bufferLength);
    const endIndex = Math.round((endFreq / (this.sampleRate / 2)) * this.bufferLength);
    return [startIndex, endIndex];
  }

  /**
   * Calculate the average frequency in a given range
   */
  private getAverageFrequencyRange(startIndex: number, endIndex: number): number {
    let total = 0;
    let count = 0;

    for (let i = startIndex; i <= endIndex; i++) {
      total += this.dataArray[i];
      count++;
    }

    return count > 0 ? total / count : 0;
  }

  /**
   * Main analysis function (real-time analysis)
   * @param rawData - Optional raw frequency data (Uint8Array) for raw data mode
   */
  update(rawData?: Uint8Array<ArrayBuffer>): void {
    if (rawData) {
      // Raw data mode: copy the provided data into our buffer
      this.dataArray.set(rawData.subarray(0, this.bufferLength));
    } else if (this.analyser) {
      // Standard mode: get frequency data from analyser
      // @ts-expect-error TS Type issue with Uint8Array and Uint8ArrayLike
      this.analyser.getByteFrequencyData(this.dataArray);
    }

    // Get the frequency ranges
    const [lowStart, lowEnd] = this.getFrequencyRange(0, this.lowFreqEnd);
    const [midStart, midEnd] = this.getFrequencyRange(this.midFreqStart, this.midFreqEnd);
    const [highStart, highEnd] = this.getFrequencyRange(this.highFreqStart, this.highFreqEnd);

    // Calculate the average frequency values for each range
    this.lowAvg = this.getAverageFrequencyRange(lowStart, lowEnd);
    this.midAvg = this.getAverageFrequencyRange(midStart, midEnd);
    this.highAvg = this.getAverageFrequencyRange(highStart, highEnd);
    this.allAvg = this.getAverageFrequencyRange(0, this.bufferLength - 1);

    // Update guiData
    this.guiData.lowAvg = this.lowAvg;
    this.guiData.midAvg = this.midAvg;
    this.guiData.highAvg = this.highAvg;
  }
}

export default AudioFrequencyAnalyzer;
