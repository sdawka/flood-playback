export type ScenarioStatus = 'synthetic' | 'observed' | 'simulated' | 'forecast';

export interface ScenarioTimestamp {
  time: string;
  frame: string;
  exact: true;
}

export interface RegionManifest {
  id: string;
  label: string;
  bounds: [number, number, number, number];
  minZoom: number;
  maxZoom: number;
  depthTiles: string;
  displayTiles: string;
  terrainTiles?: string;
}

export interface ScenarioManifest {
  schemaVersion: 1;
  id: string;
  version: string;
  title: string;
  status: ScenarioStatus;
  disclosure: string;
  attribution: string[];
  depth: {
    unit: 'm';
    scale: number;
    noData: number;
    wetThreshold: number;
  };
  timestamps: ScenarioTimestamp[];
  regions: RegionManifest[];
  gaps: Array<{ start: string; end: string }>;
}
