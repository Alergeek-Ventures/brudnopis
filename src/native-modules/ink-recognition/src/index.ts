import { requireNativeModule } from 'expo-modules-core';

type InkRecognitionModule = {
  /**
   * Download the recognition model for a BCP-47 language tag (e.g. "en-US", "pl-PL").
   * Downloads from Google's servers. Requires internet connection.
   */
  downloadModel(languageTag: string): Promise<void>;

  /**
   * Check if a model for the given language tag is downloaded and ready to use.
   */
  isModelDownloaded(languageTag: string): Promise<boolean>;

  /**
   * Delete a previously downloaded model to free storage.
   */
  deleteModel(languageTag: string): Promise<void>;

  /**
   * Run handwriting recognition on stroke data.
   *
   * @param strokes - Array of strokes. Each stroke is an array of points [x, y, t].
   *   x, y are coordinates in pixels. t is timestamp in milliseconds.
   * @param languageTag - BCP-47 language tag for the model to use.
   * @returns The top recognition candidate text, or empty string if nothing recognized.
   */
  recognize(strokes: [number, number, number][][], languageTag: string): Promise<string>;
};

export default requireNativeModule<InkRecognitionModule>('InkRecognition');
