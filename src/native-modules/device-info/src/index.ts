import { requireNativeModule } from 'expo-modules-core';

const DeviceInfoModule = requireNativeModule('DeviceInfo');

/**
 * Whether the app is running on an Onyx Boox device.
 * Synchronous constant — available immediately, no async needed.
 */
export const isBooxDevice: boolean = DeviceInfoModule.isBooxDevice;
