export type PreviewDevicePresetId = 'desktop' | 'tablet' | 'mobile';

export interface PreviewDevicePreset {
  readonly id: PreviewDevicePresetId;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly description: string;
  readonly iconName: 'Monitor' | 'Tablet' | 'Smartphone';
}

export const PREVIEW_DEVICE_PRESETS: Record<PreviewDevicePresetId, PreviewDevicePreset> = {
  desktop: {
    id: 'desktop',
    label: 'Desktop',
    width: 1440,
    height: 900,
    description: 'Desktop 1440 × 900',
    iconName: 'Monitor'
  },
  tablet: {
    id: 'tablet',
    label: 'Tablet',
    width: 768,
    height: 1024,
    description: 'Tablet 768 × 1024',
    iconName: 'Tablet'
  },
  mobile: {
    id: 'mobile',
    label: 'Mobile',
    width: 390,
    height: 844,
    description: 'Mobile 390 × 844',
    iconName: 'Smartphone'
  }
};
