package expo.modules.deviceinfo

import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class DeviceInfoModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("DeviceInfo")

        Constants(
            "isBooxDevice" to (Build.MANUFACTURER.lowercase() == "onyx")
        )
    }
}
