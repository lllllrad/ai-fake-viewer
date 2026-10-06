export interface ReadinessCheck {
  id: string;
  label: string;
  ready: boolean;
  optional?: boolean;
}

export interface BroadcastReadiness {
  ready: boolean;
  checks: ReadinessCheck[];
}
