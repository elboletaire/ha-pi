import {
  createConnection,
  createLongLivedTokenAuth,
  type Connection,
} from "home-assistant-js-websocket";
import type {
  DeviceRegistryUpdateInput,
  EntityRegistryUpdateInput,
  EventSubscriptionInput,
  HaBridge,
  HistoryQueryInput,
  LogbookQueryInput,
  ServiceCallInput,
  StatisticsQueryInput,
} from "./bridge";
import { HelperCliError } from "../lib/errors";

export interface HaWsClientOptions {
  url: string;
  token: string;
}

export class HaWsClient implements HaBridge {
  private readonly options: HaWsClientOptions;
  private readonly apiBaseUrl: string;
  private connection: Connection | null = null;

  constructor(options: HaWsClientOptions) {
    this.options = options;
    this.apiBaseUrl = options.url.replace(/\/$/, "");
  }

  public async connect(): Promise<void> {
    if (this.connection) {
      return;
    }

    try {
      const auth = await createLongLivedTokenAuth(this.options.url, this.options.token);
      this.connection = await createConnection({ auth });
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  public async disconnect(): Promise<void> {
    if (this.connection) {
      this.connection.close();
      this.connection = null;
    }
  }

  public async getConfig(): Promise<{ version?: string; [key: string]: unknown }> {
    return this.send<{ version?: string; [key: string]: unknown }>({ type: "get_config" });
  }

  public async getStates(): Promise<Array<Record<string, unknown>>> {
    return this.send<Array<Record<string, unknown>>>({ type: "get_states" });
  }

  public async getState(entityId: string): Promise<Record<string, unknown> | null> {
    const states = await this.getStates();
    return states.find((state) => state.entity_id === entityId) ?? null;
  }

  public async listServices(): Promise<Record<string, unknown>> {
    return this.send<Record<string, unknown>>({ type: "get_services" });
  }

  public async callService(input: ServiceCallInput): Promise<Record<string, unknown>> {
    const payload: Record<string, unknown> = {
      type: "call_service",
      domain: input.domain,
      service: input.service,
      service_data: input.service_data ?? {},
    };

    if (input.target) {
      payload.target = input.target;
    }

    return this.send<Record<string, unknown>>(payload);
  }

  public async listAreas(): Promise<Array<Record<string, unknown>>> {
    return this.send<Array<Record<string, unknown>>>({
      type: "config/area_registry/list",
    });
  }

  public async listDevices(): Promise<Array<Record<string, unknown>>> {
    return this.send<Array<Record<string, unknown>>>({
      type: "config/device_registry/list",
    });
  }

  public async listEntityRegistry(): Promise<Array<Record<string, unknown>>> {
    return this.send<Array<Record<string, unknown>>>({
      type: "config/entity_registry/list",
    });
  }

  public async listLabels(): Promise<Array<Record<string, unknown>>> {
    return this.send<Array<Record<string, unknown>>>({
      type: "config/label_registry/list",
    });
  }

  public async listFloors(): Promise<Array<Record<string, unknown>>> {
    return this.send<Array<Record<string, unknown>>>({
      type: "config/floor_registry/list",
    });
  }

  public async updateEntityRegistry(
    input: EntityRegistryUpdateInput,
  ): Promise<Record<string, unknown>> {
    return this.send<Record<string, unknown>>({
      type: "config/entity_registry/update",
      entity_id: input.entityId,
      ...input.changes,
    });
  }

  public async updateDeviceRegistry(
    input: DeviceRegistryUpdateInput,
  ): Promise<Record<string, unknown>> {
    return this.send<Record<string, unknown>>({
      type: "config/device_registry/update",
      device_id: input.deviceId,
      ...input.changes,
    });
  }

  public async queryHistory(input: HistoryQueryInput): Promise<unknown> {
    const start = input.start ?? this.defaultStartIso(24);
    const params = new URLSearchParams();

    if (input.end) {
      params.set("end_time", input.end);
    }

    if (input.entityId) {
      params.set("filter_entity_id", input.entityId);
    }

    return this.restGet(`/api/history/period/${encodeURIComponent(start)}`, params);
  }

  public async queryLogbook(input: LogbookQueryInput): Promise<unknown> {
    const start = input.start ?? this.defaultStartIso(24);
    const params = new URLSearchParams();

    if (input.end) {
      params.set("end_time", input.end);
    }

    if (input.entityId) {
      params.set("entity", input.entityId);
    }

    return this.restGet(`/api/logbook/${encodeURIComponent(start)}`, params);
  }

  public async queryStatistics(input: StatisticsQueryInput): Promise<unknown> {
    const payload: Record<string, unknown> = {
      type: "recorder/statistics_during_period",
      start_time: input.start ?? this.defaultStartIso(24),
      period: input.period ?? "hour",
    };

    if (input.end) {
      payload.end_time = input.end;
    }

    if (input.statisticIds && input.statisticIds.length > 0) {
      payload.statistic_ids = input.statisticIds;
    }

    if (input.units) {
      payload.units = input.units;
    }

    return this.send<unknown>(payload);
  }

  public async subscribeEvents(input: EventSubscriptionInput): Promise<Array<Record<string, unknown>>> {
    await this.connect();

    if (!this.connection) {
      throw new HelperCliError("INTERNAL_ERROR", "Home Assistant connection not initialized");
    }

    const durationSeconds = input.durationSeconds ?? 15;
    const maxEvents = input.maxEvents;
    const events: Array<Record<string, unknown>> = [];

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let resolveDone: (() => void) | null = null;

    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
      timeoutHandle = setTimeout(resolve, durationSeconds * 1000);
    });

    let unsubscribe: (() => void | Promise<void>) | null = null;

    try {
      unsubscribe = await this.connection.subscribeEvents(
        (event: unknown) => {
          events.push(event as Record<string, unknown>);
          if (maxEvents && events.length >= maxEvents && resolveDone) {
            resolveDone();
          }
        },
        input.eventType,
      );

      await done;
    } catch (error) {
      throw this.normalizeError(error);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      if (unsubscribe) {
        await Promise.resolve(unsubscribe());
      }
    }

    return events;
  }

