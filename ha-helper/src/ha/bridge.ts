export interface ServiceCallInput {
  domain: string;
  service: string;
  target?: Record<string, unknown>;
  service_data?: Record<string, unknown>;
}

export interface HistoryQueryInput {
  start?: string;
  end?: string;
  entityId?: string;
}

export interface LogbookQueryInput {
  start?: string;
  end?: string;
  entityId?: string;
}

export interface StatisticsQueryInput {
  start?: string;
  end?: string;
  statisticIds?: string[];
  period?: "5minute" | "hour" | "day" | "month";
  units?: Record<string, unknown>;
}

export interface EventSubscriptionInput {
  eventType?: string;
  durationSeconds?: number;
  maxEvents?: number;
}

export interface EntityRegistryUpdateInput {
  entityId: string;
  changes: Record<string, unknown>;
}

export interface DeviceRegistryUpdateInput {
  deviceId: string;
  changes: Record<string, unknown>;
}

export interface HaBridge {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getConfig(): Promise<{ version?: string; [key: string]: unknown }>;
  getStates(): Promise<Array<Record<string, unknown>>>;
  getState(entityId: string): Promise<Record<string, unknown> | null>;
  listServices(): Promise<Record<string, unknown>>;
  callService(input: ServiceCallInput): Promise<Record<string, unknown>>;

  listAreas(): Promise<Array<Record<string, unknown>>>;
  listDevices(): Promise<Array<Record<string, unknown>>>;
  listEntityRegistry(): Promise<Array<Record<string, unknown>>>;
  listLabels(): Promise<Array<Record<string, unknown>>>;
  listFloors(): Promise<Array<Record<string, unknown>>>;

  updateEntityRegistry(input: EntityRegistryUpdateInput): Promise<Record<string, unknown>>;
  updateDeviceRegistry(input: DeviceRegistryUpdateInput): Promise<Record<string, unknown>>;

  queryHistory(input: HistoryQueryInput): Promise<unknown>;
  queryLogbook(input: LogbookQueryInput): Promise<unknown>;
  queryStatistics(input: StatisticsQueryInput): Promise<unknown>;

  subscribeEvents(input: EventSubscriptionInput): Promise<Array<Record<string, unknown>>>;

  sendRaw(message: Record<string, unknown>): Promise<unknown>;
}
