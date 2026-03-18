package expo.modules.inkrecognition

import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.vision.digitalink.DigitalInkRecognition
import com.google.mlkit.vision.digitalink.DigitalInkRecognitionModel
import com.google.mlkit.vision.digitalink.DigitalInkRecognitionModelIdentifier
import com.google.mlkit.vision.digitalink.DigitalInkRecognizerOptions
import com.google.mlkit.vision.digitalink.Ink
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Thin Expo module wrapping ML Kit Digital Ink Recognition.
 *
 * Exposes four functions to JS:
 * - downloadModel(languageTag) — downloads the recognition model for a language
 * - isModelDownloaded(languageTag) — checks if a model is available locally
 * - deleteModel(languageTag) — removes a downloaded model
 * - recognize(strokes, languageTag) — runs recognition, returns top candidate text
 *
 * Strokes are passed as List<List<List<Double>>> — array of strokes,
 * each stroke is an array of points, each point is [x, y, t].
 */
class InkRecognitionModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("InkRecognition")

        AsyncFunction("downloadModel") { languageTag: String, promise: Promise ->
            val model = buildModel(languageTag)
            if (model == null) {
                promise.reject("ERR_UNKNOWN_LANGUAGE", "No model found for language tag: $languageTag", null)
                return@AsyncFunction
            }

            RemoteModelManager.getInstance()
                .download(model, DownloadConditions.Builder().build())
                .addOnSuccessListener { promise.resolve(null) }
                .addOnFailureListener { e ->
                    promise.reject("ERR_DOWNLOAD_FAILED", "Model download failed: ${e.message}", e)
                }
        }

        AsyncFunction("isModelDownloaded") { languageTag: String, promise: Promise ->
            val model = buildModel(languageTag)
            if (model == null) {
                promise.resolve(false)
                return@AsyncFunction
            }

            RemoteModelManager.getInstance()
                .isModelDownloaded(model)
                .addOnSuccessListener { isDownloaded -> promise.resolve(isDownloaded) }
                .addOnFailureListener { e ->
                    promise.reject("ERR_CHECK_FAILED", "Failed to check model status: ${e.message}", e)
                }
        }

        AsyncFunction("deleteModel") { languageTag: String, promise: Promise ->
            val model = buildModel(languageTag)
            if (model == null) {
                promise.reject("ERR_UNKNOWN_LANGUAGE", "No model found for language tag: $languageTag", null)
                return@AsyncFunction
            }

            RemoteModelManager.getInstance()
                .deleteDownloadedModel(model)
                .addOnSuccessListener { promise.resolve(null) }
                .addOnFailureListener { e ->
                    promise.reject("ERR_DELETE_FAILED", "Model deletion failed: ${e.message}", e)
                }
        }

        AsyncFunction("recognize") { strokes: List<List<List<Double>>>, languageTag: String, promise: Promise ->
            val modelIdentifier = try {
                DigitalInkRecognitionModelIdentifier.fromLanguageTag(languageTag)
            } catch (e: Exception) {
                promise.reject("ERR_UNKNOWN_LANGUAGE", "Invalid language tag: $languageTag", e)
                return@AsyncFunction
            }

            if (modelIdentifier == null) {
                promise.reject("ERR_UNKNOWN_LANGUAGE", "No model found for language tag: $languageTag", null)
                return@AsyncFunction
            }

            // Build the Ink object from stroke data
            val inkBuilder = Ink.builder()
            for (stroke in strokes) {
                val strokeBuilder = Ink.Stroke.builder()
                for (point in stroke) {
                    if (point.size >= 3) {
                        strokeBuilder.addPoint(
                            Ink.Point.create(
                                point[0].toFloat(), // x
                                point[1].toFloat(), // y
                                point[2].toLong()   // t (milliseconds)
                            )
                        )
                    }
                }
                inkBuilder.addStroke(strokeBuilder.build())
            }
            val ink = inkBuilder.build()

            // Build recognizer and run recognition
            val model = DigitalInkRecognitionModel.builder(modelIdentifier).build()
            val recognizer = DigitalInkRecognition.getClient(
                DigitalInkRecognizerOptions.builder(model).build()
            )

            recognizer.recognize(ink)
                .addOnSuccessListener { result ->
                    val text = result.candidates.firstOrNull()?.text ?: ""
                    recognizer.close()
                    promise.resolve(text)
                }
                .addOnFailureListener { e ->
                    recognizer.close()
                    promise.reject("ERR_RECOGNITION_FAILED", "Recognition failed: ${e.message}", e)
                }
        }
    }

    /**
     * Build a DigitalInkRecognitionModel from a BCP-47 language tag.
     * Returns null if the language tag is not recognized.
     */
    private fun buildModel(languageTag: String): DigitalInkRecognitionModel? {
        val identifier = try {
            DigitalInkRecognitionModelIdentifier.fromLanguageTag(languageTag)
        } catch (e: Exception) {
            null
        }
        return identifier?.let {
            DigitalInkRecognitionModel.builder(it).build()
        }
    }
}