  public async sendRaw(message: Record<string, unknown>): Promise<unknown> {
    return this.send<unknown>(message);
  }

  private async send<T>(message: Record<string, unknown>): Promise<T> {
    await this.connect();

    if (!this.connection) {
      throw new HelperCliError("INTERNAL_ERROR", "Home Assistant connection not initialized");
    }

    try {
      return await this.connection.sendMessagePromise<T>(message);
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  private async restGet(path: string, params: URLSearchParams): Promise<unknown> {
    const queryString = params.toString();
    const url = `${this.apiBaseUrl}${path}${queryString ? `?${queryString}` : ""}`;

    let response: Response;

    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          "Content-Type": "application/json",
        },
      });
    } catch (error) {
      throw new HelperCliError("TIMEOUT", "Failed to reach Home Assistant REST endpoint", {
        details: error,
        retriable: true,
      });
    }

    if (!response.ok) {
      const body = await safeText(response);
      throw this.normalizeHttpError(response.status, body);
    }

    try {
      return (await response.json()) as unknown;
    } catch (error) {
      throw new HelperCliError("HA_API_ERROR", "Invalid JSON returned by Home Assistant", {
        details: error,
      });
    }
  }

  private defaultStartIso(hoursBack: number): string {
    return new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
  }

  private normalizeHttpError(status: number, body: string): HelperCliError {
    if (status === 401) {
      return new HelperCliError("AUTH_ERROR", "Authentication with Home Assistant failed", {
        details: body,
      });
    }

    if (status === 403) {
      return new HelperCliError("PERMISSION_DENIED", "Permission denied by Home Assistant", {
        details: body,
      });
    }

    if (status === 404 || status === 405) {
      return new HelperCliError(
        "CAPABILITY_UNAVAILABLE",
        "Requested REST capability is unavailable in this Home Assistant instance",
        { details: body },
      );
    }

    if (status >= 500) {
      return new HelperCliError("HA_API_ERROR", "Home Assistant internal server error", {
        details: body,
        retriable: true,
      });
    }

    return new HelperCliError("HA_API_ERROR", "Home Assistant REST call failed", {
      details: body,
      retriable: status >= 429,
    });
  }

  private normalizeError(error: unknown): HelperCliError {
    const message = error instanceof Error ? error.message : String(error);

    if (/auth|token|unauthorized|401/i.test(message)) {
      return new HelperCliError("AUTH_ERROR", "Authentication with Home Assistant failed", {
        details: message,
      });
    }

    if (/forbidden|permission|403/i.test(message)) {
      return new HelperCliError("PERMISSION_DENIED", "Permission denied by Home Assistant", {
        details: message,
      });
    }

    if (/unknown command|not supported|not_found|404/i.test(message)) {
      return new HelperCliError(
        "CAPABILITY_UNAVAILABLE",
        "Requested API capability is unavailable in this Home Assistant instance",
        { details: message },
      );
    }

    if (/timeout|timed out/i.test(message)) {
      return new HelperCliError("TIMEOUT", "Home Assistant API call timed out", {
        details: message,
        retriable: true,
      });
    }

    return new HelperCliError("HA_API_ERROR", "Home Assistant API call failed", {
      details: message,
      retriable: true,
    });
  }
}

const safeText = async (response: Response): Promise<string> => {
  try {
    return await response.text();
  } catch {
    return "";
  }
};
