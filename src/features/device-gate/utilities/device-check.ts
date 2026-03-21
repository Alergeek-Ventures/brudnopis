import { Platform } from 'react-native';

/**
 * Platform.constants on Android includes Manufacturer, Brand, Model etc.
 * These aren't in the RN type definitions but are present at runtime.
 *
 * Verified on Boox Note Air 4C:
 *   manufacturer = "QUALCOMM" (chipset vendor, not device maker)
 *   brand = "Onyx"
 *   model = "NoteAir4C"
 */
const constants = Platform.constants as Record<string, unknown>;

const brand = String(constants.Brand ?? '').toLowerCase();

/**
 * Whether the app is running on an Onyx Boox device.
 * Boox devices report Brand "Onyx". Manufacturer is "QUALCOMM" (chipset),
 * so we rely on brand for detection.
 */
export const isBooxDevice: boolean = brand === 'onyx';
